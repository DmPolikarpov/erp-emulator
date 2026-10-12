/**
 * Тесты метрик выполненных процессов (`localStorage`).
 *
 * Метрика — это то, на что руководитель смотрит в инфографике, поэтому кроме
 * обычного «стартовал → завершился → посчиталось» проверяются крайние случаи
 * счёта: повторный финиш (идемпотентность), финиш без старта, кривые часы и
 * переполненное хранилище. Хранилище — граница с внешним миром: оно бывает
 * недоступным (приватный режим) и забитым мусором от прежних версий, и метрика
 * не должна из-за этого ронять сценарий работы с заказом.
 */

import {
  BAR_HEIGHT_PX,
  MAX_BARS,
  MAX_RUNS,
  METRICS_STORAGE_KEY,
  MIN_BAR_HEIGHT_PX,
  barHeightPx,
  beginRun,
  clearRuns,
  completeRun,
  formatDuration,
  formatRunTime,
  groupRunsByProcess,
  loadRuns,
  recentCompletedRuns,
  summarizeRuns,
} from './metricsStore';

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
const createFailingStorage = (error = new Error('storage is disabled')) => ({
  getItem: jest.fn(() => {
    throw error;
  }),
  setItem: jest.fn(() => {
    throw error;
  }),
  removeItem: jest.fn(() => {
    throw error;
  }),
});

/** Запуск процесса: тест говорит только о тех полях, которые проверяет. */
const runOf = (overrides = {}) => ({
  id: 'inst-cust-1',
  processId: 'Process_MilkCustomer_v1',
  processName: 'Закупка и приемка сырого молока',
  org: 'CUSTOMER',
  orderNumber: '№101',
  startedAt: '2026-10-12T10:00:00.000Z',
  finishedAt: null,
  durationMs: null,
  lastElementId: '',
  status: 'ACTIVE',
  ...overrides,
});

