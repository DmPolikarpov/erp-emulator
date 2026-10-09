/**
 * Константы BPMN Client SDK.
 *
 * Значения согласованы с бэкендом оркестратора:
 *  - HTTP-шлюз   -> bpmn-gateways/http-cluster/index.js
 *  - WS-шлюз     -> bpmn-gateways/websocket-cluster/index.js
 *  - события     -> bpmn-engine/src/events.rs, nats_client.rs, main.rs
 */

/* ------------------------------------------------------------------ *
 * Транспорт
 * ------------------------------------------------------------------ */

/**
 * Базовый URL коллекции экземпляров HTTP-шлюза.
 *
 * `REACT_APP_GATEWAY_URL` в `.env` уже содержит сегмент `/instances`
 * (`http://localhost:8080/api/v1/process/instances`). Строка без этого
 * сегмента тоже допустима — `GatewayClient` достраивает его сам.
 * Значение по умолчанию — относительный путь через CRA-прокси
 * (`erp-simulator/package.json: proxy -> http://localhost:8080`).
 */
export const DEFAULT_GATEWAY_URL =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_GATEWAY_URL) ||
  '/api/v1/process/instances';

/** URL WebSocket-шлюза раздачи статусов токенов. */
export const DEFAULT_WS_URL =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_WS_URL) ||
  'ws://localhost:8081/ws/status';

/** Сегмент коллекции экземпляров в пути HTTP-шлюза. */
export const EVENTS_SEGMENT = 'instances';

/** Сегмент приёма событий: `${baseUrl}/:instanceId/${EVENTS_SUFFIX}`. */
export const EVENTS_SUFFIX = 'events';

/** Таймаут HTTP-запроса, мс. */
export const REQUEST_TIMEOUT_MS = 15000;

/* ------------------------------------------------------------------ *
 * Движок: события и служебные идентификаторы
 * ------------------------------------------------------------------ */

/** Имена событий, которые клиент отправляет в оркестратор. */
export const ENGINE_EVENTS = {
  /** Публикация (деплой) BPMN-схемы в кластер. */
  DEPLOY_SCHEMA: 'DeploySchema',
  /** Старт нового экземпляра процесса. */
  START_PROCESS: 'StartProcess',
};

/** Идентификаторы служебных элементов для инфраструктурных событий. */
export const ENGINE_ELEMENTS = {
  PROCESS_DEPLOYMENT: 'Process_Deployment',
};

/** Префиксы идентификаторов экземпляров процессов. */
export const INSTANCE_PREFIX = {
  CUSTOMER: 'inst-cust-',
  SUPPLIER: 'inst-supp-',
  DEPLOY: 'inst-deploy-',
  DEFINITION: 'inst-def-',
};

/** Организации (стороны обмена). */
export const ORG_TYPES = {
  CUSTOMER: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
};

/* ------------------------------------------------------------------ *
 * Движок: состояния токенов
 * ------------------------------------------------------------------ */

/**
 * Состояния токена, публикуемые движком в `mes.bpmn.v1.event`.
 * @see bpmn-engine/src/nats_client.rs
 */
export const TOKEN_STATES = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
};

export const TOKEN_STATE_LIST = Object.values(TOKEN_STATES);

/** Имя WS-сообщения о перемещении токена. Всё остальное — audit-события. */
export const WS_MESSAGE_EVENT = 'token_updated';

/** Подписка WS-шлюза на NATS (только для документации). */
export const WS_NATS_SUBJECT = 'mes.bpmn.v1.event.>';

/* ------------------------------------------------------------------ *
 * WebSocket: состояния и реконнект
 * ------------------------------------------------------------------ */

export const SOCKET_STATUS = {
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSED: 'closed',
};

/** Задержка первой попытки переподключения, мс. */
export const WS_RECONNECT_DELAY_MS = 3000;

/** Верхняя граница экспоненциального backoff, мс. */
export const WS_MAX_RECONNECT_DELAY_MS = 30000;

/* ------------------------------------------------------------------ *
 * UI / BPMN
 * ------------------------------------------------------------------ */

/** Базовый CSS-класс подсветки токена. */
export const BPMN_TOKEN_BASE_CLASS = 'bpmn-sdk-token';

/** CSS-класс подсветки по состоянию токена. */
export const BPMN_TOKEN_CLASS = {
  [TOKEN_STATES.ACTIVE]: `${BPMN_TOKEN_BASE_CLASS}--active`,
  [TOKEN_STATES.COMPLETED]: `${BPMN_TOKEN_BASE_CLASS}--completed`,
  [TOKEN_STATES.FAILED]: `${BPMN_TOKEN_BASE_CLASS}--failed`,
  [TOKEN_STATES.TIMED_OUT]: `${BPMN_TOKEN_BASE_CLASS}--timed-out`,
};

/** Устаревший класс подсветки (совместимость с прежним `BpmnView`). */
export const BPMN_LEGACY_ACTIVE_CLASS = 'active-node-highlight';

/** Задержка дебаунса для `onChange` редактора, мс. */
export const XML_CHANGE_DEBOUNCE_MS = 400;

/** Допустимый идентификатор элемента (он же `element_id` для движка). */
export const ELEMENT_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Коды ошибок SDK. */
export const ERROR_KINDS = {
  HTTP: 'http',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  PARSE: 'parse',
  SOCKET: 'socket',
};
