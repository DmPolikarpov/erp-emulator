/**
 * Клиент API заказов (M4).
 *
 * Заказ — это запись в БД движка, а не `useState` кабинета: список переживает
 * F5 и общий для всех браузеров. REST-путь обслуживает HTTP-шлюз
 * (`bpmn-gateways/http-cluster/index.js`), который перекладывает запрос в
 * NATS `mes.in.v1.api.orders`.
 *
 * Контракт сервера — camelCase (`orderNum`, `volumeLiters`, `dueDate`, …).
 * Все методы возвращают `{ok, ...}` и не бросают исключений: кабинет работает
 * и без API — заказ тогда остаётся локальным (демо-режим).
 *
 * @see bpmn-engine/src/orders.rs — модель, валидация и коды ошибок
 */

/** Базовый URL API заказов; в dev он уходит в CRA-прокси на шлюз. */
export const ORDERS_API_BASE_URL =
  process.env.REACT_APP_ORDERS_API_URL || '/api/v1/orders';

/** Таймаут запроса: дольше ждать ответа NATS смысла нет. */
export const ORDERS_TIMEOUT_MS = 8000;

/** Статусы заказа из БД движка. */
export const ORDER_STATUS = {
  NEW: 'NEW',
  IN_PROGRESS: 'IN_PROGRESS',
};

/** Состояние контура, у которого ещё нет экземпляра процесса. */
const IDLE = 'IDLE';

/** Подпись статуса для таблицы заказов. */
export function orderStatusText(order) {
  if (!order) return '—';
  if (order.customerProcessState === 'COMPLETED') return 'Выполнен';
  if (order.status === ORDER_STATUS.IN_PROGRESS) return 'В работе';
  return 'Создан';
}

/** `2026-11-05` → `05.11.2026`; неразобранную дату отдаём как есть. */
export function formatDueDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value || '—';
}

/** Дата через `days` дней от сегодняшней — значение по умолчанию для формы. */
export function defaultDueDate(days = 3, from = new Date()) {
  const date = new Date(from.getTime());
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Черновик заказа для формы «Принять заказ клиента».
 *
 * Демо подставляет правдоподобную номенклатуру, но все поля редактируются:
 * фиксированного «100 Л» без номенклатуры больше нет (M4).
 */
export function defaultOrderDraft(from = new Date()) {
  return {
    nomenclature: 'Молоко питьевое, 3,2%',
    volumeLiters: 100,
    fatContent: 3.2,
    packaging: 'ПЭТ 1 л',
    dueDate: defaultDueDate(3, from),
    counterparty: 'ООО «Ромашка»',
  };
}

/** Приводит поля формы к числам: `<input type="number">` отдаёт строки. */
export function toOrderPayload(orderNum, draft) {
  return {
    orderNum,
    nomenclature: String(draft.nomenclature || '').trim(),
    volumeLiters: Number(draft.volumeLiters),
    fatContent: Number(draft.fatContent),
    packaging: String(draft.packaging || '').trim(),
    dueDate: String(draft.dueDate || '').trim(),
    counterparty: String(draft.counterparty || '').trim(),
  };
}

/**
 * Следующий номер заказа: максимум по уже известным (`№101` → `№102`).
 *
 * После F5 список приходит с сервера, поэтому нумерация продолжается, а не
 * начинается заново с `orders.length` — иначе два браузера создали бы заказы
 * с одним бизнес-ключом.
 */
export function nextOrderNum(orders, start = 101) {
  const max = (Array.isArray(orders) ? orders : []).reduce((current, order) => {
    const match = /№(\d+)/.exec(String(order && order.id ? order.id : ''));
    return match ? Math.max(current, Number(match[1])) : current;
  }, start - 1);

  return `№${max + 1}`;
}

/**
 * Заказ сервера → заказ кабинета.
 *
 * В кабинете исторически `id` и `volume` — строки для списка, поэтому серверные
 * поля дополняются, а не заменяются: WS-обработчики продолжают работать с
 * `id`/`volume` как раньше.
 */
export function normalizeOrder(serverOrder) {
  if (!serverOrder || !serverOrder.orderNum) return null;

  const volumeLiters = Number(serverOrder.volumeLiters);
  const createdAt = serverOrder.createdAt ? new Date(serverOrder.createdAt) : null;

  return {
    id: serverOrder.orderNum,
    orderNum: serverOrder.orderNum,
    createdAt:
      createdAt && !Number.isNaN(createdAt.getTime())
        ? createdAt.toLocaleTimeString('ru-RU')
        : '—',
    volume: Number.isFinite(volumeLiters) ? `${volumeLiters} л` : '—',
    volumeLiters: Number.isFinite(volumeLiters) ? volumeLiters : null,
    nomenclature: serverOrder.nomenclature || '—',
    fatContent: Number.isFinite(Number(serverOrder.fatContent))
      ? Number(serverOrder.fatContent)
      : null,
    packaging: serverOrder.packaging || '—',
    dueDate: serverOrder.dueDate || '',
    counterparty: serverOrder.counterparty || '—',
    status: serverOrder.status || ORDER_STATUS.NEW,
    customerInstanceId: serverOrder.customerInstanceId || null,
    customerActiveElementId: serverOrder.customerActiveElementId || null,
    customerProcessState: serverOrder.customerProcessState || IDLE,
    supplierInstanceId: serverOrder.supplierInstanceId || null,
    supplierActiveElementId: serverOrder.supplierActiveElementId || null,
    supplierProcessState: serverOrder.supplierProcessState || IDLE,
    // Поля, которые живут только в кабинете (документы, пропуск, время): WS
    // дописывает их, сервер о них не знает.
    documents: null,
    passData: null,
    shippedAt: null,
    entryTime: null,
    checkedAt: null,
  };
}

/**
 * Слияние серверного списка с локальным.
 *
 * Сервер — источник истины по предметным полям и текущим шагам, но локальные
 * записи, которых сервер ещё не знает (только что созданный заказ, WS-кадр
 * раньше ответа HTTP), не теряются. Локальные «документы» сохраняются поверх
 * серверной карточки.
 */
export function mergeOrders(remoteOrders, localOrders) {
  const local = Array.isArray(localOrders) ? localOrders : [];
  const remote = Array.isArray(remoteOrders) ? remoteOrders : [];
  const byId = new Map(local.map((order) => [order.id, order]));

  const merged = remote.map((order) => {
    const current = byId.get(order.id);
    if (!current) return order;

    byId.delete(order.id);

    return {
      ...order,
      documents: current.documents ?? order.documents,
      passData: current.passData ?? order.passData,
      shippedAt: current.shippedAt ?? order.shippedAt,
      entryTime: current.entryTime ?? order.entryTime,
      checkedAt: current.checkedAt ?? order.checkedAt,
      // Текущий шаг из WS может опередить БД: пустое серверное значение не
      // должно гасить уже подсвеченный шаг.
      customerActiveElementId:
        order.customerActiveElementId || current.customerActiveElementId || null,
      supplierActiveElementId:
        order.supplierActiveElementId || current.supplierActiveElementId || null,
    };
  });

  return [...merged, ...byId.values()];
}

/** Достаёт причину отказа из ответа шлюза (JSON или текст). */
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
    return null;
  }
}

