/**
 * Хуки BPMN Client SDK.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { SOCKET_EVENTS } from '../client/wsClient';
import {
  applyTokenUpdate,
  collectActiveElementIds,
  isDeployInstanceId,
} from '../tokens';

const EMPTY_TOKENS = {};

/** Приводит вход к массиву непустых идентификаторов экземпляров. */
export function toInstanceIdList(instanceIds) {
  if (!instanceIds) return [];

  const list = Array.isArray(instanceIds) ? instanceIds : [instanceIds];
  return list.filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Накапливает состояния токенов по экземплярам процессов.
 *
 * Подписка одна на всё приложение: WS-шлюз широковещательный и отдаёт
 * события всех экземпляров сразу, поэтому фильтрация выполняется здесь.
 *
 * @param {import('../client/wsClient').StatusSocket|null} socket
 * @param {string|string[]} [instanceIds] интересующие экземпляры;
 *   пустой список — принимать все (кроме служебных, см. `options`).
 * @param {Object} [options]
 * @param {boolean} [options.includeDeployInstances=false] принимать ли
 *   события служебных экземпляров деплоя (`inst-deploy-*`).
 * @returns {{
 *   tokensByInstance: Object<string, Object<string, string>>,
 *   tokensFor: (instanceId: string) => Object<string, string>,
 *   activeElementsFor: (instanceId: string) => string[],
 *   lastEvent: Object|null,
 *   reset: () => void
 * }}
 */
export function useProcessTokens(socket, instanceIds, options = {}) {
  const { includeDeployInstances = false } = options;

  const ids = useMemo(() => toInstanceIdList(instanceIds), [instanceIds]);
  const idsKey = ids.join('|');

  const [tokensByInstance, setTokensByInstance] = useState({});
  const [lastEvent, setLastEvent] = useState(null);

  useEffect(() => {
    if (!socket) return undefined;

    const filter = idsKey ? idsKey.split('|') : [];

    return socket.on(SOCKET_EVENTS.TOKEN, (message) => {
      if (!includeDeployInstances && isDeployInstanceId(message.instanceId)) return;
      if (filter.length > 0 && filter.indexOf(message.instanceId) === -1) return;

      setTokensByInstance((previous) => ({
        ...previous,
        [message.instanceId]: applyTokenUpdate(
          previous[message.instanceId],
          message.elementId,
          message.state
        ),
      }));
      setLastEvent(message);
    });
  }, [socket, idsKey, includeDeployInstances]);

  const reset = useCallback(() => {
    setTokensByInstance({});
    setLastEvent(null);
  }, []);

  const tokensFor = useCallback(
    (instanceId) => tokensByInstance[instanceId] || EMPTY_TOKENS,
    [tokensByInstance]
  );

  const activeElementsFor = useCallback(
    (instanceId) => collectActiveElementIds(tokensByInstance[instanceId]),
    [tokensByInstance]
  );

  return { tokensByInstance, tokensFor, activeElementsFor, lastEvent, reset };
}
