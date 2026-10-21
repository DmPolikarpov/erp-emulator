/**
 * Метрики выполненных процессов демо-клиента (`localStorage`).
 *
 * Зачем: кабинет руководителя показывает инфографику по процессам, а данные о
 * запусках живут ровно столько, сколько открыта страница (состояние React), и
 * теряются при F5. Отдельного события «процесс завершён» движок клиенту тоже не
 * шлёт: токен просто встаёт на конечный узел схемы. Поэтому метрика — это то,
 * что клиент считает и хранит сам, рядом с проектом схемы
 * ([`src/projectStore.js`](projectStore.js)).
 *
 * Границы модуля:
 *  - это **метрика браузера**, а не серверное состояние: её видит только тот
 *    клиент, который запускал процессы (`execution_history` и
 *    `process_instances` в кластере модуль не заменяет);
 *  - пока измеряется одно — время выполнения (`durationMs`): от старта
 *    экземпляра до токена на конечном узле. Остальные метрики (время по шагам,
 *    ожидание, SLA) добавляются сюда же, не меняя формат уже сохранённых
 *    записей;
 *  - модуль ничего не знает ни про React, ни про SDK, ни про XML: подпись
 *    процесса (`processName`) ему передаёт вызывающий код, а агрегаты считаются
 *    по полям записи;
 *  - недоступное/переполненное хранилище (приватный режим, квота, Node) — не
 *    ошибка приложения: функции возвращают `null`/`false`/`[]`, а не бросают
 *    исключение (метрика не должна ломать сам сценарий работы с заказом).
 *
 * Формат записи (поля, на которые опираются панель и тесты):
 *
 * ```js
 * {
 *   id: 'inst-cust-abc123',            // экземпляр процесса — он же ключ записи
 *   processId: 'Process_MilkCustomer_v1', // bpmn:process/@id
 *   processName: 'Закупка и приемка сырого молока', // bpmn:process/@name
 *   org: 'CUSTOMER',                   // контур (заказчик/поставщик)
 *   orderNumber: '№101',               // метка заказа из payload, если была
 *   startedAt: '2026-10-12T10:00:00.000Z',  // старт экземпляра
 *   finishedAt: '2026-10-12T10:00:12.000Z', // токен на конечном узле
 *   durationMs: 12000,                 // длительность запуска
 *   lastElementId: 'EndEvent_Customer',// узел, на котором процесс финишировал
 *   status: 'COMPLETED',               // 'ACTIVE' | 'COMPLETED'
 * }
 * ```
 */

import { normalizeOrg } from './schemaStore';

/** Ключ метрик в хранилище браузера. */
export const METRICS_STORAGE_KEY = 'bpmn-process-metrics';

/** Сколько последних запусков хранить: метрика не должна расти бесконечно. */
export const MAX_RUNS = 60;

/** Сколько последних запусков рисует инфографика процесса. */
export const MAX_BARS = 12;

/** Высота самого высокого столбика инфографики, px. */
export const BAR_HEIGHT_PX = 120;

/** Минимальная высота столбика, px: «мгновенный» запуск тоже должен быть виден. */
export const MIN_BAR_HEIGHT_PX = 6;

/**
 * Хранилище, с которым работает модуль.
 *
 * `storage` приходит опцией (тесты подставляют заглушку или `null`), по
 * умолчанию — `window.localStorage`. Обращение к `localStorage` обёрнуто: при
 * запрете cookies браузер бросает исключение уже на чтении свойства.
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
 * Читает сохранённые запуски (новые — первыми, как их писала `beginRun`).
 *
 * Битый JSON и записи чужого формата считаются отсутствием метрики: устаревший
 * кэш не должен ронять кабинет руководителя — он просто окажется пустым.
 *
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Array<Object>} записи запусков (возможно, пустой список).
 */
export function loadRuns(options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return [];

  let raw = null;
  try {
    raw = storage.getItem(METRICS_STORAGE_KEY);
  } catch (error) {
    return [];
  }

  if (!raw) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((run) => run && typeof run.id === 'string' && run.id !== '');
}

/**
 * Пишет список запусков в хранилище.
 *
 * Хвост списка обрезается по `MAX_RUNS`: метрика — не журнал, ей достаточно
 * последних запусков, а квота `localStorage` общая со схемой.
 *
 * @param {Array<Object>} runs записи запусков.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} `true`, если запись удалась.
 */