/**
 * Клиент API заказов.
 *
 * `fetchImpl` и `timeoutMs` подменяются в тестах; в браузере — глобальный
 * `fetch` и `ORDERS_TIMEOUT_MS`.
 */
export class OrdersClient {
  constructor(baseUrl = ORDERS_API_BASE_URL, options = {}) {
    this.baseUrl = String(baseUrl || ORDERS_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : ORDERS_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ||
      (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  /** Общий вызов: JSON-тело, таймаут и разбор отказа в `{ok:false}`. */
  async request(path, { method = 'GET', body } = {}) {
    if (!this.fetchImpl) {
      return { ok: false, error: 'fetch недоступен: заказы останутся локальными.' };
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `API заказов вернул ошибку (${response.status})`,
          details: await readFailure(response),
        };
      }

      const data = await response.json().catch(() => ({}));
      return { ok: true, status: response.status, data };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return {
          ok: false,
          error: `API заказов не ответил за ${this.timeoutMs} мс.`,
        };
      }

      return { ok: false, error: 'API заказов недоступен.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** `GET /api/v1/orders` → `{ok, orders}`. */
  async listOrders() {
    const result = await this.request('');
    if (!result.ok) return result;

    return { ok: true, orders: result.data.orders || [] };
  }

  /** `GET /api/v1/orders/:orderNum` → `{ok, order}`. */
  async getOrder(orderNum) {
    if (!orderNum) return { ok: false, error: 'Не указан номер заказа.' };

    const result = await this.request(`/${encodeURIComponent(orderNum)}`);
    if (!result.ok) return result;

    return { ok: true, order: result.data.order || null };
  }

  /** `POST /api/v1/orders` → `{ok, order}`; 409 — заказ уже есть. */
  async createOrder(order) {
    const result = await this.request('', { method: 'POST', body: order });
    if (!result.ok) return result;

    return { ok: true, order: result.data.order || null };
  }

  /** `POST /api/v1/orders/:orderNum/instances` — привязка экземпляра. */
  async attachInstance(orderNum, org, instanceId) {
    if (!orderNum || !instanceId) {
      return { ok: false, error: 'Не указан заказ или экземпляр процесса.' };
    }

    const result = await this.request(
      `/${encodeURIComponent(orderNum)}/instances`,
      { method: 'POST', body: { org, instanceId } }
    );
    if (!result.ok) return result;

    return { ok: true, order: result.data.order || null };
  }
}

/** Клиент по умолчанию: приложение использует его без настройки. */
export const ordersClient = new OrdersClient();