describe('metricsStore: запись запусков', () => {
  it('отмечает старт экземпляра процесса', () => {
    const storage = createMemoryStorage();

    const record = beginRun(
      {
        id: 'inst-cust-1',
        org: 'customer',
        processId: 'P1',
        processName: 'Закупка',
        orderNumber: '№101',
      },
      { storage }
    );

    expect(record).toMatchObject({
      id: 'inst-cust-1',
      org: 'CUSTOMER',
      processId: 'P1',
      processName: 'Закупка',
      orderNumber: '№101',
      finishedAt: null,
      durationMs: null,
      status: 'ACTIVE',
    });
    expect(typeof record.startedAt).toBe('string');
    expect(loadRuns({ storage })).toEqual([record]);
  });

  it('повторный старт того же экземпляра начинает отсчёт заново', () => {
    const storage = createMemoryStorage();

    beginRun(runOf(), { storage });
    completeRun('inst-cust-1', { finishedAt: '2026-10-12T10:00:30.000Z' }, { storage });

    const restarted = beginRun(
      runOf({ startedAt: '2026-10-12T11:00:00.000Z' }),
      { storage }
    );

    expect(restarted).toMatchObject({
      startedAt: '2026-10-12T11:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      status: 'ACTIVE',
    });
    expect(loadRuns({ storage })).toHaveLength(1);
  });

  it('старт без идентификатора экземпляра не сохраняется', () => {
    const storage = createMemoryStorage();

    expect(beginRun({ id: '' }, { storage })).toBeNull();
    expect(beginRun(null, { storage })).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('финиш считает время выполнения от старта', () => {
    const storage = createMemoryStorage();

    beginRun(runOf(), { storage });
    const record = completeRun(
      'inst-cust-1',
      { finishedAt: '2026-10-12T10:00:12.500Z', lastElementId: 'EndEvent_Customer' },
      { storage }
    );

    expect(record).toMatchObject({
      durationMs: 12500,
      lastElementId: 'EndEvent_Customer',
      status: 'COMPLETED',
    });
    expect(loadRuns({ storage })[0].durationMs).toBe(12500);
  });

  it('повторный финиш не переписывает уже посчитанное время', () => {
    const storage = createMemoryStorage();

    beginRun(runOf(), { storage });
    completeRun('inst-cust-1', { finishedAt: '2026-10-12T10:00:12.500Z' }, { storage });

    const repeated = completeRun(
      'inst-cust-1',
      { finishedAt: '2026-10-12T10:05:00.000Z', orderNumber: '№999' },
      { storage }
    );

    expect(repeated.durationMs).toBe(12500);
    expect(repeated.orderNumber).toBe('№101');
  });

  it('финиш по экземпляру без старта метрику не создаёт', () => {
    const storage = createMemoryStorage();

    expect(completeRun('inst-cust-unknown', {}, { storage })).toBeNull();
    expect(loadRuns({ storage })).toEqual([]);
  });

  it('номер заказа дописывается на финише, если его не было на старте', () => {
    const storage = createMemoryStorage();

    beginRun(runOf({ orderNumber: '' }), { storage });
    const record = completeRun(
      'inst-cust-1',
      { finishedAt: '2026-10-12T10:00:05.000Z', orderNumber: '№102' },
      { storage }
    );

    expect(record.orderNumber).toBe('№102');
  });

  it('в хранилище остаются последние запуски (`MAX_RUNS`)', () => {
    const storage = createMemoryStorage();

    for (let index = 0; index < MAX_RUNS + 3; index += 1) {
      beginRun(runOf({ id: `inst-cust-${index}` }), { storage });
    }

    const runs = loadRuns({ storage });

    expect(runs).toHaveLength(MAX_RUNS);
    // Новые записи идут первыми, значит вытеснены самые старые — «хвост».
    expect(runs[0].id).toBe(`inst-cust-${MAX_RUNS + 2}`);
    expect(runs.some((run) => run.id === 'inst-cust-0')).toBe(false);
  });

  it('кривые часы дают нулевое, а не отрицательное время', () => {
    const storage = createMemoryStorage();

    beginRun(runOf({ startedAt: '2026-10-12T10:00:10.000Z' }), { storage });
    const record = completeRun(
      'inst-cust-1',
      { finishedAt: '2026-10-12T10:00:00.000Z' },
      { storage }
    );

    expect(record.durationMs).toBe(0);
  });

  it('`clearRuns` забывает метрики', () => {
    const storage = createMemoryStorage();

    beginRun(runOf(), { storage });

    expect(clearRuns({ storage })).toBe(true);
    expect(loadRuns({ storage })).toEqual([]);
  });
});

describe('metricsStore: хранилище — граница с внешним миром', () => {
  it('битый JSON считается отсутствием метрики', () => {
    const storage = createMemoryStorage();
    storage.setItem(METRICS_STORAGE_KEY, '{не json');

    expect(loadRuns({ storage })).toEqual([]);
  });

  it('записи чужого формата отбрасываются', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      METRICS_STORAGE_KEY,
      JSON.stringify([runOf(), { без: 'идентификатора' }, null, 'строка'])
    );

    const runs = loadRuns({ storage });

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('inst-cust-1');
  });

  it('без хранилища функции отвечают «данных нет», а не падают', () => {
    expect(loadRuns({ storage: null })).toEqual([]);
    expect(beginRun(runOf(), { storage: null })).toBeNull();
    expect(completeRun('inst-cust-1', {}, { storage: null })).toBeNull();
    expect(clearRuns({ storage: null })).toBe(false);
  });

  it('недоступное или переполненное хранилище не бросает исключение', () => {
    const storage = createFailingStorage();
    // Мусор в хранилище читается как пустая метрика — иначе «сломанный» кэш
    // закрыл бы руководителю всю инфографику.
    expect(loadRuns({ storage })).toEqual([]);
    expect(beginRun(runOf(), { storage })).toBeNull();
    expect(completeRun('inst-cust-1', {}, { storage })).toBeNull();
    expect(clearRuns({ storage })).toBe(false);
  });
});

