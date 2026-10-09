/**
 * WebSocket-клиент шлюза состояний.
 *
 * Транслирует сообщения движка (`token_updated`) в события `token`,
 * самостоятельно переподключается с экспоненциальным backoff и
 * различает валидные сообщения токенов и audit-события.
 *
 * @see bpmn-gateways/websocket-cluster/index.js
 */

import {
  DEFAULT_WS_URL,
  SOCKET_STATUS,
  WS_MAX_RECONNECT_DELAY_MS,
  WS_RECONNECT_DELAY_MS,
} from '../constants';
import { parseTokenMessage } from '../tokens';

/** События, которые умеет рассылать сокет. */
export const SOCKET_EVENTS = {
  /** Разобранное сообщение о перемещении токена. */
  TOKEN: 'token',
  /** Любое разобранное JSON-сообщение шлюза. */
  MESSAGE: 'message',
  /** Изменился статус соединения (`SOCKET_STATUS`). */
  STATUS: 'status',
  /** Транспортная ошибка. */
  ERROR: 'error',
};

export class StatusSocket {
  /**
   * @param {string} [url] адрес WS-шлюза (`ws://host/ws/status`).
   * @param {Object} [options]
   * @param {Function} [options.socketFactory] конструктор WebSocket (для тестов).
   * @param {number} [options.reconnectDelayMs] первая задержка реконнекта.
   * @param {number} [options.maxReconnectDelayMs] предел backoff.
   */
  constructor(url = DEFAULT_WS_URL, options = {}) {
    this.url = url;
    this.socketFactory =
      options.socketFactory || ((socketUrl) => new WebSocket(socketUrl));
    this.reconnectDelayMs =
      typeof options.reconnectDelayMs === 'number'
        ? options.reconnectDelayMs
        : WS_RECONNECT_DELAY_MS;
    this.maxReconnectDelayMs =
      typeof options.maxReconnectDelayMs === 'number'
        ? options.maxReconnectDelayMs
        : WS_MAX_RECONNECT_DELAY_MS;

    this.listeners = {
      [SOCKET_EVENTS.TOKEN]: new Set(),
      [SOCKET_EVENTS.MESSAGE]: new Set(),
      [SOCKET_EVENTS.STATUS]: new Set(),
      [SOCKET_EVENTS.ERROR]: new Set(),
    };

    this.socket = null;
    this.socketHandlers = null;
    this.status = SOCKET_STATUS.CLOSED;
    this.shouldReconnect = false;
    this.attempts = 0;
    this.reconnectTimer = null;
  }

  /** `true`, если соединение установлено. */
  get connected() {
    return this.status === SOCKET_STATUS.OPEN;
  }

  /** Подписка на событие. Возвращает функцию отписки. */
  on(event, listener) {
    const bucket = this.listeners[event];
    if (!bucket) throw new Error(`StatusSocket: неизвестное событие «${event}»`);

    bucket.add(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    const bucket = this.listeners[event];
    if (bucket) bucket.delete(listener);
  }

  emit(event, payload) {
    const bucket = this.listeners[event];
    if (!bucket) return;

    bucket.forEach((listener) => {
      try {
        listener(payload);
      } catch (e) {
        // Ошибка слушателя не должна ломать транспорт.
        // eslint-disable-next-line no-console
        console.error(`StatusSocket: ошибка слушателя «${event}»`, e);
      }
    });
  }

  /** Открывает соединение и включает авто-переподключение. */
  connect() {
    if (this.socket || this.status === SOCKET_STATUS.CONNECTING) return;

    this.shouldReconnect = true;
    this.open();
  }

  /** Закрывает соединение и отключает авто-переподключение. */
  disconnect() {
    this.shouldReconnect = false;
    this.attempts = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.socket;
    this.socket = null;
    this.socketHandlers = null;

    if (socket) {
      try {
        socket.close();
      } catch (e) {
        // Сокет мог быть уже закрыт.
      }
    }

    this.setStatus(SOCKET_STATUS.CLOSED);
  }

  /** @returns {boolean} удалось ли отправить сообщение. */
  send(data) {
    const socket = this.socket;
    if (!socket || this.status !== SOCKET_STATUS.OPEN) return false;

    try {
      socket.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    } catch (e) {
      this.emit(SOCKET_EVENTS.ERROR, e);
      return false;
    }
  }

  open() {
    this.setStatus(SOCKET_STATUS.CONNECTING);

    let socket;
    try {
      socket = this.socketFactory(this.url);
    } catch (error) {
      this.emit(SOCKET_EVENTS.ERROR, error);
      this.scheduleReconnect();
      return;
    }

    const handlers = {
      open: () => this.handleOpen(socket),
      message: (event) => this.handleMessage(socket, event),
      close: () => this.handleClose(socket),
      error: (event) => this.handleError(socket, event),
    };

    this.socket = socket;
    this.socketHandlers = handlers;

    socket.addEventListener('open', handlers.open);
    socket.addEventListener('message', handlers.message);
    socket.addEventListener('close', handlers.close);
    socket.addEventListener('error', handlers.error);
  }

  setStatus(status) {
    if (this.status === status) return;

    this.status = status;
    this.emit(SOCKET_EVENTS.STATUS, status);
  }

  handleOpen(socket) {
    if (socket !== this.socket) return;

    this.attempts = 0;
    this.setStatus(SOCKET_STATUS.OPEN);
  }

  handleMessage(socket, event) {
    if (socket !== this.socket) return;

    let data;
    try {
      data = JSON.parse(
        typeof event.data === 'string' ? event.data : String(event.data)
      );
    } catch (e) {
      this.emit(SOCKET_EVENTS.ERROR, e);
      return;
    }

    this.emit(SOCKET_EVENTS.MESSAGE, data);

    const token = parseTokenMessage(data);
    if (token) this.emit(SOCKET_EVENTS.TOKEN, token);
  }

  handleClose(socket) {
    if (socket !== this.socket) return;

    this.socket = null;
    this.socketHandlers = null;
    this.setStatus(SOCKET_STATUS.CLOSED);

    if (this.shouldReconnect) this.scheduleReconnect();
  }

  handleError(socket, event) {
    if (socket !== this.socket) return;

    this.emit(SOCKET_EVENTS.ERROR, event);
  }

  scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return;

    const delay = Math.min(
      this.reconnectDelayMs * Math.pow(2, this.attempts),
      this.maxReconnectDelayMs
    );
    this.attempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.open();
    }, delay);
  }
}
