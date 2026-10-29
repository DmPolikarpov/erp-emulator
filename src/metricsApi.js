/**
 * Клиент серверных метрик (M7).
 *
 * Инфографику руководителя считает движок по Postgres
 * (`bpmn-engine/src/metrics.rs`), а не браузер: иначе у второго клиента панель
 * пуста — процессы запускал не он. HTTP-шлюз отдаёт те же цифры по
 * `GET /api/v1/metrics` (`bpmn-gateways/http-cluster/index.js`).
 *
 * Границы модуля:
 *  - панель ([`MetricsPanel.jsx`](MetricsPanel.jsx)) не знает ни про API, ни про
 *    формат движка: `toPanelRuns` перекладывает ответ в записи запусков, с
 *    которыми она уже работает;
 *  - ответ сервера кэшируется в браузере (`METRICS_CACHE_KEY`): после F5 панель
 *    рисуется сразу, до ответа API, но это **тот же** ответ сервера, а не
 *    локальный счётчик клиента;
 *  - ошибки не бросаются: недоступный шлюз — это `{ok:false, error}`, панель
 *    тогда показывает кэш и подпись «данные с сервера недоступны».
 *
 * @see bpmn-engine/src/metrics.rs — модель ответа (`processes`, `steps`, `roles`)
 */

/** Базовый URL API метрик; в dev он уходит в CRA-прокси на шлюз. */
export const METRICS_API_BASE_URL =
  process.env.REACT_APP_METRICS_API_URL || '/api/v1/metrics';

/** Таймаут запроса: дольше ждать ответа NATS смысла нет. */
export const METRICS_TIMEOUT_MS = 8000;

/** Ключ кэша последнего ответа сервера в `localStorage`. */
export const METRICS_CACHE_KEY = 'bpmn-process-metrics-cache';

/** Сколько последних запусков просить у сервера (панель рисует не больше 12). */
export const DEFAULT_METRICS_LIMIT = 20;

/** Порог SLA: шаг, который ждал дольше, попадает в `breachedSteps`. */
export const DEFAULT_SLA_MINUTES = 30;

/** Максимальная длина текстового «хвоста» не-JSON ответа в сообщении об ошибке. */
const MAX_TEXT_DETAILS_LENGTH = 160;

/**
 * Хранилище, с которым работает модуль.
 *
 * Как и в [`src/metricsStore.js`](metricsStore.js): `storage` приходит опцией
 * (тесты подставляют заглушку или `null`), по умолчанию — `window.localStorage`.
 * Обращение обёрнуто: при запрете cookies браузер бросает исключение уже на
 * чтении свойства.
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
 * Целое число из параметра запроса (`null`/пустая строка — «не задано»).
 *
 * @param {*} value значение из настроек панели или из строки запроса.
 * @returns {number|null} целое либо `null`.
 */
function toInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }

  return null;
}

/**
 * Строка параметров запроса: незаданные значения не отправляются.
 *
 * Сервер сам подставляет порог SLA и лимит, поэтому пустой объект — это запрос
 * «по умолчанию», а не `?limit=null`.
 *
 * @param {{processId?: string, limit?: number, slaMinutes?: number,
 *   defectNodes?: string[]}} [params] параметры панели.
 * @returns {string} `?...` либо `''`.
 */
export function metricsQuery(params = {}) {
  const query = new URLSearchParams();
  const source = params || {};

  if (typeof source.processId === 'string' && source.processId.trim() !== '') {
    query.set('processId', source.processId.trim());
  }

  const limit = toInt(source.limit);
  if (limit !== null) query.set('limit', String(limit));

  const slaMinutes = toInt(source.slaMinutes);
  if (slaMinutes !== null) query.set('slaMinutes', String(slaMinutes));

  const defectNodes = Array.isArray(source.defectNodes)
    ? source.defectNodes.map((node) => String(node || '').trim()).filter(Boolean)
    : [];
  if (defectNodes.length > 0) query.set('defectNodes', defectNodes.join(','));

  const text = query.toString();

  return text ? `?${text}` : '';
}
/**
 * Ответ API → записи запусков для панели.
 *
 * Панель работает с записями `metricsStore` (`id`, `durationMs`, `status`), а
 * сервер отдаёт агрегаты процесса плюс `lastRuns`. Перевод в записи запусков
 * оставляет панель одним представлением: те же плитки и столбики считаются по
 * `summarizeRuns`, но по серверным числам — одинаковым у всех клиентов.
 *
 * `durationMs` сервера — цикл запуска (старт → финиш), как и локальная метрика;
 * `orderNumber` берётся из заказа (`orders`, M4): движок отдаёт `orderNum` для
 * запусков, привязанных к заказу. Экземпляр вне заказа подписывается id.
 *
 * @param {Object|null} metrics ответ `GET /api/v1/metrics`.
 * @param {{orgOf?: (processId: string) => string}} [options] контур процесса —
 *   в ответе движка его нет, он известен только кабинету.
 * @returns {Array<Object>} записи запусков (`[]`, если сервер запусков не нашёл).
 */
export function toPanelRuns(metrics, options = {}) {
  const orgOf = typeof options.orgOf === 'function' ? options.orgOf : () => '';
  const processes = Array.isArray(metrics && metrics.processes) ? metrics.processes : [];
  const runs = [];

  processes.forEach((process) => {
    if (!process) return;

    const processId = process.processId ? String(process.processId) : '';
    const org = orgOf(processId) || '';
    const lastRuns = Array.isArray(process.lastRuns) ? process.lastRuns : [];

    lastRuns.forEach((run) => {
      if (!run || !run.instanceId) return;

      runs.push({
        id: String(run.instanceId),
        processId,
        processName: process.processName || '',
        org,
        orderNumber: typeof run.orderNum === 'string' ? run.orderNum : '',
        startedAt: run.startedAt || '',
        finishedAt: run.finishedAt || null,
        durationMs:
          typeof run.durationMs === 'number' && run.durationMs >= 0 ? run.durationMs : null,
        lastElementId: run.lastNode || '',
        status: run.status === 'ACTIVE' ? 'ACTIVE' : 'COMPLETED',
        slaBreached: run.slaBreached === true,
      });
    });
  });

  return runs;
}

