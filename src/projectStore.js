/**
 * Хранилище проектов демо-клиента (`localStorage`).
 *
 * Проект — это одна BPMN-схема с несколькими процессами (`bpmn:collaboration`)
 * плюс имя и метка сохранения. Раньше кэш был по организации
 * (`bpmn-schema:CUSTOMER` / `bpmn-schema:SUPPLIER`, см. `src/schemaStore.js`):
 * два независимых XML, которые легко рассинхронизировать — правка роли у
 * Заказчика не доезжала до процесса Поставщика. Проект закрывает ровно это:
 * схема одна, а нарезки процессов делает SDK (`extractProcessXml`).
 *
 * Границы модуля:
 *  - это **кэш на браузер**, а не серверное состояние: движок и
 *    `process_definitions` он не заменяет (схема уезжает в кластер кнопкой
 *    «Задеплоить»);
 *  - модуль не знает про React; SDK нужен только для миграции старого кэша
 *    (`buildProjectXml`/`replaceProcessXml`);
 *  - недоступное/переполненное хранилище (приватный режим, квота, Node) — не
 *    ошибка приложения: функции возвращают `null`/`false`/пустой список.
 */

import {
  DEFAULT_PROJECT_BPMN_XML,
  DEFAULT_PROJECT_NAME,
  getProjectProcesses,
  replaceProcessXml,
} from './vendor/bpmn-sdk';
import { formatSavedAt, loadSchema } from './schemaStore';

/** Ключ списка проектов. */
export const PROJECT_STORAGE_KEY = 'bpmn-projects';

/** Ключ активного проекта. */
export const ACTIVE_PROJECT_KEY = 'bpmn-projects:active';

/** Идентификатор проекта, когда хранилища нет (сессия без сохранения). */
export const MEMORY_PROJECT_ID = 'project-memory';

/** Хранилище, с которым работает модуль (`null` — «хранилища нет»). */
function resolveStorage(storage) {
  if (storage !== undefined) return storage;

  try {
    return globalThis.localStorage || null;
  } catch (error) {
    return null;
  }
}

