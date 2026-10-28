/**
 * Клиент API заказов (M4).
 *
 * Тесты держат контракт с движком (`bpmn-engine/src/orders.rs`) и шлюзом
 * (`bpmn-gateways/http-cluster`): camelCase, коды ответов и разбор ошибок.
 * Сеть не нужна — `fetch` подменяется на каждом тесте.
 */

import {
  ORDER_STATUS,
  ORDERS_API_BASE_URL,
  OrdersClient,
  defaultDueDate,
  defaultOrderDraft,
  formatDueDate,
  mergeOrders,
  nextOrderNum,
  normalizeOrder,
  orderStatusText,
  toOrderPayload,
} from './ordersApi';

/** Серверная карточка в том виде, в каком её отдаёт `GET /api/v1/orders`. */
const SERVER_ORDER = {
  orderNum: '№101',
  status: 'IN_PROGRESS',
  nomenclature: 'Молоко питьевое, 3,2%',
  volumeLiters: 250,
  fatContent: 3.2,
  packaging: 'ПЭТ 1 л',
  dueDate: '2026-11-05',
  counterparty: 'ООО «Ромашка»',
  createdAt: '2026-10-23T09:15:00Z',
  customerInstanceId: 'inst-cust-abc123',
  customerActiveElementId: 'Task_ReceiveOrder',
  customerProcessState: 'ACTIVE',
  supplierInstanceId: null,
  supplierActiveElementId: null,
  supplierProcessState: 'IDLE',
  clientInstanceId: null,
  clientActiveElementId: null,
  clientProcessState: 'IDLE',
};

/** Ответ шлюза на успешный запрос. */
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

describe('ordersApi: нумерация и форматирование', () => {
  it('продолжает нумерацию от максимального номера, а не от длины списка', () => {
    expect(nextOrderNum([])).toBe('№101');
    expect(nextOrderNum([{ id: '№101' }, { id: '№110' }])).toBe('№111');
    // Заказ, заведённый по токену без номера, счётчик не сбивает.
    expect(nextOrderNum([{ id: 'Заказ-abc123' }, { id: '№105' }])).toBe('№106');
    expect(nextOrderNum([{ id: '№101' }], 500)).toBe('№500');
  });

  it('форматирует срок и переживает пустое значение', () => {
    expect(formatDueDate('2026-11-05')).toBe('05.11.2026');
    expect(formatDueDate('')).toBe('—');
    expect(formatDueDate(null)).toBe('—');
    // Неразобранную дату не выдумываем.
    expect(formatDueDate('05.11.2026')).toBe('05.11.2026');
  });

  it('считает срок от переданной даты, а не от «сегодня»', () => {
    expect(defaultDueDate(3, new Date('2026-10-23T00:00:00Z'))).toBe('2026-10-26');
  });

  it('приводит поля формы к контракту сервера', () => {
    const payload = toOrderPayload('№102', {
      nomenclature: '  Кефир 1%  ',
      volumeLiters: '300',
      fatContent: '1',
      packaging: ' Плёнка 0,5 л ',
      dueDate: '2026-12-01',
      counterparty: ' ООО «Ромашка» ',
    });

    expect(payload).toEqual({
      orderNum: '№102',
      nomenclature: 'Кефир 1%',
      volumeLiters: 300,
      fatContent: 1,
      packaging: 'Плёнка 0,5 л',
      dueDate: '2026-12-01',
      counterparty: 'ООО «Ромашка»',
    });
  });

  it('черновик заказа заполнен правдоподобно и полностью', () => {
    const from = new Date('2026-10-23T00:00:00Z');
    const draft = defaultOrderDraft(from);

    expect(draft.nomenclature).toContain('Молоко');
    expect(draft.volumeLiters).toBeGreaterThan(0);
    expect(draft.dueDate).toBe(defaultDueDate(3, from));
    expect(Object.keys(draft).sort()).toEqual([
      'counterparty',
      'dueDate',
      'fatContent',
      'nomenclature',
      'packaging',
      'volumeLiters',
    ]);
  });

  it('подписывает статус заказа для таблицы', () => {
    expect(orderStatusText(null)).toBe('—');
    expect(orderStatusText({ status: ORDER_STATUS.NEW })).toBe('Создан');
    expect(orderStatusText({ status: ORDER_STATUS.IN_PROGRESS })).toBe('В работе');
    // Завершённый экземпляр важнее статуса записи: процесс уже прошёл.
    expect(
      orderStatusText({ status: ORDER_STATUS.IN_PROGRESS, customerProcessState: 'COMPLETED' })
    ).toBe('Выполнен');
  });
});


