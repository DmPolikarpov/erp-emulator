import { SOCKET_STATUS } from '../constants';
import { SOCKET_EVENTS, StatusSocket } from './wsClient';

/** WebSocket-заглушка с ручным управлением событиями. */
class FakeWebSocket {
  static instances = [];

  static reset() {
    FakeWebSocket.instances = [];
  }

  static get last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.sent = [];
    this.closed = false;

    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  dispatch(type, event = {}) {
    (this.handlers[type] || []).forEach((handler) => handler(event));
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  /* методы теста */
  open() {
    this.dispatch('open', {});
  }

  emitMessage(data) {
    this.dispatch('message', { data });
  }

  serverClose() {
    this.dispatch('close', {});
  }
}

const TOKEN_MESSAGE = JSON.stringify({
  event: 'token_updated',
  instance_id: 'inst-cust-1',
  element_id: 'Task_Approve',
  state: 'ACTIVE',
  timestamp: '2026-01-01T00:00:00Z',
});

const createSocket = (options = {}) =>
  new StatusSocket('ws://test/ws/status', {
    socketFactory: (url) => new FakeWebSocket(url),
    reconnectDelayMs: 1000,
    maxReconnectDelayMs: 4000,
    ...options,
  });

beforeEach(() => {
  FakeWebSocket.reset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('wsClient: соединение', () => {
  it('подключается и меняет статус на open', () => {
    const socket = createSocket();
    const statuses = [];
    socket.on(SOCKET_EVENTS.STATUS, (status) => statuses.push(status));

    socket.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last.url).toBe('ws://test/ws/status');
    expect(socket.status).toBe(SOCKET_STATUS.CONNECTING);
    expect(socket.connected).toBe(false);

    FakeWebSocket.last.open();

    expect(statuses).toEqual([SOCKET_STATUS.CONNECTING, SOCKET_STATUS.OPEN]);
    expect(socket.connected).toBe(true);
  });

  it('повторный connect не создаёт второй сокет', () => {
    const socket = createSocket();
    socket.connect();
    socket.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('сообщает о недоступности конструктора WebSocket', () => {
    const socket = createSocket({
      socketFactory: () => {
        throw new Error('нет WebSocket');
      },
    });
    const errors = [];
    socket.on(SOCKET_EVENTS.ERROR, (error) => errors.push(error));

    socket.connect();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('нет WebSocket');
  });
});

describe('wsClient: сообщения', () => {
  it('разбирает токены и отбрасывает audit-события', () => {
    const socket = createSocket();
    const tokens = [];
    const messages = [];
    socket.on(SOCKET_EVENTS.TOKEN, (token) => tokens.push(token));
    socket.on(SOCKET_EVENTS.MESSAGE, (message) => messages.push(message));

    socket.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.emitMessage(TOKEN_MESSAGE);
    FakeWebSocket.last.emitMessage(
      JSON.stringify({ process_id: 'Process_Demo', event_type: 'AUDIT', payload: {} })
    );

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({
      instanceId: 'inst-cust-1',
      elementId: 'Task_Approve',
      state: 'ACTIVE',
      timestamp: '2026-01-01T00:00:00Z',
      payload: null,
    });
    expect(messages).toHaveLength(2);
  });

  it('не падает на некорректном JSON', () => {
    const socket = createSocket();
    const errors = [];
    socket.on(SOCKET_EVENTS.ERROR, (error) => errors.push(error));

    socket.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.emitMessage('{ не json');

    expect(errors).toHaveLength(1);
    expect(socket.status).toBe(SOCKET_STATUS.OPEN);
  });

  it('отписка прекращает доставку', () => {
    const socket = createSocket();
    const tokens = [];
    const unsubscribe = socket.on(SOCKET_EVENTS.TOKEN, (token) => tokens.push(token));

    socket.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.emitMessage(TOKEN_MESSAGE);
    unsubscribe();
    FakeWebSocket.last.emitMessage(TOKEN_MESSAGE);

    expect(tokens).toHaveLength(1);
  });

  it('запрещает подписку на неизвестное событие', () => {
    const socket = createSocket();
    expect(() => socket.on('nope', () => {})).toThrow(/неизвестное событие/);
  });
});

describe('wsClient: отправка', () => {
  it('шлёт данные только при открытом соединении', () => {
    const socket = createSocket();

    socket.connect();
    expect(socket.send({ ping: 1 })).toBe(false);

    FakeWebSocket.last.open();
    expect(socket.send({ ping: 1 })).toBe(true);
    expect(FakeWebSocket.last.sent).toEqual(['{"ping":1}']);
    expect(socket.send('raw')).toBe(true);
    expect(FakeWebSocket.last.sent[1]).toBe('raw');
  });
});

describe('wsClient: переподключение', () => {
  it('переподключается с экспоненциальной задержкой', () => {
    const socket = createSocket();
    const statuses = [];
    socket.on(SOCKET_EVENTS.STATUS, (status) => statuses.push(status));

    socket.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.serverClose();

    expect(socket.status).toBe(SOCKET_STATUS.CLOSED);
    expect(statuses).toEqual([
      SOCKET_STATUS.CONNECTING,
      SOCKET_STATUS.OPEN,
      SOCKET_STATUS.CLOSED,
    ]);

    // первый реконнект — через 1000 мс
    jest.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // неудачная попытка увеличивает задержку вдвое
    FakeWebSocket.last.serverClose();
    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    jest.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('сбрасывает backoff после успешного подключения', () => {
    const socket = createSocket();

    socket.connect();
    FakeWebSocket.last.open();
    FakeWebSocket.last.serverClose();
    jest.advanceTimersByTime(1000);

    FakeWebSocket.last.open();
    FakeWebSocket.last.serverClose();

    jest.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('не превышает верхнюю границу задержки', () => {
    const socket = createSocket({ maxReconnectDelayMs: 1500 });

    socket.connect();
    FakeWebSocket.last.serverClose();
    jest.advanceTimersByTime(1000);

    FakeWebSocket.last.serverClose();
    jest.advanceTimersByTime(1499);
    expect(FakeWebSocket.instances).toHaveLength(2);

    jest.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('переподключается после сбоя конструктора сокета', () => {
    let failures = 0;
    const socket = createSocket({
      socketFactory: (url) => {
        if (failures < 1) {
          failures += 1;
          throw new Error('нет WebSocket');
        }
        return new FakeWebSocket(url);
      },
    });

    socket.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);

    jest.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('disconnect отключает авто-переподключение', () => {
    const socket = createSocket();

    socket.connect();
    FakeWebSocket.last.open();
    const transport = FakeWebSocket.last;

    socket.disconnect();

    expect(transport.closed).toBe(true);
    expect(socket.status).toBe(SOCKET_STATUS.CLOSED);

    transport.serverClose();
    jest.advanceTimersByTime(60000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('игнорирует события устаревшего сокета', () => {
    const socket = createSocket();
    const tokens = [];
    socket.on(SOCKET_EVENTS.TOKEN, (token) => tokens.push(token));

    socket.connect();
    const stale = FakeWebSocket.last;
    FakeWebSocket.last.open();

    socket.disconnect();
    stale.emitMessage(TOKEN_MESSAGE);
    stale.serverClose();
    jest.advanceTimersByTime(60000);

    expect(tokens).toHaveLength(0);
    expect(socket.status).toBe(SOCKET_STATUS.CLOSED);
  });

  it('позволяет подключиться снова после disconnect', () => {
    const socket = createSocket();

    socket.connect();
    FakeWebSocket.last.open();
    socket.disconnect();
    socket.connect();

    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.open();
    expect(socket.connected).toBe(true);
  });
});