/**
 * Кладёт ответ сервера в кэш браузера.
 *
 * Кэш — не вторая метрика, а «последний известный ответ»: панель рисует его
 * сразу после F5 и помечает как кэш. Недоступное/переполненное хранилище — не
 * ошибка: панель просто дождётся ответа API.
 *
 * @param {Object} metrics ответ `GET /api/v1/metrics`.
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} `true`, если запись удалась.
 */
export function saveMetricsCache(metrics, options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage || !metrics || typeof metrics !== 'object') return false;

  try {
    storage.setItem(
      METRICS_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), metrics })
    );
  } catch (error) {
    return false;
  }

  return true;
}

/**
 * Кэш последнего ответа сервера.
 *
 * Битый JSON и чужая форма записи считаются отсутствием кэша: устаревшая копия
 * не должна ронять кабинет руководителя.
 *
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {{metrics: Object, savedAt: string}|null} кэш либо `null`.
 */
export function loadMetricsCache(options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return null;

  let raw = null;
  try {
    raw = storage.getItem(METRICS_CACHE_KEY);
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

  if (!parsed || typeof parsed !== 'object' || !parsed.metrics) return null;
  if (typeof parsed.metrics !== 'object') return null;

  return { metrics: parsed.metrics, savedAt: parsed.savedAt || '' };
}

/**
 * Забывает кэш серверных метрик (кнопка «Очистить» в режиме кэша).
 *
 * @param {{storage?: Storage|null}} [options] хранилище.
 * @returns {boolean} `true`, если запись удалена (или её и не было).
 */
export function clearMetricsCache(options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;

  try {
    storage.removeItem(METRICS_CACHE_KEY);
  } catch (error) {
    return false;
  }

  return true;
}

/**
 * Причина отказа из тела ответа шлюза.
 *
 * Ошибку отдаёт не только шлюз: CRA dev-server при мёртвом пробросе отвечает
 * HTML-страницей, `body-parser` — HTML на 413. Без текстовой подсказки
 * руководитель видит лишь код статуса и не знает, что чинить.
 *
 * @param {Response} response ответ с не-2xx статусом.
 * @returns {Promise<string|null>} причина либо `null`.
 */
async function readFailure(response) {
  try {
    const payload = await response.json();

    if (Array.isArray(payload.details) && payload.details.length > 0) {
      return payload.details
        .map((detail) => `${detail.field || 'body'}: ${detail.message}`)
        .join('; ');
    }

    if (typeof payload.details === 'string' && payload.details.trim() !== '') {
      return `${payload.error || 'Ошибка шлюза'}: ${payload.details.trim()}`;
    }

    return payload.error || null;
  } catch (error) {
    // Тело не JSON — так отвечает промежуточный слой: покажем текст как есть.
  }

  if (!response || typeof response.text !== 'function') return null;

  try {
    const text = String(await response.text())
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return null;

    return text.length > MAX_TEXT_DETAILS_LENGTH
      ? `${text.slice(0, MAX_TEXT_DETAILS_LENGTH)}…`
      : text;
  } catch (error) {
    return null;
  }
}

/**
 * Клиент API метрик: `GET ${baseUrl}?processId=…&limit=…&slaMinutes=…`.
 *
 * `fetchImpl` и `timeoutMs` подменяются в тестах; в браузере — глобальный
 * `fetch` и `METRICS_TIMEOUT_MS`. Метод никогда не бросает исключений:
 * вызывающий код работает с флагом `ok` и текстом `error`.
 */
export class MetricsClient {
  constructor(baseUrl = METRICS_API_BASE_URL, options = {}) {
    this.baseUrl = String(baseUrl || METRICS_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : METRICS_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  /**
   * Метрики с сервера.
   *
   * @param {{processId?: string, limit?: number, slaMinutes?: number,
   *   defectNodes?: string[]}} [params] параметры запроса.
   * @returns {Promise<{ok: boolean, status?: number, metrics?: Object|null,
   *                    error?: string, details?: (string|null)}>} ответ движка
   *   (как есть) либо причина отказа.
   */
  async load(params = {}) {
    if (!this.fetchImpl) {
      return {
        ok: false,
        error: 'fetch недоступен в текущем окружении: показываем кэш метрик.',
        metrics: null,
      };
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${metricsQuery(params)}`, {
        method: 'GET',
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `API метрик вернул ошибку (${response.status})`,
          details: await readFailure(response),
          metrics: null,
        };
      }

      const data = await response.json().catch(() => null);

      // Шлюз отдаёт тело движка как есть; `ok: false` в нём — отказ расчёта.
      if (!data || typeof data !== 'object' || data.ok === false) {
        return {
          ok: false,
          status: response.status,
          error: (data && data.error) || 'API метрик вернул пустой ответ.',
          metrics: null,
        };
      }

      return { ok: true, status: response.status, metrics: data };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return {
          ok: false,
          error: `API метрик не ответил за ${this.timeoutMs} мс.`,
          metrics: null,
        };
      }

      return { ok: false, error: 'API метрик недоступен.', metrics: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Клиент по умолчанию: приложение использует его без настройки. */
export const metricsClient = new MetricsClient();