describe('ordersApi: соответствие карточки кабинету', () => {
  it('раскладывает camelCase сервера в поля списка', () => {
    const order = normalizeOrder(SERVER_ORDER);

    expect(order.id).toBe('№101');
    expect(order.orderNum).toBe('№101');
    expect(order.volume).toBe('250 л');
    expect(order.volumeLiters).toBe(250);
    expect(order.fatContent).toBe(3.2);
    expect(order.nomenclature).toBe('Молоко питьевое, 3,2%');
    expect(order.dueDate).toBe('2026-11-05');
    expect(order.customerInstanceId).toBe('inst-cust-abc123');
    expect(order.customerActiveElementId).toBe('Task_ReceiveOrder');
    expect(order.supplierProcessState).toBe('IDLE');
    // Время — локальная метка для списка, а не ISO из БД.
    expect(order.createdAt).not.toBe('');
    expect(order.createdAt).not.toBe('2026-10-23T09:15:00Z');
  });

  it('не выдумывает заказ без номера и терпит пустые поля', () => {
    expect(normalizeOrder(null)).toBeNull();
    expect(normalizeOrder({ nomenclature: 'Молоко' })).toBeNull();

    const order = normalizeOrder({ orderNum: '№5' });

    expect(order.volume).toBe('—');
    expect(order.volumeLiters).toBeNull();
    expect(order.nomenclature).toBe('—');
    expect(order.status).toBe(ORDER_STATUS.NEW);
    expect(order.customerProcessState).toBe('IDLE');
  });

  it('сливает серверный список с локальным, не теряя ни одну сторону', () => {
    const local = [
      {
        ...normalizeOrder(SERVER_ORDER),
        documents: { ttnNumber: 'ТТН-1' },
        supplierInstanceId: 'inst-supp-xyz',
      },
      { id: '№102', orderNum: '№102', volume: '10 л', nomenclature: 'Йогурт' },
    ];

    const merged = mergeOrders([normalizeOrder(SERVER_ORDER)], local);

    // Серверная карточка и локальный заказ, которого сервер ещё не знает.
    expect(merged.map((order) => order.id)).toEqual(['№101', '№102']);
    // Локальные документы переживают обновление с сервера.
    expect(merged[0].documents).toEqual({ ttnNumber: 'ТТН-1' });
  });

  it('пустой шаг сервера не гасит уже подсвеченный шаг из WS', () => {
    const remote = [{ ...normalizeOrder(SERVER_ORDER), customerActiveElementId: null }];
    const local = [{ ...normalizeOrder(SERVER_ORDER), customerActiveElementId: 'Task_SendPO' }];

    expect(mergeOrders(remote, local)[0].customerActiveElementId).toBe('Task_SendPO');
  });

  it('ведёт третий контур (M5) рядом с двумя первыми', () => {
    const order = normalizeOrder({
      ...SERVER_ORDER,
      clientInstanceId: 'inst-client-abc123',
      clientActiveElementId: 'Task_ConfirmOrder',
      clientProcessState: 'ACTIVE',
    });

    expect(order.clientInstanceId).toBe('inst-client-abc123');
    expect(order.clientProcessState).toBe('ACTIVE');
    // Первые две стороны не подменяются данными клиента.
    expect(order.customerActiveElementId).toBe('Task_ReceiveOrder');
    expect(order.supplierProcessState).toBe('IDLE');

    // Старый сервер (без полей клиента) не ломает карточку.
    expect(normalizeOrder(SERVER_ORDER).clientProcessState).toBe('IDLE');
  });

  it('шаг клиента из WS переживает пустой ответ сервера', () => {
    const remote = [{ ...normalizeOrder(SERVER_ORDER), clientActiveElementId: null }];
    const local = [
      { ...normalizeOrder(SERVER_ORDER), clientActiveElementId: 'Task_AcceptGoods' },
    ];

    expect(mergeOrders(remote, local)[0].clientActiveElementId).toBe('Task_AcceptGoods');
  });
});
describe('ordersApi: HTTP-клиент', () => {
  it('по умолчанию ходит в REST-путь шлюза', () => {
    expect(ORDERS_API_BASE_URL).toBe('/api/v1/orders');
  });

  it('читает список заказов', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ orders: [SERVER_ORDER] }));
    const client = new OrdersClient('http://gateway/api/v1/orders/', { fetchImpl });

    const result = await client.listOrders();

    expect(result.ok).toBe(true);
    expect(result.orders).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://gateway/api/v1/orders',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('создаёт заказ POST-ом с JSON-телом', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ order: SERVER_ORDER }, 201));
    const client = new OrdersClient('', { fetchImpl });
    const payload = toOrderPayload('№101', defaultOrderDraft());

    const result = await client.createOrder(payload);

    expect(result.ok).toBe(true);
    expect(result.order.orderNum).toBe('№101');

    const [url, options] = fetchImpl.mock.calls[0];

    expect(url).toBe('/api/v1/orders');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options.body)).toEqual(payload);
  });

  it('привязывает экземпляр к заказу и кодирует номер в пути', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ order: SERVER_ORDER }));
    const client = new OrdersClient('', { fetchImpl });

    const result = await client.attachInstance('№101', 'CUSTOMER', 'inst-cust-abc123');

    expect(result.ok).toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];

    expect(url).toBe(`/api/v1/orders/${encodeURIComponent('№101')}/instances`);
    expect(JSON.parse(options.body)).toEqual({
      org: 'CUSTOMER',
      instanceId: 'inst-cust-abc123',
    });
  });

  it('разбирает 400 с ошибками полей и 409 как «заказ уже есть»', async () => {
    const validation = new OrdersClient('', {
      fetchImpl: jest.fn(async () =>
        jsonResponse(
          {
            error: 'validation failed',
            details: [
              { field: 'volumeLiters', message: 'должен быть больше 0' },
              { field: 'dueDate', message: 'дата в прошлом' },
            ],
          },
          400
        )
      ),
    });

    const invalid = await validation.createOrder({});

    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe(400);
    expect(invalid.details).toBe(
      'volumeLiters: должен быть больше 0; dueDate: дата в прошлом'
    );

    const conflict = new OrdersClient('', {
      fetchImpl: jest.fn(async () =>
        jsonResponse({ error: 'order already exists', details: '№101' }, 409)
      ),
    });

    const duplicate = await conflict.createOrder({ orderNum: '№101' });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.status).toBe(409);
    expect(duplicate.details).toContain('order already exists');
  });

  it('не бросает исключений, когда API недоступен или медлит', async () => {
    const offline = new OrdersClient('', {
      fetchImpl: jest.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });

    expect(await offline.listOrders()).toEqual({
      ok: false,
      error: 'API заказов недоступен.',
    });

    // `AbortController` из jsdom: таймаут превращается в понятную ошибку,
    // иначе кабинет «завис» бы на кнопке создания заказа.
    jest.useFakeTimers();

    try {
      const slow = new OrdersClient('', {
        fetchImpl: (url, options) =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
        timeoutMs: 50,
      });

      const pending = slow.listOrders();
      jest.advanceTimersByTime(60);

      expect(await pending).toEqual({
        ok: false,
        error: 'API заказов не ответил за 50 мс.',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('без fetch работает в демо-режиме', async () => {
    const client = new OrdersClient('', { fetchImpl: null });

    // Конструктор подставляет `globalThis.fetch`, поэтому «нет fetch» проверяем
    // через явно пустую реализацию.
    client.fetchImpl = null;

    expect(await client.listOrders()).toEqual({
      ok: false,
      error: 'fetch недоступен: заказы останутся локальными.',
    });
  });
});