/** Читает JSON из хранилища (`null`, если записи нет или она битая). */
function readJson(storage, key) {
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/** Пишет JSON в хранилище (`false`, если не удалось). */
function writeJson(storage, key, value) {
  if (!storage) return false;

  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

/** Исправная запись проекта либо `null` (битые/чужие записи игнорируются). */
function normalizeProject(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;

  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const xml = typeof record.xml === 'string' ? record.xml : '';

  if (!id || xml.trim() === '') return null;

  return {
    id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Проект',
    xml,
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || record.createdAt || '',
  };
}

/** Новый идентификатор проекта. */
function createProjectId() {
  return 'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Список проектов.
 *
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Array<{id: string, name: string, xml: string, createdAt: string, updatedAt: string}>}
 */
export function listProjects(options = {}) {
  const records = readJson(resolveStorage(options.storage), PROJECT_STORAGE_KEY);

  return (Array.isArray(records) ? records : []).map(normalizeProject).filter(Boolean);
}

/**
 * Проект по идентификатору.
 *
 * @param {string} id идентификатор проекта.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Object|null} запись либо `null`.
 */
export function getProject(id, options = {}) {
  if (!id) return null;

  return listProjects(options).find((project) => project.id === id) || null;
}

/**
 * Создаёт проект.
 *
 * @param {{id?: string, name?: string, xml: string}} project данные проекта.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Object|null} запись либо `null` (пустая схема/нет хранилища).
 */
export function createProject(project, options = {}) {
  if (!project || typeof project.xml !== 'string' || project.xml.trim() === '') return null;

  const storage = resolveStorage(options.storage);
  const now = new Date().toISOString();
  const record = {
    id: project.id || createProjectId(),
    name: project.name && project.name.trim() ? project.name.trim() : DEFAULT_PROJECT_NAME,
    xml: project.xml,
    createdAt: now,
    updatedAt: now,
  };

  const projects = listProjects({ storage });
  if (projects.some((item) => item.id === record.id)) return null;

  return writeJson(storage, PROJECT_STORAGE_KEY, [...projects, record]) ? record : null;
}

/**
 * Обновляет проект (схема, имя).
 *
 * @param {string} id идентификатор проекта.
 * @param {{name?: string, xml?: string}} patch изменения.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Object|null} обновлённая запись либо `null`.
 */
export function updateProject(id, patch = {}, options = {}) {
  if (!id || !patch || typeof patch !== 'object') return null;

  const storage = resolveStorage(options.storage);
  const projects = listProjects({ storage });
  const index = projects.findIndex((project) => project.id === id);

  if (index === -1) return null;
  if (patch.xml !== undefined && (typeof patch.xml !== 'string' || patch.xml.trim() === '')) {
    return null;
  }

  const updated = {
    ...projects[index],
    ...(patch.name && patch.name.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.xml !== undefined ? { xml: patch.xml } : {}),
    updatedAt: new Date().toISOString(),
  };

  const next = projects.map((project, itemIndex) => (itemIndex === index ? updated : project));

  return writeJson(storage, PROJECT_STORAGE_KEY, next) ? updated : null;
}

/**
 * Удаляет проект.
 *
 * Активный проект после удаления выбирается заново: первый из оставшихся, иначе
 * активного нет — приложение покажет список проектов.
 *
 * @param {string} id идентификатор проекта.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} true, если запись удалена.
 */
export function deleteProject(id, options = {}) {
  if (!id) return false;

  const storage = resolveStorage(options.storage);
  const projects = listProjects({ storage });
  const next = projects.filter((project) => project.id !== id);

  if (next.length === projects.length) return false;
  if (!writeJson(storage, PROJECT_STORAGE_KEY, next)) return false;

  if (getActiveProjectId({ storage }) === id) {
    setActiveProjectId(next.length > 0 ? next[0].id : '', { storage });
  }

  return true;
}

/**
 * Идентификатор активного проекта (`''`, если проекта нет).
 *
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {string}
 */
export function getActiveProjectId(options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return '';

  try {
    return String(storage.getItem(ACTIVE_PROJECT_KEY) || '');
  } catch (error) {
    return '';
  }
}

/**
 * Запоминает активный проект.
 *
 * @param {string} id идентификатор проекта (`''`, чтобы снять выбор).
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} true, если запись удалась.
 */
export function setActiveProjectId(id, options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;

  try {
    if (!id) {
      storage.removeItem(ACTIVE_PROJECT_KEY);
      return true;
    }

    storage.setItem(ACTIVE_PROJECT_KEY, String(id));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * XML проекта из старого кэша схем (`bpmn-schema:CUSTOMER` / `:SUPPLIER`).
 *
 * Миграция одноразовая: как только проект создан в новом хранилище, старые
 * ключи больше не читаются. Подписи участников берутся из демо-проекта — в
 * старом кэше их не было.
 *
 * @param {Storage|null} storage хранилище.
 * @returns {string} XML проекта либо `''`, если мигрировать нечего.
 */
export function migratedProjectXml(storage) {
  const customer = loadSchema('CUSTOMER', { storage });
  const supplier = loadSchema('SUPPLIER', { storage });

  if (!customer && !supplier) return '';

  const processes = getProjectProcesses(DEFAULT_PROJECT_BPMN_XML);
  let xml = DEFAULT_PROJECT_BPMN_XML;

  if (customer && processes[0]) {
    xml = replaceProcessXml(xml, processes[0].id, customer.xml);
  }
  if (supplier && processes[1]) {
    xml = replaceProcessXml(xml, processes[1].id, supplier.xml);
  }

  return xml;
}

/**
 * Активный проект приложения; если проектов нет — создаёт демо-проект.
 *
 * Порядок:
 *  1. есть проекты — активный (или первый) и запомнить его активным;
 *  2. проектов нет, но остался старый кэш схем — собрать проект из него;
 *  3. ничего нет — демо-проект SDK.
 *
 * @param {{xml?: string, name?: string, storage?: Storage|null}} [options]
 *   схема/имя для нового проекта и хранилище.
 * @returns {Object} запись проекта (в памяти, если хранилища нет).
 */
export function ensureDefaultProject(options = {}) {
  const storage = resolveStorage(options.storage);
  const projects = listProjects({ storage });

  if (projects.length > 0) {
    const activeId = getActiveProjectId({ storage });
    const active = projects.find((project) => project.id === activeId) || projects[0];

    if (active.id !== activeId) setActiveProjectId(active.id, { storage });

    return active;
  }

  const xml = migratedProjectXml(storage) || options.xml || DEFAULT_PROJECT_BPMN_XML;
  const name = options.name || DEFAULT_PROJECT_NAME;
  const created = createProject({ xml, name }, { storage });

  if (created) {
    setActiveProjectId(created.id, { storage });
    return created;
  }

  // Хранилище недоступно: сессия работает на демо-проекте, но F5 его забудет.
  return {
    id: MEMORY_PROJECT_ID,
    name,
    xml,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Подпись метки сохранения проекта (`''`, если метки нет).
 *
 * @param {string} timestamp ISO-метка.
 * @returns {string} например `12:05:31`.
 */
export function formatProjectSavedAt(timestamp) {
  return formatSavedAt(timestamp);
}

