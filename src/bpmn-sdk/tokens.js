/**
 * Чистая логика работы с токенами процесса.
 *
 * Модуль намеренно не зависит ни от `bpmn-js`, ни от React: это позволяет
 * тестировать фильтрацию WS-сообщений и подсветку в `jsdom` без
 * тяжёлого ESM-пакета `bpmn-js` (он не транспилируется Jest-ом CRA).
 *
 * @see bpmn-engine/src/nats_client.rs — формат публикуемых сообщений
 */

import {
  BPMN_TOKEN_BASE_CLASS,
  BPMN_TOKEN_CLASS,
  INSTANCE_PREFIX,
  TOKEN_STATE_LIST,
  TOKEN_STATES,
  WS_MESSAGE_EVENT,
} from './constants';

/** Известно ли движку такое состояние токена. */
export function isKnownTokenState(state) {
  return TOKEN_STATE_LIST.indexOf(state) !== -1;
}

/** Служебный экземпляр, созданный для публикации схемы (деплоя). */
export function isDeployInstanceId(instanceId) {
  return (
    typeof instanceId === 'string' && instanceId.startsWith(INSTANCE_PREFIX.DEPLOY)
  );
}

/**
 * Идентификатор служебного экземпляра деплоя: `inst-deploy-<org>`.
 * @see GatewayClient#deploySchema — bpmn-engine/src/main.rs
 */
export function deployInstanceId(orgType) {
  return `${INSTANCE_PREFIX.DEPLOY}${String(orgType || '').toLowerCase()}`;
}

/**
 * Разбирает и валидирует сообщение WebSocket.
 *
 * WS-шлюз (`websocket-cluster`) транслирует всё, что попадает в
 * `mes.bpmn.v1.event.>`: и обновления токенов, и аудит-события движка
 * (`{process_id, event_type, payload}`). Для подсветки интересны только
 * сообщения с `event === 'token_updated'`.
 *
 * @param {string|Object} raw текст или уже разобранный объект сообщения
 * @returns {{instanceId: string, elementId: string, state: string,
 *            timestamp: string|null, payload: Object|null}|null}
 */
export function parseTokenMessage(raw) {
  let data = raw;

  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  if (!data || typeof data !== 'object') return null;
  if (data.event !== WS_MESSAGE_EVENT) return null;

  const instanceId = data.instance_id;
  const elementId = data.element_id;
  const { state } = data;

  if (!instanceId || !elementId || !isKnownTokenState(state)) return null;

  return {
    instanceId,
    elementId,
    state,
    timestamp: data.timestamp || null,
    payload: data.payload || null,
  };
}

/**
 * CSS-классы подсветки узла для состояния токена.
 *
 * diagram-js навешивает маркеры по одному классу за вызов
 * (`Canvas#addMarker` → `svgClasses(gfx).add(marker)`), а правила
 * `bpmn-sdk.css` написаны парой «базовый класс + модификатор состояния»:
 * `.bpmn-sdk-token` объявляет переменные и применяет `fill`/`stroke`,
 * `.bpmn-sdk-token--active` выбирает цвет состояния и анимацию. Без базового
 * класса заливка и обводка узла не применялись: от подсветки оставалась
 * только анимация `ACTIVE`, а `COMPLETED`/`FAILED`/`TIMED_OUT` не были видны
 * совсем — на схеме «не подсвечивался активный блок».
 *
 * @param {string} state состояние токена (`TOKEN_STATES`).
 * @returns {string[]} классы для `canvas.addMarker` (`[]`, если состояния нет).
 */
export function tokenMarkerClasses(state) {
  const modifier = BPMN_TOKEN_CLASS[state];

  return modifier ? [BPMN_TOKEN_BASE_CLASS, modifier] : [];
}

/**
 * Сводит карту токенов и устаревший проп `activeElementId` в карту
 * «идентификатор элемента -> CSS-классы подсветки».
 *
 * Классов на элемент несколько (базовый + модификатор состояния), потому что
 * `canvas.addMarker` навешивает ровно один класс за вызов: см.
 * `tokenMarkerClasses`.
 *
 * @param {Object<string, string>} [tokens] карта `element_id -> состояние`
 * @param {string|null} [activeElementId] идентификатор активного узла (legacy)
 * @returns {Object<string, string[]>} карта `element_id -> классы`
 */
export function resolveTokenMap(tokens, activeElementId) {
  const map = {};

  if (tokens && typeof tokens === 'object') {
    Object.keys(tokens).forEach((elementId) => {
      const classNames = tokenMarkerClasses(tokens[elementId]);
      if (elementId && classNames.length > 0) map[elementId] = classNames;
    });
  }

  // Обратная совместимость: раньше просмотрщик принимал только один
  // активный узел и всегда подсвечивал его как ACTIVE.
  if (activeElementId && !map[activeElementId]) {
    map[activeElementId] = tokenMarkerClasses(TOKEN_STATES.ACTIVE);
  }

  return map;
}

/**
 * Иммутабельно применяет обновление токена к карте состояний.
 * Неизвестное состояние снимает подсветку с элемента.
 */
export function applyTokenUpdate(tokens, elementId, state) {
  if (!elementId) return tokens || {};

  const next = { ...(tokens || {}) };

  if (!isKnownTokenState(state)) {
    delete next[elementId];
    return next;
  }

  next[elementId] = state;
  return next;
}

/** Идентификаторы узлов, на которых сейчас стоит токен (ACTIVE). */
export function collectActiveElementIds(tokens) {
  if (!tokens || typeof tokens !== 'object') return [];

  return Object.keys(tokens).filter(
    (elementId) => tokens[elementId] === TOKEN_STATES.ACTIVE
  );
}
