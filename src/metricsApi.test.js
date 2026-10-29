/**
 * Тесты клиента серверных метрик (`GET /api/v1/metrics`, M7).
 *
 * Проверяется граница с внешним миром: строка запроса, разбор ответа движка в
 * записи запусков панели, кэш ответа в браузере и отказы (шлюз недоступен, он
 * же ответил ошибкой, тело не-JSON). Панель и кабинет покрыты
 * `src/MetricsPanel.test.jsx` и `src/App.test.js`, а расчёт цифр — серверными
 * тестами `bpmn-engine/src/metrics.rs`.
 */

import {
  DEFAULT_METRICS_LIMIT,
  DEFAULT_SLA_MINUTES,
  METRICS_CACHE_KEY,
  MetricsClient,
  clearMetricsCache,
  loadMetricsCache,
  metricsQuery,
  saveMetricsCache,
  toPanelRuns,
} from './metricsApi';

/** Мини-хранилище в памяти с тем же контрактом, что у `localStorage`. */
const createMemoryStorage = () => {
  const data = new Map();

  return {
    data,
    getItem: jest.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: jest.fn((key, value) => {
      data.set(key, String(value));
    }),
    removeItem: jest.fn((key) => {
      data.delete(key);
    }),
  };
};

/** Хранилище, которое «ломается» на любом обращении (приватный режим браузера). */
const createFailingStorage = () => ({
  getItem: jest.fn(() => {
    throw new Error('storage is disabled');
  }),
  setItem: jest.fn(() => {
    throw new Error('storage is disabled');
  }),
  removeItem: jest.fn(() => {
    throw new Error('storage is disabled');
  }),
});

/** Ответ `fetch` с JSON-телом. */
const jsonResponse = (body, init = {}) => ({
  ok: init.ok !== undefined ? init.ok : true,
  status: init.status || 200,
  json: jest.fn(() => Promise.resolve(body)),
  text: jest.fn(() =>
    Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  ),
});

/** Ответ движка: один процесс, один завершённый и один активный запуск. */
const serverMetrics = () => ({
  ok: true,
  generatedAt: '2026-10-26T10:00:00.000Z',
  slaMinutes: 30,
  precisionMs: 1000,
  defectEndEvents: [],
  processes: [
    {
      processId: 'Process_MilkCustomer_v1',
      processName: 'Закупка и приемка сырого молока',
      runs: 2,
      completed: 1,
      active: 1,
      terminated: 0,
      averageCycleMs: 480000,
      averageStepMs: 420000,
      slaRuns: 1,
      slaSteps: 1,
      openSteps: 1,
      defectRuns: 0,
      defectShare: null,
      lastRuns: [
        {
          instanceId: 'inst-cust-1',
          startedAt: '2026-10-26T09:52:00.000Z',
          finishedAt: '2026-10-26T10:00:00.000Z',
          durationMs: 480000,
          status: 'COMPLETED',
          lastNode: 'EndEvent_Customer',
          finishedBy: 'legacy',
          slaBreached: false,
          breachedSteps: [],
        },
        {
          instanceId: 'inst-cust-2',
          startedAt: '2026-10-26T09:30:00.000Z',
          finishedAt: null,
          durationMs: null,
          status: 'ACTIVE',
          lastNode: 'Task_Wait',
          slaBreached: true,
          breachedSteps: [
            { elementId: 'Task_Wait', role: 'operator', waitedMs: 1800000, open: true },
          ],
        },
      ],
    },
  ],
  steps: [],
  roles: [],
  totals: { instances: 2, runs: 2, steps: 1, openSteps: 1, events: 0, definitions: 1 },
  warnings: [],
});

