/**
 * Локальное хранилище BPMN-схем демо-клиента (`localStorage`).
 *
 * Зачем: правки схемы в редакторе живут в состоянии React и теряются при
 * перезагрузке страницы, а демо-схемы, разошедшиеся по кабинетам, должны
 * совпадать (роль узла решает, кто видит шаг). Кэш в браузере закрывает
 * ровно это: сохранил схему — при следующем открытии приложения она
 * подхватывается вместо демо-схемы из SDK.
 *
 * Границы модуля:
 *  - это **кэш на браузер**, а не серверное состояние: движок и `process_definitions`
 *    он не заменяет (схема уезжает в кластер кнопкой «Задеплоить», а в
 *    `output_data.bpmn_xml` при старте процесса — как и раньше);
 *  - модуль ничего не знает про React и не импортирует SDK;
 *  - валидность XML проверяет редактор (`BpmnEditor` отдаёт разбор XML),
 *    хранилище принимает любую непустую строку — иначе кэш стал бы вторым,
 *    менее точным валидатором схемы;
 *  - недоступное/переполненное хранилище (приватный режим, квота, Node) —
 *    не ошибка приложения: функции возвращают `null`/`false`, а не бросают
 *    исключение (сохранение схемы не должно ломать сам сценарий).
 */

/** Префикс ключей: `bpmn-schema:<ORG>`. */
export const SCHEMA_STORAGE_PREFIX = 'bpmn-schema:';

/** Организации, у которых своя схема процесса. */
export const SCHEMA_ORGS = ['CUSTOMER', 'SUPPLIER'];

/** Приводит код организации к каноническому виду (`customer` → `CUSTOMER`). */
export function normalizeOrg(org) {
  return typeof org === 'string' ? org.trim().toUpperCase() : '';
}

/**
 * Ключ схемы организации в хранилище (`''`, если организация не задана).
 *
 * @param {string} org код организации (`CUSTOMER`/`SUPPLIER`).
 * @returns {string} ключ вида `bpmn-schema:CUSTOMER`.
 */
export function schemaStorageKey(org) {
  const normalized = normalizeOrg(org);
  return normalized ? `${SCHEMA_STORAGE_PREFIX}${normalized}` : '';
}

/**
 * Хранилище, с которым работает модуль.
 *
 * `storage` приходит опцией (тесты подставляют заглушку или `null`), по
 * умолчанию — `window.localStorage`. Обращение к `localStorage` обёрнуто:
 * при запрете cookies браузер бросает исключение уже на чтении свойства.
 *
 * @param {Storage|null} [storage] явное хранилище (`null` — «хранилища нет»).
 * @returns {Storage|null} хранилище либо `null`.
 */
function resolveStorage(storage) {
  if (storage !== undefined) return storage;

  try {
    return globalThis.localStorage || null;
  } catch (error) {
    return null;
  }
}

/**
 * Сохраняет схему организации.
 *
 * @param {string} org код организации.
 * @param {string} xml XML схемы.
 * @param {{storage?: Storage|null}} [options] хранилище (по умолчанию `localStorage`).
 * @returns {{org: string, xml: string, savedAt: string}|null} запись либо `null`.
 */
export function saveSchema(org, xml, options = {}) {
  const key = schemaStorageKey(org);
  const storage = resolveStorage(options.storage);

  if (!key || !storage) return null;
  if (typeof xml !== 'string' || xml.trim() === '') return null;

  const record = {
    org: normalizeOrg(org),
    xml,
    savedAt: new Date().toISOString(),
  };

  try {
    storage.setItem(key, JSON.stringify(record));
  } catch (error) {
    // Квота/приватный режим: правки остаются только в памяти приложения.
    return null;
  }

  return record;
}

/**
 * Читает сохранённую схему организации.
 *
 * Битый JSON и записи чужого формата считаются отсутствием схемы: устаревший
 * кэш не должен ронять приложение (пользователь получит демо-схему).
 *
 * @param {string} org код организации.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {{org: string, xml: string, savedAt: string}|null} запись либо `null`.
 */
export function loadSchema(org, options = {}) {
  const key = schemaStorageKey(org);
  const storage = resolveStorage(options.storage);

  if (!key || !storage) return null;

  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return null;
  }

  if (!raw) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return null;
  }

  if (!parsed || typeof parsed.xml !== 'string' || parsed.xml.trim() === '') return null;

  return {
    org: normalizeOrg(org),
    xml: parsed.xml,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
  };
}

/**
 * Забывает сохранённую схему организации (сброс к демо-схеме SDK).
 *
 * @param {string} org код организации.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} `true`, если запись удалена (или её и не было).
 */
export function clearSchema(org, options = {}) {
  const key = schemaStorageKey(org);
  const storage = resolveStorage(options.storage);

  if (!key || !storage) return false;

  try {
    storage.removeItem(key);
  } catch (error) {
    return false;
  }

  return true;
}

/**
 * Есть ли у организации сохранённая схема.
 *
 * @param {string} org код организации.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} признак сохранённой схемы.
 */
export function hasSavedSchema(org, options = {}) {
  return loadSchema(org, options) !== null;
}

/**
 * Время сохранения в виде `HH:MM:SS` для бейджа «Сохранено в …».
 *
 * @param {string} savedAt отметка времени (ISO).
 * @returns {string} локальное время или `''`, если отметки нет.
 */
export function formatSavedAt(savedAt) {
  if (typeof savedAt !== 'string' || savedAt === '') return '';

  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('ru-RU');
}