function saveRuns(runs, options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;

  try {
    storage.setItem(METRICS_STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch (error) {
    // Квота/приватный режим: метрика остаётся только в памяти приложения.
    return false;
  }

  return true;
}

/**
 * Отмечает старт экземпляра процесса: с этого момента считается время
 * выполнения.
 *
 * Повторный вызов для того же экземпляра — это **новый запуск**: запись
 * перезаписывается целиком, старый финиш снимается, таймер начинается заново
 * (`beginRun` = «экземпляр стартовал»). Так повторный `StartProcess` по тому же
 * идентификатору не оставит метрику «уже завершённой» с чужим временем.
 *
 * @param {Object} run данные старта: `{id, org, processId, processName,
 *   orderNumber, startedAt}` (`id` — обязателен, остальное добирается из
 *   прежней записи).
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Object|null} сохранённая запись либо `null`, если хранилища нет.
 */
export function beginRun(run, options = {}) {
  if (!run || typeof run.id !== 'string' || run.id === '') return null;

  const runs = loadRuns(options);
  const index = runs.findIndex((item) => item.id === run.id);
  const previous = index === -1 ? null : runs[index];

  const record = {
    id: run.id,
    processId: run.processId || (previous && previous.processId) || '',
    processName: run.processName || (previous && previous.processName) || '',
    org: normalizeOrg(run.org || (previous && previous.org)),
    orderNumber: run.orderNumber || (previous && previous.orderNumber) || '',
    startedAt: run.startedAt || new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    lastElementId: '',
    status: 'ACTIVE',
  };

  if (index === -1) runs.unshift(record);
  else runs[index] = record;

  return saveRuns(runs, options) ? record : null;
}

/**
 * Закрывает запуск: считает время выполнения от старта.
 *
 * Идемпотентность важнее свежести: повторный финиш по тому же экземпляру
 * (движок может отдать кадр дважды, пользователь — нажать дважды) возвращает
 * уже закрытую запись, не переписывая её время.
 *
 * Записи без старта не создаются: экземпляр, который этот клиент не начинал
 * (страница открыта посреди процесса), измерить нечем — время выполнения
 * оказалось бы выдуманным.
 *
 * @param {string} instanceId идентификатор экземпляра (ключ записи).
 * @param {{finishedAt?: string, lastElementId?: string, orderNumber?: string}} [patch]
 *   уточнения финиша.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {Object|null} закрытая запись либо `null`, если запуска не было.
 */
export function completeRun(instanceId, patch = {}, options = {}) {
  if (typeof instanceId !== 'string' || instanceId === '') return null;

  const runs = loadRuns(options);
  const index = runs.findIndex((item) => item.id === instanceId);
  if (index === -1) return null;

  const run = runs[index];
  if (run.finishedAt) return run;

  const finishedAt = patch.finishedAt || new Date().toISOString();

  const record = {
    ...run,
    finishedAt,
    durationMs: durationBetween(run.startedAt, finishedAt),
    lastElementId: patch.lastElementId || run.lastElementId || '',
    orderNumber: patch.orderNumber || run.orderNumber || '',
    status: 'COMPLETED',
  };

  runs[index] = record;

  return saveRuns(runs, options) ? record : null;
}

/**
 * Забывает все сохранённые метрики (кнопка «Очистить» в кабинете руководителя).
 *
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} `true`, если запись удалена (или её и не было).
 */
export function clearRuns(options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;

  try {
    storage.removeItem(METRICS_STORAGE_KEY);
  } catch (error) {
    return false;
  }

  return true;
}

/**
 * Длительность между двумя отметками времени, мс.
 *
 * Часы могли «пойти назад» (системное время, переход на летнее время): нулевое
 * время внятнее отрицательного.
 *
 * @param {string} startedAt отметка старта (ISO).
 * @param {string} finishedAt отметка финиша (ISO).
 * @returns {number|null} миллисекунды либо `null`, если отметку не разобрать.
 */
function durationBetween(startedAt, finishedAt) {
  const start = Date.parse(startedAt || '');
  const end = Date.parse(finishedAt || '');

  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return Math.max(0, end - start);
}

/* ------------------------------------------------------------------ *
 * Агрегаты для инфографики кабинета руководителя
 * ------------------------------------------------------------------ */

/**
 * Сводка по списку запусков: сколько выполнено, сколько в работе, а также
 * среднее/минимальное/максимальное время выполнения.
 *
 * «В работе» — записи без `durationMs`: запуск уже стартовал, но токен до
 * конечного узла не дошёл (или финиш ещё не пришёл по WS).
 *
 * @param {Array<Object>} runs записи запусков.
 * @returns {{total: number, completedCount: number, activeCount: number,
 *            averageMs: (number|null), minMs: (number|null), maxMs: (number|null)}}
 *   сводка (`*Ms === null`, если завершённых запусков нет).
 */
export function summarizeRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const durations = list
    .filter((run) => run && typeof run.durationMs === 'number' && run.durationMs >= 0)
    .map((run) => run.durationMs);

  if (durations.length === 0) {
    return {
      total: list.length,
      completedCount: 0,
      activeCount: list.length,
      averageMs: null,
      minMs: null,
      maxMs: null,
    };
  }

  const sum = durations.reduce((total, value) => total + value, 0);

  return {
    total: list.length,
    completedCount: durations.length,
    activeCount: list.length - durations.length,
    averageMs: Math.round(sum / durations.length),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  };
}

/**
 * Раскладывает запуски по процессам: одна карточка инфографики на процесс.
 *
 * Процесс различается парой «контур + `bpmn:process/@id`», а не одним
 * идентификатором: у Заказчика и Поставщика свои схемы, и совпасть их `id`
 * могут ничуть не хуже, чем разойтись.
 *
 * Порядок карточек — как процессы появились в хранилище (новые вперёд), но
 * контур пользователя идёт первым (`preferredOrg`): руководителю важнее свой
 * процесс, а процессы второй стороны остаются рядом — обмен-то
 * межорганизационный.
 *
 * @param {Array<Object>} runs записи запусков.
 * @param {{preferredOrg?: string}} [options] контур, который показать первым.
 * @returns {Array<{key: string, org: string, processId: string,
 *   processName: string, runs: Array<Object>, summary: Object}>} карточки.
 */
export function groupRunsByProcess(runs, options = {}) {
  const preferredOrg = normalizeOrg(options.preferredOrg);
  const groups = [];
  const byKey = new Map();

  (Array.isArray(runs) ? runs : []).forEach((run) => {
    if (!run || typeof run.id !== 'string') return;

    const org = normalizeOrg(run.org);
    const key = `${org}:${run.processId || ''}`;

    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        org,
        processId: run.processId || '',
        processName: run.processName || '',
        runs: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }

    // Имя процесса приходит из схемы на старте: у записей, сохранённых до
    // правки схемы, его может не быть — берём то, что найдётся.
    if (!group.processName && run.processName) group.processName = run.processName;

    group.runs.push(run);
  });

  const rank = (group) => (preferredOrg && group.org !== preferredOrg ? 1 : 0);

  return groups
    .map((group) => ({ ...group, summary: summarizeRuns(group.runs) }))
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * Последние завершённые запуски процесса в порядке времени — для столбиков
 * инфографики.
 *
 * Хранилище держит записи «новые первыми», а инфографика читается слева
 * направо: старшие запуски слева, последний — справа.
 *
 * @param {Array<Object>} runs записи запусков (обычно одного процесса).
 * @param {number} [limit=MAX_BARS] сколько последних запусков взять.
 * @returns {Array<Object>} завершённые запуски по возрастанию времени финиша.
 */
export function recentCompletedRuns(runs, limit = MAX_BARS) {
  const completed = (Array.isArray(runs) ? runs : [])
    .filter((run) => run && typeof run.durationMs === 'number' && run.durationMs >= 0)
    .slice()
    .sort(
      (a, b) => (Date.parse(a.finishedAt || '') || 0) - (Date.parse(b.finishedAt || '') || 0)
    );

  return limit > 0 ? completed.slice(-limit) : completed;
}

/**
 * Высота столбика запуска в пикселях: длительность относительно самого долгого
 * запуска процесса.
 *
 * У «мгновенного» запуска высота не нулевая (`MIN_BAR_HEIGHT_PX`): столбик
 * нулевой высоты выглядел бы пропуском в данных, а не быстрым запуском.
 *
 * @param {number} durationMs время выполнения запуска.
 * @param {number} maxMs самый долгий запуск процесса.
 * @param {number} [maxHeightPx=BAR_HEIGHT_PX] высота самого высокого столбика.
 * @returns {number} высота в пикселях.
 */
export function barHeightPx(durationMs, maxMs, maxHeightPx = BAR_HEIGHT_PX) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return MIN_BAR_HEIGHT_PX;
  }

  if (typeof maxMs !== 'number' || !Number.isFinite(maxMs) || maxMs <= 0) return maxHeightPx;

  const share = durationMs / maxMs;

  return Math.max(MIN_BAR_HEIGHT_PX, Math.round(maxHeightPx * share));
}

/**
 * Время выполнения в человекочитаемом виде (`12 с`, `3 мин 05 с`).
 *
 * @param {number|null} ms миллисекунды (`null` — метрики нет).
 * @returns {string} значение для инфографики (`'—'`, если измерить не удалось).
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} мс`;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)} с`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes} мин ${String(seconds).padStart(2, '0')} с`;

  const hours = Math.floor(minutes / 60);

  return `${hours} ч ${String(minutes % 60).padStart(2, '0')} мин`;
}

/**
 * Отметка времени запуска в виде `HH:MM:SS` — подсказка столбика инфографики.
 *
 * @param {string} value отметка времени (ISO).
 * @returns {string} локальное время либо `''`, если отметки нет.
 */
export function formatRunTime(value) {
  if (typeof value !== 'string' || value === '') return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('ru-RU');
}