describe('metricsStore: агрегаты инфографики', () => {
  it('сводка считает выполненные, «в работе» и время', () => {
    const runs = [
      runOf({ id: 'a', durationMs: 4000 }),
      runOf({ id: 'b', durationMs: 8000 }),
      runOf({ id: 'c' }),
    ];

    expect(summarizeRuns(runs)).toEqual({
      total: 3,
      completedCount: 2,
      activeCount: 1,
      averageMs: 6000,
      minMs: 4000,
      maxMs: 8000,
    });
  });

  it('пустая метрика даёт сводку без времени', () => {
    expect(summarizeRuns([])).toEqual({
      total: 0,
      completedCount: 0,
      activeCount: 0,
      averageMs: null,
      minMs: null,
      maxMs: null,
    });
    expect(summarizeRuns()).toEqual(expect.objectContaining({ total: 0, averageMs: null }));
  });

  it('раскладывает запуски по процессам', () => {
    const runs = [
      runOf({ id: 'c1', org: 'CUSTOMER', processId: 'P_Customer', processName: 'Закупка' }),
      runOf({ id: 's1', org: 'SUPPLIER', processId: 'P_Supplier', processName: 'Отгрузка' }),
      runOf({ id: 'c2', org: 'CUSTOMER', processId: 'P_Customer', processName: '' }),
    ];

    const groups = groupRunsByProcess(runs);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'CUSTOMER:P_Customer', processName: 'Закупка' });
    expect(groups[0].runs.map((run) => run.id)).toEqual(['c1', 'c2']);
    expect(groups[0].summary).toMatchObject({ total: 2, completedCount: 0, activeCount: 2 });
    expect(groups[1]).toMatchObject({ key: 'SUPPLIER:P_Supplier', processName: 'Отгрузка' });
  });

  it('контур пользователя идёт первой карточкой', () => {
    const runs = [
      runOf({ id: 'c1', org: 'CUSTOMER', processId: 'P_Customer' }),
      runOf({ id: 's1', org: 'SUPPLIER', processId: 'P_Supplier' }),
    ];

    expect(groupRunsByProcess(runs, { preferredOrg: 'supplier' }).map((g) => g.key)).toEqual([
      'SUPPLIER:P_Supplier',
      'CUSTOMER:P_Customer',
    ]);
  });

  it('имя процесса берётся из записи, где оно есть', () => {
    const runs = [
      runOf({ id: 'c1', processName: '' }),
      runOf({ id: 'c2', processName: 'Закупка и приемка сырого молока' }),
    ];

    expect(groupRunsByProcess(runs)[0].processName).toBe('Закупка и приемка сырого молока');
  });

  it('столбики: последние завершённые запуски по возрастанию времени финиша', () => {
    const runs = [
      runOf({ id: 'new', durationMs: 1000, finishedAt: '2026-10-12T12:00:00.000Z' }),
      runOf({ id: 'old', durationMs: 2000, finishedAt: '2026-10-12T10:00:00.000Z' }),
      runOf({ id: 'active' }),
    ];

    // Незавершённый запуск в столбики не попадает: времени у него ещё нет.
    expect(recentCompletedRuns(runs).map((run) => run.id)).toEqual(['old', 'new']);
    expect(recentCompletedRuns(runs, 1).map((run) => run.id)).toEqual(['new']);
    expect(recentCompletedRuns(runs, 0).map((run) => run.id)).toEqual(['old', 'new']);
  });

  it('столбиков не больше `MAX_BARS`', () => {
    const runs = [];

    for (let index = 0; index < MAX_BARS + 5; index += 1) {
      runs.push(
        runOf({
          id: `run-${index}`,
          durationMs: 1000,
          finishedAt: `2026-10-12T10:${String(index).padStart(2, '0')}:00.000Z`,
        })
      );
    }

    expect(recentCompletedRuns(runs)).toHaveLength(MAX_BARS);
  });

  it('высота столбика пропорциональна времени, но не нулевая', () => {
    expect(barHeightPx(5000, 10000)).toBe(BAR_HEIGHT_PX / 2);
    expect(barHeightPx(10000, 10000)).toBe(BAR_HEIGHT_PX);
    expect(barHeightPx(0, 10000)).toBe(MIN_BAR_HEIGHT_PX);
    expect(barHeightPx(1, 1000000)).toBe(MIN_BAR_HEIGHT_PX);
    expect(barHeightPx(null, null)).toBe(MIN_BAR_HEIGHT_PX);
  });
});

describe('metricsStore: форматирование', () => {
  it('время выполнения — в миллисекундах, секундах, минутах и часах', () => {
    expect(formatDuration(0)).toBe('0 мс');
    expect(formatDuration(450)).toBe('450 мс');
    expect(formatDuration(1000)).toBe('1.0 с');
    expect(formatDuration(12500)).toBe('12.5 с');
    expect(formatDuration(45000)).toBe('45.0 с');
    expect(formatDuration(65000)).toBe('1 мин 05 с');
    expect(formatDuration(3660000)).toBe('1 ч 01 мин');
  });

  it('вместо неизвестной метрики — прочерк', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });

  it('отметка времени запуска — локальное время', () => {
    expect(formatRunTime('2026-10-12T10:00:00.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatRunTime('')).toBe('');
    expect(formatRunTime(null)).toBe('');
    expect(formatRunTime('не дата')).toBe('');
  });
});

describe('metricsStore: хранилище браузера по умолчанию', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('работает с `localStorage`, если хранилище не задано явно', () => {
    beginRun(runOf());

    expect(window.localStorage.getItem(METRICS_STORAGE_KEY)).toContain('inst-cust-1');

    completeRun('inst-cust-1', { finishedAt: '2026-10-12T10:00:05.000Z' });

    expect(loadRuns()[0].durationMs).toBe(5000);

    clearRuns();

    expect(window.localStorage.getItem(METRICS_STORAGE_KEY)).toBeNull();
  });
});
