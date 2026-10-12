import { useCallback, useEffect, useRef, useState } from 'react';

import { GatewayClient } from '../client/httpClient';
import { SOCKET_EVENTS, StatusSocket } from '../client/wsClient';
import {
  DEFAULT_GATEWAY_URL,
  DEFAULT_WS_URL,
  SOCKET_STATUS,
} from '../constants';

/**
 * Фасад SDK: HTTP-клиент шлюза + WebSocket-подписка на токены.
 *
 * Инстансы создаются один раз за время жизни компонента и не зависят от
 * ре-рендеров, поэтому подписку в `useProcessTokens` можно безопасно
 * переиспользовать.
 *
 * @param {Object} [options]
 * @param {string} [options.gatewayUrl] база HTTP-шлюза.
 * @param {string} [options.wsUrl] адрес WS-шлюза.
 * @param {boolean} [options.autoConnect=true] подключаться ли автоматически.
 * @param {GatewayClient} [options.client] готовый HTTP-клиент (для тестов).
 * @param {StatusSocket} [options.socket] готовый сокет (для тестов).
 * @returns {{client: GatewayClient, socket: StatusSocket, connected: boolean,
 *            sendEvent: Function, deploySchema: Function}}
 */
export function useBpmnEngine(options = {}) {
  const {
    gatewayUrl = DEFAULT_GATEWAY_URL,
    wsUrl = DEFAULT_WS_URL,
    autoConnect = true,
    client: injectedClient,
    socket: injectedSocket,
  } = options;

  const clientRef = useRef(null);
  if (!clientRef.current) {
    clientRef.current = injectedClient || new GatewayClient(gatewayUrl);
  }

  const socketRef = useRef(null);
  if (!socketRef.current) {
    socketRef.current = injectedSocket || new StatusSocket(wsUrl);
  }

  const client = clientRef.current;
  const socket = socketRef.current;

  const [connected, setConnected] = useState(socket.connected);

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.STATUS, (status) =>
        setConnected(status === SOCKET_STATUS.OPEN)
      ),
    [socket]
  );

  useEffect(() => {
    if (!autoConnect) return undefined;

    socket.connect();
    return () => socket.disconnect();
  }, [socket, autoConnect]);

  const sendEvent = useCallback(
    (...args) => client.sendEvent(...args),
    [client]
  );

  const deploySchema = useCallback(
    (...args) => client.deploySchema(...args),
    [client]
  );

  return { client, socket, connected, sendEvent, deploySchema };
}