describe('metricsApi: строка запроса', () => {
  it('без параметров запрос идёт «по умолчанию»', () => {
    expect(metricsQuery()).toBe('');
    expect(metricsQuery({})).toBe('');
    expect(metricsQuery({ processId: '', limit: null, slaMinutes: undefined })).toBe('');
  });

  it('передаёт разрез, лимит и порог SLA', () => {
    expect(metricsQuery({ processId: 'zakaz', limit: DEFAULT_METRICS_LIMIT })).toBe(
      `?processId=zakaz&limit=${DEFAULT_METRICS_LIMIT}`
    );
    expect(metricsQuery({ slaMinutes: DEFAULT_SLA_MINUTES })).toBe(
      `?slaMinutes=${DEFAULT_SLA_MINUTES}`
    );
  });

  it('узлы брака уходят одним списком', () => {
    expect(metricsQuery({ defectNodes: ['End_Defect', ' End_Reject ', ''] })).toBe(
      '?defectNodes=End_Defect%2CEnd_Reject'
    );
  });

  it('мусор в параметрах не превращается в `?limit=NaN`', () => {
    expect(metricsQuery({ limit: 'abc', slaMinutes: {} })).toBe('');
  });
});

describe('metricsApi: ответ движка → записи запусков панели', () => {
  it('переносит процессы и запуски в формат `metricsStore`', () => {
    const runs = toPanelRuns(serverMetrics(), { orgOf: () => 'CUSTOMER' });

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      id: 'inst-cust-1',
      processId: 'Process_MilkCustomer_v1',
      processName: 'Закупка и приемка сырого молока',
      org: 'CUSTOMER',
      durationMs: 480000,
      status: 'COMPLETED',
      lastElementId: 'EndEvent_Customer',
    });
    // Активный запуск: времени ещё нет, но он виден как «в работе».
    expect(runs[1]).toMatchObject({ id: 'inst-cust-2', durationMs: null, status: 'ACTIVE' });
    expect(runs[1].slaBreached).toBe(true);
  });

  it('`TERMINATED` считается завершённым, а не «в работе»', () => {
    const metrics = serverMetrics();
    metrics.processes[0].lastRuns = [
      {
        instanceId: 'inst-cust-3',
        durationMs: 1000,
        status: 'TERMINATED',
        lastNode: 'Task_Stop',
      },
    ];

    const [run] = toPanelRuns(metrics);

    expect(run.status).toBe('COMPLETED');
    expect(run.org).toBe('');
  });

  it('подписывает запуск номером заказа, если движок его вернул', () => {
    // `orderNum` появился в ответе вместе с M8: экземпляр привязан к заказу, и
    // панель показывает номер заказа вместо `inst-cust-…`.
    const metrics = serverMetrics();
    metrics.processes[0].lastRuns = [
      { instanceId: 'inst-cust-4', orderNum: '№1042', durationMs: 1000, status: 'COMPLETED' },
      { instanceId: 'inst-cust-5', durationMs: 2000, status: 'ACTIVE' },
    ];

    const [ordered, plain] = toPanelRuns(metrics);

    expect(ordered.orderNumber).toBe('№1042');
    // Ответ без заказа не ломает панель: подпись остаётся пустой → покажется id.
    expect(plain.orderNumber).toBe('');
  });

  it('пустой ответ и мусор дают пустой список', () => {
    expect(toPanelRuns(null)).toEqual([]);
    expect(toPanelRuns({})).toEqual([]);
    expect(toPanelRuns({ processes: [{ processId: 'p', lastRuns: null }] })).toEqual([]);
  });
});

describe('metricsApi: кэш ответа сервера', () => {
  it('сохраняет и читает ответ вместе с временем записи', () => {
    const storage = createMemoryStorage();
    const metrics = serverMetrics();

    expect(saveMetricsCache(metrics, { storage })).toBe(true);
    expect(storage.getItem(METRICS_CACHE_KEY)).toContain('Process_MilkCustomer_v1');

    const cache = loadMetricsCache({ storage });

    expect(cache.metrics.processes).toHaveLength(1);
    expect(cache.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('без кэша и с битым кэшем возвращает `null`', () => {
    const storage = createMemoryStorage();

    expect(loadMetricsCache({ storage })).toBeNull();

    storage.setItem(METRICS_CACHE_KEY, '{не json');
    expect(loadMetricsCache({ storage })).toBeNull();

    // Запись чужого формата (прежняя версия приложения) — тоже «кэша нет».
    storage.setItem(METRICS_CACHE_KEY, JSON.stringify({ runs: [] }));
    expect(loadMetricsCache({ storage })).toBeNull();
  });

  it('«Очистить» удаляет кэш', () => {
    const storage = createMemoryStorage();

    saveMetricsCache(serverMetrics(), { storage });
    expect(clearMetricsCache({ storage })).toBe(true);
    expect(loadMetricsCache({ storage })).toBeNull();
  });

  it('недоступное хранилище не роняет панель', () => {
    const storage = createFailingStorage();

    expect(saveMetricsCache(serverMetrics(), { storage })).toBe(false);
    expect(loadMetricsCache({ storage })).toBeNull();
    expect(clearMetricsCache({ storage })).toBe(false);
  });
});

describe('metricsApi: клиент API', () => {
  it('отдаёт ответ движка и подставляет параметры панели', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(serverMetrics())));
    const client = new MetricsClient('/api/v1/metrics/', { fetchImpl, timeoutMs: 1000 });

    const result = await client.load({ limit: 5, slaMinutes: 30 });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/v1/metrics?limit=5&slaMinutes=30',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.ok).toBe(true);
    expect(result.metrics.processes[0].processId).toBe('Process_MilkCustomer_v1');
  });

  it('ошибка шлюза возвращается причиной, а не исключением', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: 'Не удалось получить метрики из оркестратора' },
          { ok: false, status: 503 }
        )
      )
    );
    const client = new MetricsClient('/api/v1/metrics', { fetchImpl, timeoutMs: 1000 });

    const result = await client.load();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain('503');
    expect(result.details).toBe('Не удалось получить метрики из оркестратора');
  });

  it('HTML вместо JSON — текст причины в `details`', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: jest.fn(() => Promise.reject(new Error('Unexpected token <'))),
        text: jest.fn(() =>
          Promise.resolve(
            '<html><body>Error occurred while trying to proxy</body></html>'
          )
        ),
      })
    );
    const client = new MetricsClient('/api/v1/metrics', { fetchImpl, timeoutMs: 1000 });

    const result = await client.load();

    expect(result.ok).toBe(false);
    expect(result.details).toBe('Error occurred while trying to proxy');
  });

  it('`ok: false` в теле движка — отказ расчёта', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(jsonResponse({ ok: false, error: 'не удалось прочитать БД' }))
    );
    const client = new MetricsClient('/api/v1/metrics', { fetchImpl, timeoutMs: 1000 });

    const result = await client.load();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('не удалось прочитать БД');
  });

  it('молчащий шлюз ограничен таймаутом', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const client = new MetricsClient('/api/v1/metrics', {
      fetchImpl: jest.fn(() => Promise.reject(abort)),
      timeoutMs: 1500,
    });

    const result = await client.load();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('1500');
  });

  it('без `fetch` и при обрыве сети возвращает причину', async () => {
    const withoutFetch = new MetricsClient('/api/v1/metrics', { timeoutMs: 1000 });
    // «Окружение без fetch»: подменяем транспорт после конструктора — тест не
    // должен зависеть от того, есть ли глобальный `fetch` в jsdom.
    withoutFetch.fetchImpl = null;

    const offline = new MetricsClient('/api/v1/metrics', {
      fetchImpl: jest.fn(() => Promise.reject(new Error('NetworkError'))),
      timeoutMs: 1000,
    });

    expect((await withoutFetch.load()).error).toContain('fetch недоступен');
    expect((await offline.load()).error).toBe('API метрик недоступен.');
  });
});
