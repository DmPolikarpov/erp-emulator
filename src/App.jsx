import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BpmnEditor,
  BpmnViewer,
  DEFAULT_ACTION_EVENT,
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_GATEWAY_URL,
  DEFAULT_PROJECT_BPMN_XML,
  DEFAULT_SUPPLIER_BPMN_XML,
  DAIRY_PLANT_PROJECT_NAME,
  DAIRY_PLANT_PROJECT_XML,
  ENGINE_EVENTS,
  INSTANCE_PREFIX,
  SOCKET_EVENTS,
  TOKEN_STATES,
  createUuid,
  extractProcessXml,
  getElementRole,
  getLocalName,
  getOutgoingTargetIds,
  getProcessIds,
  getProjectProcesses,
  getStartAction,
  isDeployInstanceId,
  listActions,
  listFlowElements,
  parseActionVariables,
  parseXml,
  replaceProcessXml,
  resolveAction,
  useBpmnEngine,
  useProcessTokens,
  validateEngineSchema,
} from './vendor/bpmn-sdk';
import { 
  Truck, ShieldCheck, ClipboardCheck, FileText, Upload, Send, 
  LogOut, History, KeyRound, Layers, PlusCircle, BarChart2,
  PackageCheck, Clock, CheckCircle2, Loader2, AlertCircle, Pencil,
  Save, RotateCcw, FolderOpen, FolderPlus, Trash2, ArrowLeft, Play, Factory
} from 'lucide-react';
import { MetricsPanel } from './MetricsPanel';
import { CONTOUR_LABELS, analyzeProject, findUser } from './projectRoles';
import {
  beginRun,
  clearRuns,
  completeRun,
  formatDuration,
  loadRuns,
} from './metricsStore';
import {
  MEMORY_PROJECT_ID,
  createProject,
  deleteProject,
  ensureDefaultProject,
  formatProjectSavedAt,
  listProjects,
  setActiveProjectId,
  updateProject,
} from './projectStore';
import {
  ORDER_STATUS,
  defaultOrderDraft,
  formatDueDate,
  mergeOrders,
  nextOrderNum,
  normalizeOrder,
  orderStatusText,
  ordersClient,
  toOrderPayload,
} from './ordersApi';

// Базовый URL API Gateway: `REACT_APP_GATEWAY_URL` (см. `.env`) либо
// относительный путь — тогда запросы идут через CRA-прокси (`package.json`).
const API_BASE_URL = DEFAULT_GATEWAY_URL;

/**
 * Демо-схемы SDK по контурам — точка отсчёта кнопки «Демо-схема».
 *
 * В проекте нарезки процессов строятся из общей схемы (`extractProcessXml`),
 * а сброс одного контура возвращает его демо-процесс (`replaceProcessXml`).
 */
const DEFAULT_SCHEMA_BY_ORG = {
  CUSTOMER: DEFAULT_CUSTOMER_BPMN_XML,
  SUPPLIER: DEFAULT_SUPPLIER_BPMN_XML,
};

/**
 * Ключи кнопок из схемы (`act:userAction/@id`), на которые опирается кабинет.
 *
 * Определение кнопки — надпись, иконка, роль участника, событие и узлы — живёт
 * в блоках схемы (см. `bpmn-sdk/defaults/milkProcess.js` и инспектор узла
 * `EnginePanel`). В коде остаётся только ключ для сопоставления и вычисляемый
 * payload: номера ТТН/УПД, метки времени и идентификаторы экземпляров данными
 * не выразить.
 *
 * Если кнопку в схеме убрали или переименовали, ключа здесь не найдётся — и
 * обработчика у неё тоже не будет. Шаг из кабинета при этом не пропадает:
 * кнопки на текущем шаге, которых здесь нет, показывает общий блок
 * (`schemaStepActions`), а ключ нужен только тем шагам, чей обработчик собирает
 * payload. Такой общий шаг уходит в `handleSchemaStepAction` (см. README,
 * «Кнопки участников»).
 */
const ACTION_ID = {
  /** Запуск процесса заказчика: кнопка инициатора на стартовом событии. */
  CREATE_ORDER: 'createOrder',
  /** Передача заказа поставщику (и старт его процесса — `startsProcess`). */
  SEND_TO_SUPPLIER: 'sendToSupplier',
  /** Выписка пропуска менеджером закупок. */
  ISSUE_PASS: 'issuePass',
  /** Проверка пропуска охраной КПП. */
  SECURITY_PASS: 'securityPass',
  /** Подтверждение качества специалистом ОТК. */
  QUALITY_APPROVE: 'qualityApprove',
  /** Формирование ТТН/УПД поставщиком. */
  CREATE_DOCS: 'createDocs',
  /** Отгрузка поставщиком плюс сигнал заказчику (`counterpartEvent`). */
  SHIPMENT: 'shipment',
};

/**
 * Ключи, которые кабинет разбирает поимённо (`Object.values(ACTION_ID)`).
 *
 * Остальные кнопки схемы кабинет тоже показывает, но общим шагом: обработчик им
 * не нужен, потому что вычисляемых данных у такого шага нет — событие и узел
 * нажатия доводит сама схема (`resolveActionEntry`), а payload состоит из номера
 * заказа и метки времени (`handleSchemaStepAction`).
 */
const KNOWN_ACTION_IDS = Object.values(ACTION_ID);

/**
 * Иконки кнопок по имени из схемы (`act:userAction/@icon`).
 *
 * Схема хранит имя иконки, а не картинку: набор иконок — дело кабинета.
 * Незнакомое имя рисуется нейтральной иконкой — схему это не ломает.
 */
const ACTION_ICONS = {
  PlusCircle,
  Send,
  KeyRound,
  ShieldCheck,
  ClipboardCheck,
  FileText,
  Truck,
  PackageCheck,
};

/**
 * Оформление кнопок экрана проектов.
 *
 * Инлайновые стили — как и во всём демо-кабинете: отдельного CSS-слоя у экрана
 * нет, а цвет кнопки передаётся вызывающим кодом.
 *
 * @param {string} background цвет фона.
 * @returns {Object} стиль кнопки.
 */
const projectButtonStyle = (background) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  backgroundColor: background,
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: '600',
  cursor: 'pointer',
});

/**
 * Пара «стартовое событие + первый шаг» для схемы без кнопки инициатора.
 *
 * Демо-сценарий объявляет запуск кнопкой на стартовом событии
 * (`act:userAction`), но загруженный BPMN может её и не иметь. Движку для
 * старта достаточно стартового события и узла, на который встанет токен:
 * у события одна исходящая связь, поэтому первый шаг выводится из схемы.
 *
 * @param {string} xml схема процесса.
 * @returns {{elementId: string, action: object}|null} описание запуска.
 */
const synthStartStep = (xml) => {
  const start = listFlowElements(xml).find((element) => /startEvent$/i.test(element.type));
  if (!start) return null;

  return {
    elementId: start.id,
    action: {
      id: 'startProcess',
      label: 'Запустить процесс',
      role: '',
      // Событие шага — то же, что у кнопки «шаг выполнен»: движок имя события
      // не разбирает, токен двигает `elementId`.
      event: DEFAULT_ACTION_EVENT,
      elementId: getOutgoingTargetIds(xml, start.id)[0] || '',
    },
  };
};

/**
 * Кнопка действия участника.
 *
 * Надпись и иконка берутся из схемы (`act:userAction`), оформление — из `style`
 * вызывающего кода: определение кнопки живёт в блоке схемы, а цвета и размеры
 * остаются делом кабинета.
 *
 * @param {Object} props
 * @param {Object} props.action кнопка из схемы (`null` — рисовать нечего).
 * @param {() => void} props.onClick что сделать по нажатию.
 * @param {Object} props.style оформление кнопки.
 */
function ActionButton({ action, onClick, style }) {
  if (!action) return null;

  const Icon = ACTION_ICONS[action.icon] || CheckCircle2;

  return (
    <button onClick={onClick} style={style}>
      <Icon size={16} /> {action.label}
    </button>
  );
}

/**
 * Токены обеих сторон в одной подсветке.
 *
 * Просмотрщик показывает проект целиком (оба процесса), а токены приходят по
 * экземплярам: у Заказчика и Поставщика они разные. Карта `elementId → state`
 * у сторон не пересекается (идентификаторы узлов в BPMN уникальны), поэтому
 * карты просто складываются.
 *
 * @param {Object} customerTokens токены экземпляра Заказчика.
 * @param {Object} supplierTokens токены экземпляра Поставщика.
 * @returns {Object<string, string>} общая карта подсветки.
 */
const mergeTokens = (customerTokens, supplierTokens) => ({
  ...(customerTokens || {}),
  ...(supplierTokens || {}),
});

/**
 * Двигал ли токен «текущий шаг» процесса.
 *
 * Движок держит на экземпляр ровно один `ACTIVE`-токен: активируя новый узел,
 * он закрывает прежний (`COMPLETED`). Поэтому «текущий шаг» — это только
 * `ACTIVE`, а `COMPLETED` не должен ни откатывать шаг назад, ни закрывать
 * карточку заказа.
 */
const isTokenActive = (state) => state === TOKEN_STATES.ACTIVE;

/**
 * Статус стороны по событию токена.
 *
 * `COMPLETED` в статус не переносим: так движок закрывает прежний узел, и
 * заказ помечался бы завершённым после первого же шага (см. `isOrderCompleted`).
 */
const nextProcessState = (currentState, state) =>
  state === TOKEN_STATES.COMPLETED ? currentState : state || currentState;

/**
 * Контур экземпляра по префиксу его идентификатора (`''` — экземпляр не наш).
 *
 * Метрика процесса считается по схеме своего контура: у Заказчика и Поставщика
 * схемы разные, и конечный узел у них свой. Префикс — тот же признак, по
 * которому подписка на токены уже раскладывает заказы по сторонам
 * (`INSTANCE_PREFIX`).
 *
 * @param {string} instanceId идентификатор экземпляра (`inst-cust-*`).
 * @returns {'CUSTOMER'|'SUPPLIER'|''} код контура.
 */
const orgOfInstance = (instanceId) => {
  if (typeof instanceId !== 'string') return '';
  if (instanceId.startsWith(INSTANCE_PREFIX.CUSTOMER)) return 'CUSTOMER';
  if (instanceId.startsWith(INSTANCE_PREFIX.SUPPLIER)) return 'SUPPLIER';

  return '';
};

/**
 * Имя процесса из схемы (`bpmn:process/@name`) — подпись процесса в метриках.
 *
 * В метрике хранится не только `bpmn:process/@id`, но и человеческое имя: по
 * нему руководитель узнаёт процесс в инфографике, а `Process_MilkCustomer_v1`
 * остаётся технической сноской. Имени в схеме может и не быть — тогда подписью
 * становится идентификатор; если разобрать схему не удалось, подписи нет.
 *
 * @param {string} xml BPMN-схема стороны.
 * @param {string} [processId] идентификатор процесса (`getProcessIds`).
 * @returns {string} подпись процесса (`''`, если схему не разобрать).
 */
const processTitleOf = (xml, processId) => {
  const doc = parseXml(xml);
  if (!doc) return '';

  const processes = Array.from(doc.getElementsByTagName('*')).filter(
    (node) => getLocalName(node) === 'process'
  );

  const target =
    processes.find((node) => !processId || node.getAttribute('id') === processId) ||
    processes[0];

  if (!target) return '';

  return target.getAttribute('name') || target.getAttribute('id') || '';
};

/**
 * Пара «идентификатор + подпись» первого процесса схемы.
 *
 * Старт процесса отправляет одну схему, поэтому процесса в ней ровно один: его
 * и называют метрика запуска и карточка инфографики.
 *
 * @param {string} xml BPMN-схема стороны.
 * @returns {{processId: string, processName: string}} данные процесса.
 */
const processInfoOf = (xml) => {
  const processId = getProcessIds(xml)[0] || '';

  return { processId, processName: processTitleOf(xml, processId) };
};

/**
 * Дошёл ли процесс до конечного узла: токен стоит на узле без исходящих связей.
 *
 * Отдельного события «процесс завершён» движок не публикует (токен на
 * `endEvent` просто остаётся `ACTIVE`), поэтому финиш определяет схема: у
 * конечного события исходящих связей нет. Узел обязан быть в схеме — иначе
 * пустой список целей означал бы «узла нет», и метрика закрылась бы на первом
 * же незнакомом `element_id`.
 *
 * @param {string} xml BPMN-схема стороны.
 * @param {string} elementId узел, на котором сейчас `ACTIVE`-токен.
 * @returns {boolean}
 */
const isProcessFinished = (xml, elementId) => {
  if (!elementId) return false;

  const element = listFlowElements(xml).find((item) => item.id === elementId);
  if (!element) return false;

  return /endEvent$/i.test(element.type) || getOutgoingTargetIds(xml, elementId).length === 0;
};

/**
 * Строки пояснения по проблемам схемы — для журнала и `alert`.
 *
 * Проблем может быть много (движок отвечает отчётом по каждому узлу), поэтому
 * в сообщение попадают первые `limit`, а остальные упоминаются счётчиком.
 *
 * @param {Array<{message: string, hint: string}>} problems отчёт
 *   `validateEngineSchema`.
 * @param {number} [limit=4] сколько проблем перечислить.
 * @returns {string[]} строки для склейки через пробел (журнал) или перевод
 *   строки (`alert`).
 */
const schemaProblemLines = (problems, limit = 4) => {
  const lines = problems
    .slice(0, limit)
    .map((problem, index) =>
      `${index + 1}) ${problem.message}${problem.hint ? ` ${problem.hint}` : ''}`
    );

  const rest = problems.length - lines.length;
  if (rest > 0) lines.push(`и ещё ${rest}`);

  return lines;
};

/**
 * Дополняет пару «событие + узел» кнопки по её схеме.
 *
 * В `act:userAction` оба поля необязательны: пустое `event` — «шаг выполнен»
 * (`CompleteBlock`), пустой `elementId` — следующий блок по единственной
 * исходящей связи узла-хоста. Разрешает пару `resolveAction` из SDK, а хост
 * (`entry.elementId`) остаётся отдельным полем: по нему берётся роль кнопки и
 * видно, что токен стоит именно на этом шаге.
 *
 * Явно записанные в схеме значения всегда важнее умолчаний, поэтому этот вызов
 * ничего не меняет для схем, где событие и узел указаны руками.
 *
 * @param {string} xml схема стороны.
 * @param {{elementId: string, action: object}} entry запись `listActions`.
 * @returns {{elementId: string, action: object}} кнопка с разрешённой парой.
 */
const resolveActionEntry = (xml, entry) => ({
  ...entry,
  action: { ...entry.action, ...resolveAction(xml, entry.elementId, entry.action) },
});

/**
 * Активный узел заказа в контуре организации.
 *
 * «Текущий шаг» у сторон свой: у Заказчика и Поставщика разные экземпляры
 * процесса, и токен в каждом свой — `customerActiveElementId` /
 * `supplierActiveElementId`. Пусто означает «заказ в этот контур ещё не попал»
 * (например, процесс Поставщика не запускали).
 *
 * @param {Object|null} order заказ из списка (`orders`).
 * @param {'CUSTOMER'|'SUPPLIER'} org чей контур.
 * @returns {string} идентификатор узла активного токена (`''`, если его нет).
 */
const activeStepOf = (order, org) =>
  (org === 'SUPPLIER' ? order?.supplierActiveElementId : order?.customerActiveElementId) || '';

export default function App() {
  // Проект — одна BPMN-схема с процессами обеих сторон. Правки редактора живут
  // в `projectXml`, а `savedProject` — сохранённая копия (бейдж «Сохранено»).
  const [project, setProject] = useState(() => ensureDefaultProject());
  const [projectXml, setProjectXml] = useState(() => project.xml);
  const [savedProject, setSavedProject] = useState(() => project);
  const [projects, setProjects] = useState(() => listProjects());
  // Экран до входа: 'login' — карточки ролей проекта, 'projects' — список
  // проектов (создание, импорт BPMN, удаление).
  const [screen, setScreen] = useState('login');

  const [currentUser, setCurrentUser] = useState(null);
  const [loginInput, setLoginInput] = useState('production');
  const [passwordInput, setPasswordInput] = useState('123');
  const [authError, setAuthError] = useState('');

  // Роли и процессы — из схемы проекта: отдельного списка пользователей в коде
  // больше нет, поэтому загруженный BPMN сразу даёт состав ролей для входа.
  const analysis = useMemo(() => analyzeProject(projectXml), [projectXml]);
  const processes = analysis.processes;

  // Нарезки процессов: движок адресует только первый `bpmn:process`, поэтому
  // деплой, старт и метрики работают с процессом контура, а не с проектом.
  const customerProcess = processes.find((process) => process.org === 'CUSTOMER') || null;
  const supplierProcess = processes.find((process) => process.org === 'SUPPLIER') || null;

  const customerBpmnXml = useMemo(
    () => extractProcessXml(projectXml, customerProcess ? customerProcess.id : ''),
    [projectXml, customerProcess]
  );
  const supplierBpmnXml = useMemo(
    () => extractProcessXml(projectXml, supplierProcess ? supplierProcess.id : ''),
    [projectXml, supplierProcess]
  );

  // SDK: HTTP-клиент API Gateway и WS-подписка на токены процесса
  // (реконнект, парсинг кадров и жизненный цикл соединения — внутри SDK).
  const { client, socket, connected: wsConnected } = useBpmnEngine();

  // Токены по всем экземплярам процесса — источник подсветки узлов на схеме.
  const { tokensFor } = useProcessTokens(socket, []);

  /** Схема стороны (`CUSTOMER`/`SUPPLIER`) — источник назначений ролей. */
  const schemaXml = useCallback(
    (org) => (org === 'SUPPLIER' ? supplierBpmnXml : customerBpmnXml),
    [supplierBpmnXml, customerBpmnXml]
  );

  /**
   * Совместимость текущей схемы с движком оркестратора.
   *
   * Считается до раннего `return` экрана логина (хук нельзя вызывать
   * условно) и показывается руководителю предупреждением в панели схемы:
   * движок отказывает молча (шлюз отвечает `202`, ошибка компиляции остаётся
   * в его логе), поэтому правку нужно увидеть до деплоя.
   */
  const engineProblems = useMemo(() => {
    if (!currentUser) return [];

    const xml = currentUser.org === 'SUPPLIER' ? supplierBpmnXml : customerBpmnXml;
    return validateEngineSchema(xml).problems;
  }, [currentUser, supplierBpmnXml, customerBpmnXml]);

  /** Роль исполнителя узла по схеме (`''` — роль не назначена). */
  const roleOf = useCallback(
    (org, elementId) => getElementRole(schemaXml(org), elementId),
    [schemaXml]
  );

  /**
   * Кнопки участников из схемы: `[{elementId, action}]` в порядке XML.
   *
   * Схема — единственный источник кнопок кабинета: надпись, иконка, роль,
   * событие и узлы берутся из неё (`act:userAction`), а не из кода.
   */
  const customerActions = useMemo(() => listActions(customerBpmnXml), [customerBpmnXml]);
  const supplierActions = useMemo(() => listActions(supplierBpmnXml), [supplierBpmnXml]);

  /** Кнопки организации (`CUSTOMER`/`SUPPLIER`) — из её собственной схемы. */
  const actionsOf = useCallback(
    (org) => (org === 'SUPPLIER' ? supplierActions : customerActions),
    [customerActions, supplierActions]
  );

  /**
   * Кнопка схемы по её ключу (`id`) вместе с узлом-хостом.
   *
   * Хост (`elementId` записи) нужен дважды: он даёт роль кнопки, если та не
   * переопределена (`role`), и по нему видно, что токен стоит именно на этом
   * шаге — на этом построены ветки кабинета.
   *
   * Пара «событие + узел» разрешается по схеме (`resolveActionEntry`): пустые
   * `event`/`elementId` в кнопке означают умолчания — «шаг выполнен» и следующий
   * блок по единственной исходящей связи. Поэтому `action.event` и
   * `action.elementId` здесь всегда заполнены, и обработчики читают их как
   * раньше.
   *
   * @param {'CUSTOMER'|'SUPPLIER'} org чья схема.
   * @param {string} actionId ключ кнопки (`ACTION_ID`).
   * @returns {{elementId: string, action: object}|null} кнопка с узлом-хостом
   *   (`elementId`) и разрешённой парой события либо `null`, если её нет.
   */
  const actionOf = useCallback(
    (org, actionId) => {
      const entry = actionsOf(org).find((item) => item.action.id === actionId) || null;

      return entry ? resolveActionEntry(schemaXml(org), entry) : null;
    },
    [actionsOf, schemaXml]
  );

  /**
   * Первый шаг процесса по его схеме.
   *
   * Кнопка на стартовом событии объявляет запуск процесса (`getStartAction`), а
   * пару «событие + узел» может и не называть: у стартового события одна
   * исходящая связь, и `resolveActionEntry` доводит её до первого блока. `null` —
   * кнопки старта в схеме нет, значит и процесс ею не описан.
   *
   * @param {string} xml схема стороны.
   * @returns {{elementId: string, action: object}|null} кнопка старта с
   *   разрешённой парой события.
   */
  const startStepOf = useCallback(
    (xml) => {
      const declaration = getStartAction(xml);

      return declaration ? resolveActionEntry(xml, declaration) : null;
    },
    []
  );

  /** Роль участника кнопки: своя (`role`) либо роль узла-хоста (`potentialOwner`). */
  const actionRoleOf = useCallback(
    (org, entry) => (entry ? entry.action.role || roleOf(org, entry.elementId) : ''),
    [roleOf]
  );

  /**
   * Организация, в схеме которой объявлен процесс (`null`, если такого нет).
   *
   * Нужна кнопке со `startsProcess`: по `bpmn:process/@id` видно, чей это
   * процесс и какой схемой его запускать. Демо-проект этим полем больше не
   * пользуется (запуск делает движок по `trg:processTrigger`), механизм
   * сохранён для старых схем.
   */
  const orgOfProcess = useCallback(
    (processId) => {
      if (!processId) return null;
      if (getProcessIds(supplierBpmnXml).includes(processId)) return 'SUPPLIER';
      if (getProcessIds(customerBpmnXml).includes(processId)) return 'CUSTOMER';

      return null;
    },
    [customerBpmnXml, supplierBpmnXml]
  );

  /**
   * Идентификаторы процессов второй стороны — подсказки поля «Запускаемый
   * процесс» в инспекторе узла.
   *
   * Кросс-процессный триггер (`trg:processTrigger/@targetProcessId`) запускает
   * процесс соседа по цепочке, а не свой: у Заказчика подсказываются процессы
   * из схемы Поставщика и наоборот. Значения берутся из схемы, а не из списка
   * в коде, чтобы переименование процесса в редакторе сразу попадало в подсказки
   * (движок сверяет их с `bpmn:process/@id`).
   */
  const customerTriggerTargets = useMemo(
    () => getProcessIds(supplierBpmnXml),
    [supplierBpmnXml]
  );
  const supplierTriggerTargets = useMemo(
    () => getProcessIds(customerBpmnXml),
    [customerBpmnXml]
  );

  /**
   * Может ли текущий пользователь нажать хотя бы одну из перечисленных кнопок.
   *
   * Роль берётся из схемы: у задачи — `bpmn:potentialOwner`, у кнопки на
   * событии — её собственное поле `role` (`act:userAction/@role`, у событий нет
   * `resourceRole`). Перераспределить шаг между ролями можно в редакторе схемы,
   * и интерфейс поедет за ней. Организация берётся из её собственной схемы: у
   * Заказчика и Поставщика свои процессы и свои назначения.
   *
   * @param {'CUSTOMER'|'SUPPLIER'} org чья схема.
   * @param {string[]} actionIds ключи кнопок (`ACTION_ID`).
   * @returns {boolean}
   */
  const canWork = useCallback(
    (org, actionIds) => {
      if (!currentUser) return false;

      return actionIds.some(
        (actionId) => actionRoleOf(org, actionOf(org, actionId)) === currentUser.role
      );
    },
    [currentUser, actionOf, actionRoleOf]
  );

  /**
   * Запускает экземпляр процесса и ставит токен на его первый шаг.
   *
   * Как процесс стартует — решает схема: кнопка, объявленная на стартовом
   * событии (`act:userAction`, см. `getStartAction`), задаёт узел первого шага.
   * Пара «событие + узел» может быть и не записана: у стартового события одна
   * исходящая связь, поэтому `resolveAction` доводит её до первого блока.
   *
   * Событие одно — `StartProcess` с `element_id` **первого шага**: старт
   * работает так: движок сам доходит от `startEvent` до этого узла. Второй
   * `CompleteBlock` (как было до M1) закрыл бы
   * первый человеческий шаг, который движок только что активировал.
   *
   * @param {string} instanceId идентификатор нового экземпляра процесса.
   * @param {string} bpmnXml схема стороны (`bpmn_xml` для движка); она же —
   *   источник кнопки запуска процесса.
   * @param {Object} [payload] выходные данные запуска.
   * @returns {Promise<{start: Object}>} ответ шлюза; `start.ok === false`, если
   *   экземпляр процесса не создан.
   */
  const startProcess = useCallback(
    async (instanceId, bpmnXml, payload = {}) => {
      const declaration = startStepOf(bpmnXml) || synthStartStep(bpmnXml);

      // Схема без кнопки запуска процесс не описывает: движку нечего назвать
      // первым шагом — у стартового события нет ни события шага, ни узла.
      if (!declaration) {
        return {
          start: {
            ok: false,
            error:
              'В схеме нет кнопки запуска процесса: объявите act:userAction на стартовом событии.',
          },
        };
      }

      // Узел первого шага — адрес старта: без него событие не двигает токен.
      if (!declaration.action.elementId) {
        return {
          start: {
            ok: false,
            error:
              'В схеме не выводится первый шаг процесса: укажите elementId в кнопке стартового события.',
          },
        };
      }

      // Переменные кнопки старта — те же, что у обычного шага (8.1): граф
      // читает их, если первый узел схемы — шлюз.
      let variables = {};

      try {
        variables = parseActionVariables(declaration.action.variables);
      } catch (error) {
        return { start: { ok: false, error: error.message } };
      }

      const start = await client.sendEvent(
        instanceId,
        ENGINE_EVENTS.START_PROCESS,
        declaration.action.elementId,
        { bpmn_xml: bpmnXml, ...payload, ...variables }
      );

      if (!start.ok) return { start };

      // Экземпляр процесса создан — с этого момента и считаем время выполнения.
      // Финиш метрика увидит по токену на конечном узле (см. подписку на
      // токены), поэтому в записи пока только старт.
      const processInfo = processInfoOf(bpmnXml);

      const metricsRun = beginRun({
        id: instanceId,
        org: orgOfInstance(instanceId),
        processId: processInfo.processId,
        processName: processInfo.processName,
        orderNumber: payload.orderNum || '',
        startedAt: new Date().toISOString(),
      });

      if (metricsRun) setProcessRuns(loadRuns());

      return { start };
    },
    [client, startStepOf]
  );

  const [schemaMode, setSchemaMode] = useState('view');
  const [isDeploying, setIsDeploying] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);

  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Поля заказа (M4): «Принять заказ клиента» заводит номенклатуру, объём,
  // жирность, упаковку, срок и контрагента, а не фиксированные «100 Л».
  const [orderDraft, setOrderDraft] = useState(() => defaultOrderDraft());

  const [actionLoading, setActionLoading] = useState({});
  const [actionErrors, setActionErrors] = useState({});

  // Метрики запусков процессов: читаем из хранилища один раз при монтировании,
  // а дальше состояние всегда перечитывается из него же (`loadRuns`): так кэш в
  // React не может разойтись с сохранённым — иначе после F5 руководитель увидел
  // бы устаревшую инфографику.
  const [processRuns, setProcessRuns] = useState(() => loadRuns());

  const [notifications, setNotifications] = useState([
    {
      id: '1',
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      org: 'SYSTEM',
      role: 'ALL',
      title: 'Подключение к оркестратору',
      message: `API Gateway: ${API_BASE_URL}`
    }
  ]);

  // `logEvent` стабилен между рендерами: подписка на токены не пересоздаётся.
  const logEvent = useCallback((org, targetRoles, title, message, orderNumber = null) => {
    const rolesArray = Array.isArray(targetRoles) ? targetRoles : [targetRoles];
    const newEntries = rolesArray.map(r => ({
      id: createUuid(),
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      org,
      role: r,
      title: orderNumber ? `[Заказ ${orderNumber}] ${title}` : title,
      message
    }));
    setNotifications(prev => [...newEntries, ...prev]);
  }, []);

  // Экземпляры, уже привязанные к заказу на сервере: повторный WS-кадр не
  // должен слать второй POST.
  const attachedInstances = useRef(new Set());

  /**
   * Привязывает экземпляр процесса к заказу (M4).
   *
   * Без этого сервер не знает, какой экземпляр относится к заказу, и после F5
   * карточка осталась бы без текущих шагов. Ошибка API не блокирует сценарий:
   * демо работает и с локальным списком.
   */
  const attachOrderInstance = useCallback(async (orderNum, org, instanceId) => {
    if (!orderNum || !instanceId) return;

    const key = `${orderNum}:${org}:${instanceId}`;
    if (attachedInstances.current.has(key)) return;
    attachedInstances.current.add(key);

    const result = await ordersClient.attachInstance(orderNum, org, instanceId);
    const serverOrder = result.ok && result.order ? normalizeOrder(result.order) : null;

    if (!serverOrder) {
      attachedInstances.current.delete(key);
      return;
    }

    setOrders(prev => mergeOrders([serverOrder], prev));
  }, []);

  // Список заказов живёт на сервере (M4): F5 и второй браузер показывают одни
  // и те же заказы. Читаем на вход в кабинет, а не на монтирование: после
  // «Выхода» список очищается, и без повторного чтения он остался бы пустым,
  // хотя заказы на сервере есть. API может быть недоступен — тогда, как и
  // раньше, список наполняется событиями WS и живёт только в этой сессии.
  useEffect(() => {
    if (!currentUser) return undefined;

    let cancelled = false;

    ordersClient.listOrders().then((result) => {
      if (cancelled || !result.ok) return;

      const remote = (result.orders || []).map(normalizeOrder).filter(Boolean);
      if (remote.length === 0) return;

      setOrders(prev => mergeOrders(remote, prev));
      setSelectedOrderId(prev => prev || remote[0].id);
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  /**
   * Сохраняет проект в браузере (`localStorage`).
   *
   * Возвращает запись либо `null`: хранилище может быть недоступно (приватный
   * режим, переполненная квота) — тогда правки остаются только в состоянии
   * React, и текущая сессия работает как раньше.
   */
  const persistProject = (xmlData) => {
    if (!project || project.id === MEMORY_PROJECT_ID) return null;

    const record = updateProject(project.id, { xml: xmlData });
    if (record) {
      setProject(record);
      setSavedProject(record);
      setProjects(listProjects());
    }

    return record;
  };

  // Деплой схемы: SDK сам формирует служебный экземпляр `inst-deploy-<org>`,
  // имя события `DeploySchema` и `element_id` = `Process_Deployment`.
  const deployBpmnSchema = async (orgType, xmlData) => {
    // Движок об отказе не сообщает: шлюз принимает событие в NATS и отвечает
    // `202` независимо от того, скомпилируется определение или нет. Поэтому
    // схему проверяем сами: деплой того, что движок не разберёт, ничего не
    // сохраняет, но выглядит как успех.
    const problems = validateEngineSchema(xmlData).problems;

    if (problems.length > 0) {
      const lines = schemaProblemLines(problems);
      logEvent(orgType, 'ALL', 'Деплой отменён: движок не примет схему', lines.join(' '));
      alert(`Схема ${orgType} несовместима с движком, деплой отменён:\n${lines.join('\n')}`);
      return;
    }

    setIsDeploying(true);
    const result = await client.deploySchema(orgType, xmlData);
    if (result.ok) {
      // Деплой обновляет и копию в браузере: определение процесса в кластере и
      // схема, которую показывает кабинет, не должны расходиться после F5.
      persistProject(projectXml);
      logEvent(orgType, 'ALL', 'Схема задеплоена', `Руководитель задеплоил новую конфигурацию схемы ${orgType} в кластер.`);
      alert(`Схема ${orgType} успешно передана в оркестратор!`);
    } else {
      const details = result.details ? ` — ${result.details}` : '';
      // 500 чаще всего означает, что запрос вообще не дошёл до шлюза:
      // CRA dev-server отвечает 500, если проброс localhost:8080 не поднят.
      const hint = result.status >= 500
        ? '\nПроверьте доступность HTTP-шлюза: kubectl port-forward service/http-cluster-service 8080:8080'
        : '';
      alert(`Ошибка деплоя: ${result.error}${details}${hint}`);
    }
    setIsDeploying(false);
  };

  // Подписка на токены процесса: WS-шлюз широковещательный, поэтому
  // фильтруем служебные экземпляры деплоя/определений и обновляем заказы.
  useEffect(() => {
    if (!socket) return undefined;

    return socket.on(SOCKET_EVENTS.TOKEN, (token) => {
      const { instanceId, elementId, state } = token;

      if (
        isDeployInstanceId(instanceId) ||
        instanceId.startsWith(INSTANCE_PREFIX.DEFINITION)
      ) {
        return;
      }

      const payloadData = token.payload || {};
      const targetOrderNum = payloadData.orderNum;

      // «Текущий шаг» — только активация узла: прежний узел движок закрывает
      // событием `COMPLETED` в момент активации следующего (см. `isTokenActive`).
      const isActive = isTokenActive(state);

      // Экземпляр второй стороны создаёт движок по сообщению (M3): привязываем
      // его к заказу, как только кабинет увидел первый токен — иначе карточка
      // после F5 не знала бы о процессе поставщика.
      if (isActive && targetOrderNum && instanceId.startsWith(INSTANCE_PREFIX.SUPPLIER)) {
        attachOrderInstance(targetOrderNum, 'SUPPLIER', instanceId);
      }

      setOrders(prevOrders => {
        const orderIndex = prevOrders.findIndex(
          o => o.customerInstanceId === instanceId ||
               o.supplierInstanceId === instanceId ||
               (targetOrderNum && o.id === targetOrderNum)
        );

        if (orderIndex !== -1) {
          const updatedOrders = prevOrders.map((order, idx) => {
            if (idx !== orderIndex) return order;

            const isCustomer = order.customerInstanceId === instanceId;
            const isSupplier = order.supplierInstanceId === instanceId ||
                               instanceId.startsWith(INSTANCE_PREFIX.SUPPLIER);

            return {
              ...order,
              supplierInstanceId: isSupplier ? instanceId : order.supplierInstanceId,
              // Активный узел двигает только ACTIVE: COMPLETED прежнего узла
              // иначе откатил бы «текущий шаг» назад.
              customerActiveElementId: isCustomer && isActive ? (elementId || order.customerActiveElementId) : order.customerActiveElementId,
              customerProcessState: isCustomer ? nextProcessState(order.customerProcessState, state) : order.customerProcessState,
              supplierActiveElementId: isSupplier && isActive ? (elementId || order.supplierActiveElementId) : order.supplierActiveElementId,
              supplierProcessState: isSupplier ? nextProcessState(order.supplierProcessState, state) : order.supplierProcessState,
              ...payloadData
            };
          });

          const updatedOrder = updatedOrders[orderIndex];
          if (updatedOrder) {
            setActionLoading(prev => ({ ...prev, [updatedOrder.id]: null }));
          }
          return updatedOrders;
        }

        // Заказ заводим только по активации узла: `COMPLETED` приходит и для
        // экземпляров, которые этот клиент не начинал (например, страница
        // открыта посреди процесса) — «заказ-призрак» из него не нужен.
        if (!isActive) {
          return prevOrders;
        }

        if (instanceId.startsWith(INSTANCE_PREFIX.SUPPLIER)) {
          return prevOrders;
        }

        const newOrderNum = targetOrderNum || `Заказ-${instanceId.slice(-6)}`;
        const newOrder = {
          id: newOrderNum,
          createdAt: new Date().toLocaleTimeString('ru-RU'),
          volume: payloadData.volume || '100 Л',
          customerInstanceId: instanceId,
          customerActiveElementId: elementId,
          customerProcessState: state || 'ACTIVE',
          supplierInstanceId: null,
          supplierActiveElementId: null,
          supplierProcessState: 'IDLE',
          ...payloadData
        };
        setActionLoading(prev => ({ ...prev, [newOrderNum]: null }));
        return [newOrder, ...prevOrders];
      });

      // Метрика процесса: токен встал на конечный узел схемы — процесс выполнен.
      // Отдельного события «процесс завершён» движок не публикует, поэтому финиш
      // определяет схема (`isProcessFinished`), а запись закрывает `completeRun`.
      // По экземпляру, который этот клиент не начинал (страница открыта посреди
      // процесса), метрики не будет: время выполнения оказалось бы выдуманным.
      if (isActive) {
        const runOrg = orgOfInstance(instanceId);

        if (runOrg && isProcessFinished(schemaXml(runOrg), elementId)) {
          const finishedRun = completeRun(instanceId, {
            finishedAt: new Date().toISOString(),
            lastElementId: elementId,
            orderNumber: targetOrderNum || '',
          });

          if (finishedRun) {
            setProcessRuns(loadRuns());
            logEvent(
              runOrg,
              'ALL',
              'Процесс завершён',
              `«${finishedRun.processName || finishedRun.processId || instanceId}»${finishedRun.orderNumber ? ` по заказу ${finishedRun.orderNumber}` : ''} выполнен за ${formatDuration(finishedRun.durationMs)}`,
              finishedRun.orderNumber || null
            );
          }
        }
      }

      logEvent('SYSTEM', 'ALL', 'Событие Оркестратора', `Инстанс ${instanceId} -> Узел: ${elementId || '—'} [Статус: ${state}]`);
    });
  }, [socket, logEvent, schemaXml, attachOrderInstance]);

  /**
   * Запуск процесса по схеме, когда кнопки инициатора в ней нет.
   *
   * Кнопка `createOrder` — принадлежность демо-сценария закупки. В загруженном
   * BPMN её может не быть, но отыграть процесс всё равно нужно: экземпляр
   * стартует со стартового события схемы, а токен встаёт на первый узел
   * (`startProcess` выводит пару из связей, см. `synthStartStep`).
   */
  const handleStartBySchema = async () => {
    const org = currentUser.org;
    const xml = schemaXml(org);
    if (!xml) return;

    const orderNum = nextOrderNum(orders);
    const suffix = Math.random().toString(36).substring(2, 8);
    const instanceId =
      org === 'SUPPLIER'
        ? `${INSTANCE_PREFIX.SUPPLIER}${suffix}`
        : `${INSTANCE_PREFIX.CUSTOMER}${suffix}`;
    const isCustomer = org === 'CUSTOMER';

    setActionLoading(prev => ({ ...prev, [orderNum]: 'Запуск процесса в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderNum]: null }));

    const { start } = await startProcess(instanceId, xml, { orderNum });

    if (!start.ok) {
      setActionLoading(prev => ({ ...prev, [orderNum]: null }));
      setActionErrors(prev => ({ ...prev, [orderNum]: 'Не удалось запустить процесс. Попробуйте еще раз.' }));
      return;
    }

    const declaration = startStepOf(xml) || synthStartStep(xml);
    const activeElementId = declaration ? declaration.action.elementId : '';

    setOrders(prev => {
      if (prev.some((order) => order.customerInstanceId === instanceId || order.supplierInstanceId === instanceId)) {
        return prev;
      }

      return [
        {
          id: orderNum,
          createdAt: new Date().toLocaleTimeString('ru-RU'),
          volume: '—',
          customerInstanceId: isCustomer ? instanceId : null,
          customerActiveElementId: isCustomer ? activeElementId : null,
          customerProcessState: isCustomer ? 'ACTIVE' : 'IDLE',
          supplierInstanceId: isCustomer ? null : instanceId,
          supplierActiveElementId: isCustomer ? null : activeElementId,
          supplierProcessState: isCustomer ? 'IDLE' : 'ACTIVE',
        },
        ...prev,
      ];
    });
    setSelectedOrderId(orderNum);

    logEvent(
      org,
      currentUser.role,
      'Процесс запущен',
      `Экземпляр ${instanceId} создан по схеме «${processTitleOf(xml)}».`,
      orderNum
    );
  };

  // 1. ТОЧКА ВХОДА: Создание заказа Производством. Кнопку инициатора — надпись,
  // роль, событие первого шага — объявляет стартовое событие схемы, а поля
  // заказа (номенклатура, объём, жирность, упаковка, срок, контрагент) — форма
  // `orderDraft` (M4).
  const handleProductionCreateOrder = async () => {
    // Номер продолжаем от максимума известных заказов: после F5 список пришёл с
    // сервера, и `101 + orders.length` выдал бы занятый бизнес-ключ.
    const orderNum = nextOrderNum(orders);
    const custInstId = `inst-cust-${Math.random().toString(36).substring(2, 8)}`;
    const createOrder = actionOf('CUSTOMER', ACTION_ID.CREATE_ORDER);
    const orderPayload = toOrderPayload(orderNum, orderDraft);

    // Заказ не заводим, если движок определение не скомпилирует: экземпляра
    // процесса не появится, токенов тоже (`tokens` не пройдёт по внешнему
    // ключу к `process_instances`), и в списке останется «заказ-призрак».
    const problems = validateEngineSchema(customerBpmnXml).problems;

    if (problems.length > 0) {
      const lines = schemaProblemLines(problems);
      logEvent(
        'CUSTOMER',
        currentUser ? currentUser.role : 'ALL',
        'Заказ не создан: движок не примет схему',
        lines.join(' '),
        orderNum
      );
      alert(`Схема Заказчика несовместима с движком:\n${lines.join('\n')}`);
      return;
    }

    setActionLoading(prev => ({ ...prev, [orderNum]: 'Создание заказа в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderNum]: null }));

    // Заказ сохраняем до старта процесса: карточка должна существовать, когда
    // движок создаст по ней экземпляр. API может быть недоступен (стенд без
    // HTTP-шлюза) — тогда заказ остаётся локальным, как до M4.
    const savedOrder = await ordersClient.createOrder(orderPayload);

    if (!savedOrder.ok && savedOrder.status !== 409) {
      logEvent(
        'CUSTOMER',
        currentUser ? currentUser.role : 'ALL',
        'Заказ сохранён только в кабинете',
        savedOrder.details || savedOrder.error || 'API заказов недоступен.',
        orderNum
      );
    }

    // Запуск процесса: `StartProcess` называет первый шаг — его узел схема
    // выводит из кнопки старта. Второго события нет: в режиме графа оно
    // закрыло бы первый человеческий шаг (M1, 10.2 п. 1).
    const { start } = await startProcess(custInstId, customerBpmnXml, {
      orderNum,
      volume: `${orderPayload.volumeLiters} л`,
      nomenclature: orderPayload.nomenclature,
      fatContent: orderPayload.fatContent,
      packaging: orderPayload.packaging,
      dueDate: orderPayload.dueDate,
      counterparty: orderPayload.counterparty,
      initiator: actionRoleOf('CUSTOMER', createOrder),
    });

    if (start.ok) {
      // Привязка экземпляра к заказу: после F5 карточка берёт текущий шаг из
      // `tokens` движка, а не из `useState` этого браузера.
      const attached = await ordersClient.attachInstance(orderNum, 'CUSTOMER', custInstId);
      const serverOrder =
        attached.ok && attached.order ? normalizeOrder(attached.order) : null;

      const pendingOrder = {
        ...(serverOrder || {}),
        id: orderNum,
        orderNum,
        createdAt: serverOrder
          ? serverOrder.createdAt
          : new Date().toLocaleTimeString('ru-RU'),
        volume: `${orderPayload.volumeLiters} л`,
        volumeLiters: orderPayload.volumeLiters,
        nomenclature: orderPayload.nomenclature,
        fatContent: orderPayload.fatContent,
        packaging: orderPayload.packaging,
        dueDate: orderPayload.dueDate,
        counterparty: orderPayload.counterparty,
        status: ORDER_STATUS.IN_PROGRESS,
        customerInstanceId: custInstId,
        // Первый шаг процесса — узел из кнопки старта (`act:userAction/@elementId`):
        // `startProcess` уже поставил на него токен в движке, поэтому подсветка и
        // «текущий шаг» сходятся.
        customerActiveElementId: createOrder ? createOrder.action.elementId : '',
        customerProcessState: 'ACTIVE',
        supplierInstanceId: serverOrder ? serverOrder.supplierInstanceId : null,
        documents: null, passData: null, shippedAt: null, entryTime: null, checkedAt: null
      };
      // Заказ мог появиться раньше ответа HTTP: движок публикует токен
      // `StartProcess` до того, как шлюз ответит на POST, — WS-кадр успевает
      // первым. Тогда заказ уже в списке (ветка «незнакомый экземпляр» в
      // подписке на токены), и второй такой же дал бы два узла с одним
      // `key={o.id}` в списке и таблицах заказов.
      setOrders(prev => {
        // Экземпляр процесса — точнее номера: заказ мог быть заведён по токену
        // с этим же `orderNum`, но из другого источника.
        const index = prev.findIndex(
          o => o.customerInstanceId === custInstId || o.id === orderNum
        );

        if (index === -1) return [pendingOrder, ...prev];

        // Состояние из WS свежее ответа HTTP (движок уже активировал узел),
        // поэтому оно и остаётся: обработчик дописывает только то, чего WS не
        // знал — счётчики шагов и пустые поля заказа.
        return prev.map((order, idx) =>
          idx === index ? { ...pendingOrder, ...order, id: orderNum } : order
        );
      });
      setSelectedOrderId(orderNum);

      // Кого уведомлять — тоже решает схема: роль кнопки старта и роль того, кто
      // действие выполнил. Если роли в схеме не назначены, уведомление никому не
      // адресуется.
      const notifyRoles = [
        currentUser ? currentUser.role : '',
        createOrder ? roleOf('CUSTOMER', createOrder.action.elementId) : '',
      ].filter(Boolean);

      logEvent('CUSTOMER', notifyRoles, 'Заявка производства сформирована', `Запущен процесс для ${orderNum}`, orderNum);
    } else {
      setActionLoading(prev => ({ ...prev, [orderNum]: null }));
      setActionErrors(prev => ({ ...prev, [orderNum]: 'Произошла ошибка при запуске заказа. Попробуйте еще раз.' }));
    }
  };

  // 2. Менеджер закупок передаёт заказ Поставщику: событие и узел ожидания
  // объявлены кнопкой на блоке `Task_CreatePurchaseOrder`, а запуск процесса
  // Поставщика — её полем `startsProcess`.
  const handleCustomerSendOrderToSupplier = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    const sendToSupplier = actionOf('CUSTOMER', ACTION_ID.SEND_TO_SUPPLIER);
    if (!sendToSupplier) return;

    // Процесс второй стороны стартует своей схемой, поэтому проверяем её до
    // первого события: иначе заказ ушёл бы Поставщику, а его процесс не появился.
    const supplierProblems = validateEngineSchema(supplierBpmnXml).problems;

    if (supplierProblems.length > 0) {
      const lines = schemaProblemLines(supplierProblems);
      setActionErrors(prev => ({ ...prev, [orderId]: 'Схема Поставщика несовместима с движком. Смотрите журнал.' }));
      logEvent(
        'SUPPLIER',
        'ALL',
        'Передача заказа отменена: движок не примет схему Поставщика',
        lines.join(' '),
        orderId
      );
      alert(`Схема Поставщика несовместима с движком:\n${lines.join('\n')}`);
      return;
    }

    setActionLoading(prev => ({ ...prev, [orderId]: 'Оркестратор передает заказ Поставщику...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    // Определение второй стороны должно быть в движке раньше сообщения: экземпляр
    // поставщика создаёт триггер узла `Event_SendPO`, а не клиент. Деплой —
    // upsert по `bpmn:process/@id`, поэтому повторная передача безопасна.
    const deploySupplier = await client.deploySchema('SUPPLIER', supplierBpmnXml);

    if (!deploySupplier.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Не удалось задеплоить схему Поставщика: движок не сможет создать его процесс.' }));
      return;
    }

    const resCust = await client.sendEvent(
      targetOrder.customerInstanceId,
      sendToSupplier.action.event,
      sendToSupplier.action.elementId,
      { status: 'SENT_TO_SUPPLIER', orderNum: orderId }
    );

    if (resCust.ok) {
      // Старые схемы объявляют запуск второй стороны кнопкой (`startsProcess`):
      // механизм сохранён. Демо-проект его не использует — экземпляр поставщика
      // создаёт триггер узла `Event_SendPO` по сообщению PurchaseOrder (M3).
      const targetOrg = orgOfProcess(sendToSupplier.action.startsProcess);

      if (targetOrg) {
        const suppInstId = `inst-supp-${Math.random().toString(36).substring(2, 8)}`;
        const { start: resSupp } = await startProcess(
          suppInstId,
          schemaXml(targetOrg),
          { orderNum: orderId }
        );

        if (!resSupp.ok) {
          setActionLoading(prev => ({ ...prev, [orderId]: null }));
          setActionErrors(prev => ({ ...prev, [orderId]: `Ошибка создания процесса у ${targetOrg === 'SUPPLIER' ? 'Поставщика' : 'Заказчика'}. Попробуйте еще раз.` }));
        } else {
          // Экземпляр создал сам клиент (старый механизм `startsProcess`) —
          // привязываем его к заказу, чтобы карточка пережила F5.
          attachOrderInstance(orderId, targetOrg, suppInstId);
        }
      } else {
        // Экземпляр второй стороны создаёт движок: сообщение `PurchaseOrder`
        // несёт `trg:processTrigger`, а id экземпляра — `inst-supp-<orderNum>`.
        logEvent(
          'CUSTOMER',
          'ALL',
          'Заказ отправлен поставщику',
          `Сообщение PurchaseOrder запускает процесс поставщика по заказу ${orderId}.`,
          orderId
        );
      }
    } else {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при отправке в оркестратор. Попробуйте еще раз.' }));
    }
  };

  // 3. Поставщик создает документы. Событие и следующий узел — из кнопки на
  // блоке `Task_SupplierCreateDocs`; в коде остаются только сами документы.
  const handleSupplierCreateDocs = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder || !targetOrder.supplierInstanceId) return;

    const createDocs = actionOf('SUPPLIER', ACTION_ID.CREATE_DOCS);
    if (!createDocs) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Формирование и регистрация ТТН/УПД в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const generatedDocs = {
      updNumber: `УПД-${Math.floor(1000 + Math.random() * 9000)}`,
      ttnNumber: `ТТН-${Math.floor(10000 + Math.random() * 90000)}`,
      vehicleNum: `А${Math.floor(100 + Math.random() * 900)}АА 777`,
      driverName: 'Иванов И.И.',
    };

    const res = await client.sendEvent(
      targetOrder.supplierInstanceId,
      createDocs.action.event,
      createDocs.action.elementId,
      { documents: generatedDocs, orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при сохранении документов. Попробуйте еще раз.' }));
    }
  };

  // 4. Поставщик отгружает сырье. Кнопка на `Task_ShipMilk` закрывает шаг, а
  // сообщение `MilkShipped` движок доставляет заводу по `orderNum` (M3):
  // отдельный `sendEvent` второй стороне больше не нужен.
  const handleSupplierShipment = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder || !targetOrder.supplierInstanceId) return;

    const shipment = actionOf('SUPPLIER', ACTION_ID.SHIPMENT);
    if (!shipment) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Регистрация отгрузки в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const shippedAt = new Date().toLocaleTimeString('ru-RU');

    const resSupp = await client.sendEvent(
      targetOrder.supplierInstanceId,
      shipment.action.event,
      shipment.action.elementId,
      { shippedAt, orderNum: orderId }
    );

    if (resSupp.ok) {
      // Старые схемы объявляют пару `counterpartEvent`/`counterpartElementId`:
      // сигнал второй стороне шлёт клиент. Демо-проект обходится сообщением
      // `MilkShipped`, которое движок доставляет заводу по `orderNum` (M3).
      if (shipment.action.counterpartEvent) {
        const resCust = await client.sendEvent(
          targetOrder.customerInstanceId,
          shipment.action.counterpartEvent,
          shipment.action.counterpartElementId,
          { shippedAt, orderNum: orderId, documents: targetOrder.documents }
        );

        if (!resCust.ok) {
          setActionErrors(prev => ({ ...prev, [orderId]: 'Не удалось передать сигнал об отгрузке Заказчику.' }));
        }
      } else {
        logEvent(
          'SUPPLIER',
          'ALL',
          'Партия отгружена',
          `Сообщение MilkShipped доставит завод по заказу ${orderId}; приёмка начнётся без участия поставщика.`,
          orderId
        );
      }
    } else {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при подтверждении отгрузки. Попробуйте еще раз.' }));
    }
  };

  // 5. Менеджер Заказчика выписывает пропуск: кнопка на
  // `Task_ReceiveDocsAndIssuePass` двигает токен на узел охраны КПП.
  const handleCustomerIssuePass = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    const issuePass = actionOf('CUSTOMER', ACTION_ID.ISSUE_PASS);
    if (!issuePass) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Выписка электронного пропуска...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const pass = {
      passNumber: `ПР-${Math.floor(100000 + Math.random() * 900000)}`,
      status: 'ISSUED',
      issuedAt: new Date().toLocaleTimeString('ru-RU')
    };

    const res = await client.sendEvent(
      targetOrder.customerInstanceId,
      issuePass.action.event,
      issuePass.action.elementId,
      { passData: pass, orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при выписке пропуска. Попробуйте еще раз.' }));
    }
  };

  // 6. Охрана КПП пропускает автоцистерну: кнопка на `Task_SecurityCheck`
  // двигает токен на узел ОТК.
  const handleSecurityCheckAndPass = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    const securityPass = actionOf('CUSTOMER', ACTION_ID.SECURITY_PASS);
    if (!securityPass) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Фиксация въезда транспорта на КПП...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const entryTime = new Date().toLocaleTimeString('ru-RU');
    const res = await client.sendEvent(
      targetOrder.customerInstanceId,
      securityPass.action.event,
      securityPass.action.elementId,
      { entryTime, orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при регистрации въезда. Попробуйте еще раз.' }));
    }
  };

  // 7. ОТК принимает качество и передает сырье в Производство: кнопка на
  // `Task_QualityControl` завершает экземпляр заказчика.
  const handleQualityApprove = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    const qualityApprove = actionOf('CUSTOMER', ACTION_ID.QUALITY_APPROVE);
    if (!qualityApprove) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Завершение проверки качества в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const checkedAt = new Date().toLocaleTimeString('ru-RU');
    const res = await client.sendEvent(
      targetOrder.customerInstanceId,
      qualityApprove.action.event,
      qualityApprove.action.elementId,
      { checkedAt, status: 'COMPLETED', orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при подтверждении ОТК. Попробуйте еще раз.' }));
    }
  };

  // 8. Шаг, объявленный в схеме без обработчика: кабинет знает о такой кнопке
  // только то, что она есть (см. `schemaStepActions`). Вычислять тут нечего —
  // нажатие двигает токен парой «событие + узел» из схемы (`resolveActionEntry`),
  // а `counterpartEvent` отправляет сигнал в экземпляр второй стороны.
  const handleSchemaStepAction = async (entry, order) => {
    if (!order) return;

    const org = currentUser.org;
    const instanceId = org === 'SUPPLIER' ? order.supplierInstanceId : order.customerInstanceId;
    const stepName = entry.stepName || entry.action.id;

    if (!instanceId) return;

    // Куда встанет токен, движок берёт из события (он граф схемы не исполняет).
    // Без узла нажатие ничего не сдвинуло бы, поэтому такую кнопку кабинет не
    // рисует вовсе (см. `schemaStepActions`), а здесь — страховка от вызова мимо
    // карточки: событие с пустым узлом движку не уходит.
    if (!entry.action.elementId) return;

    // Переменные кнопки — часть контракта со шлюзом схемы: кривую строку лучше
    // показать до события, чем отправить нажатие, которое уедет в `default`.
    let variables = {};

    try {
      variables = parseActionVariables(entry.action.variables);
    } catch (error) {
      setActionErrors(prev => ({
        ...prev,
        [order.id]: `Кнопка «${stepName}»: ${error.message}`,
      }));
      return;
    }

    setActionLoading(prev => ({ ...prev, [order.id]: `Оркестратор выполняет шаг «${stepName}»...` }));
    setActionErrors(prev => ({ ...prev, [order.id]: null }));

    const actedAt = new Date().toLocaleTimeString('ru-RU');
    // Переменные кнопки (`act:userAction/@variables`) уходят в `output_data`
    // того же события: по ним шлюз схемы выбирает ветку, поэтому «кнопка» и
    // «значение ветки» — одно объявление в схеме, а не таблица в кабинете.
    const res = await client.sendEvent(
      instanceId,
      entry.action.event,
      entry.action.elementId,
      { orderNum: order.id, actedAt, ...variables }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [order.id]: null }));
      setActionErrors(prev => ({ ...prev, [order.id]: `Произошла ошибка на шаге «${stepName}». Попробуйте еще раз.` }));
      return;
    }

    // Чужой процесс кнопка не запускает (`startsProcess`): экземпляр второй
    // стороны заводит кабинет, и делает он это только на шаге передачи заказа.
    // Об остальных пишем в журнал — иначе «процесс не появился» выглядело бы
    // поломкой оркестратора.
    if (entry.action.startsProcess) {
      logEvent(
        org,
        currentUser.role,
        'Процесс второй стороны не запущен',
        `Шаг «${stepName}» объявил startsProcess (${entry.action.startsProcess}), но кабинет запускает чужой процесс только на шаге передачи заказа — экземпляра второй стороны не будет.`,
        order.id
      );
    }

    const counterpartInstanceId = org === 'SUPPLIER' ? order.customerInstanceId : order.supplierInstanceId;

    if (entry.action.counterpartEvent && counterpartInstanceId) {
      const counterpartRes = await client.sendEvent(
        counterpartInstanceId,
        entry.action.counterpartEvent,
        entry.action.counterpartElementId || '',
        { orderNum: order.id, actedAt }
      );

      if (!counterpartRes.ok) {
        setActionErrors(prev => ({ ...prev, [order.id]: 'Шаг выполнен, но сигнал второй стороне не ушёл.' }));
      }
    }
  };

  /**
   * Кнопка «Очистить» инфографики: забывает сохранённые метрики процессов.
   *
   * Чистится именно хранилище браузера, а не состояние React: метрика — не
   * журнал событий, и её данные не должны всплывать после F5. Проект лежит под
   * другим ключом (`src/projectStore.js`) и очисткой не затрагивается.
   */
  const handleClearMetrics = () => {
    clearRuns();
    setProcessRuns([]);

    logEvent('SYSTEM', 'ALL', 'Метрики очищены', 'Сохранённые метрики выполненных процессов удалены из браузера.');
  };

  /** Открывает проект: его схема становится рабочей, вход — по его ролям. */
  const openProject = (record) => {
    if (!record) return;

    setActiveProjectId(record.id);
    setProject(record);
    setSavedProject(record);
    setProjectXml(record.xml);
    setProjects(listProjects());
    setCurrentUser(null);
    setScreen('login');
    setOrders([]);
    setSelectedOrderId(null);
  };

  /** Создаёт проект из схемы и сразу открывает его. */
  const handleCreateProject = (xml, name) => {
    const created = createProject({ xml, name });

    if (!created) {
      alert('Не удалось создать проект: браузер не дал сохранить схему.');
      return null;
    }

    openProject(created);
    return created;
  };

  /** Новый проект на основе демо-схемы SDK. */
  const handleCreateDefaultProject = () => {
    handleCreateProject(DEFAULT_PROJECT_BPMN_XML, `Проект ${projects.length + 1}`);
  };

  /**
   * Проект «Молочный завод»: заказ → закупка сырья → приёмка → производство →
   * отгрузка. Схема — тот же проект из двух процессов (`DAIRY_PLANT_PROJECT_XML`),
   * поэтому её роли, кнопки и переходы кабинет читает как у любого другого проекта.
   */
  const handleCreateDairyProject = () => {
    handleCreateProject(DAIRY_PLANT_PROJECT_XML, DAIRY_PLANT_PROJECT_NAME);
  };

  /**
   * Импорт BPMN-файла как проекта.
   *
   * Роли, процессы и кабинет выводятся из схемы (`analyzeProject`), поэтому
   * загрузить можно любой BPMN: клиент покажет те роли, что объявлены в нём.
   */
  const handleImportProject = (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      const xml = String(reader.result || '');

      if (!parseXml(xml)) {
        alert('Файл не является BPMN-схемой: XML не разбирается.');
        return;
      }

      if (getProjectProcesses(xml).length === 0) {
        alert('В схеме нет ни одного bpmn:process — отыгрывать нечего.');
        return;
      }

      const name = file.name.replace(/\.bpmn(\.xml)?$/i, '').replace(/\.xml$/i, '') || 'Импорт';
      handleCreateProject(xml, name);
    };

    reader.readAsText(file);
    input.value = '';
  };

  const handleDeleteProject = (projectId) => {
    if (!projectId) return;

    deleteProject(projectId);
    const rest = listProjects();
    setProjects(rest);

    if (!project || project.id !== projectId) return;

    // Удалили открытый проект: открываем следующий, иначе — демо-проект, чтобы
    // приложение не осталось без схемы (вход и кабинет живут по ней).
    openProject(rest[0] || ensureDefaultProject());
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const found = findUser(analysis.roles, loginInput, passwordInput);

    if (found) {
      setCurrentUser(found);
      setAuthError('');
    } else {
      setAuthError('Неверный логин или пароль');
    }
  };

  const handleColumnResizeMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startLeftWidth = leftWidth;
    const container = document.getElementById('main-dashboard-container');
    const containerWidth = container ? container.clientWidth : window.innerWidth;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercentage = (deltaX / containerWidth) * 100;
      setLeftWidth(Math.max(20, Math.min(80, startLeftWidth + deltaPercentage)));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  if (screen === 'projects') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '22px' }}>📁 Проекты</h2>
              <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '13px' }}>
                Проект — одна BPMN-схема с процессами сторон. Роли и кабинеты собираются из неё.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={handleCreateDefaultProject} style={projectButtonStyle('#2563eb')}>
                <FolderPlus size={16} /> Новый проект
              </button>

              <button onClick={handleCreateDairyProject} style={projectButtonStyle('#7c3aed')}>
                <Factory size={16} /> Молочный завод
              </button>

              <label style={{ ...projectButtonStyle('#0f766e'), cursor: 'pointer' }}>
                <Upload size={16} /> Импорт BPMN
                <input
                  type="file"
                  accept=".bpmn,.xml,application/xml,text/xml"
                  onChange={handleImportProject}
                  data-testid="project-import"
                  style={{ display: 'none' }}
                />
              </label>

              {analysis.roles.length > 0 && (
                <button onClick={() => setScreen('login')} style={projectButtonStyle('#475569')}>
                  <ArrowLeft size={16} /> К ролям
                </button>
              )}
            </div>
          </div>

          {projects.map((item) => {
            const info = analyzeProject(item.xml);
            const savedAt = formatProjectSavedAt(item.updatedAt);
            const organizations = info.processes.map((process) => process.orgName).join(' ↔ ');

            return (
              <div
                key={item.id}
                style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}
              >
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{item.name}</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {organizations || 'процессов нет'} · ролей: {info.roles.length}
                    {savedAt ? ` · изменён в ${savedAt}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => openProject(item)} style={projectButtonStyle('#2563eb')}>
                    <FolderOpen size={15} /> Открыть
                  </button>
                  <button onClick={() => handleDeleteProject(item.id)} style={projectButtonStyle('#b91c1c')}>
                    <Trash2 size={15} /> Удалить
                  </button>
                </div>
              </div>
            );
          })}

          {projects.length === 0 && (
            <p style={{ color: '#94a3b8', fontSize: '13px' }}>
              Проектов пока нет: создайте демо-проект или импортируйте BPMN-файл.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0f172a', fontFamily: 'system-ui, sans-serif', padding: '24px', boxSizing: 'border-box' }}>
        <div style={{ backgroundColor: '#fff', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '520px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Проект: <strong style={{ color: '#0f172a' }}>{project.name}</strong>
            </span>
            <button
              onClick={() => { setProjects(listProjects()); setScreen('projects'); }}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', backgroundColor: '#fff', cursor: 'pointer' }}
            >
              <FolderOpen size={13} /> Проекты
            </button>
          </div>

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: '0 0 8px 0', color: '#0f172a', fontSize: '22px' }}>🥛 Межорганизационная ERP</h2>
            <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>Выберите роль компании для входа</p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>Логин</label>
              <input type="text" value={loginInput} onChange={(e) => setLoginInput(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>Пароль</label>
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '6px', boxSizing: 'border-box' }} required />
            </div>
            {authError && <div style={{ color: '#ef4444', fontSize: '13px' }}>{authError}</div>}
            <button type="submit" style={{ padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', marginTop: '6px' }}>Войти в систему</button>
          </form>

          {analysis.problems.map((problem) => (
            <div key={problem} style={{ marginTop: '12px', padding: '8px 10px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', color: '#92400e', fontSize: '12px' }}>
              {problem}
            </div>
          ))}

          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '8px', fontWeight: '600' }}>Роли проекта (пароль 123):</span>

            {analysis.processes.map((process, index) => {
              const processRoles = analysis.roles.filter((role) => role.processId === process.id);
              if (processRoles.length === 0) return null;

              return (
                <div key={process.id}>
                  <div style={{ fontSize: '11px', color: process.org === 'SUPPLIER' ? '#166534' : '#1e3a8a', fontWeight: 'bold', marginBottom: '4px' }}>
                    {index + 1}. {CONTOUR_LABELS[process.org]} ({process.orgName}):
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                    {processRoles.map((role) => (
                      <button
                        key={role.key}
                        onClick={() => { setLoginInput(role.username); setPasswordInput(role.pass); setCurrentUser(role); setAuthError(''); }}
                        style={{ padding: '6px 8px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', backgroundColor: role.isExecutive ? '#dbeafe' : role.code === 'PRODUCTION' ? '#fef3c7' : '#f8fafc' }}
                      >
                        {role.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {analysis.roles.length === 0 && (
              <p style={{ margin: 0, fontSize: '12px', color: '#b45309' }}>
                В схеме не объявлено ролей: добавьте bpmn:potentialOwner на задачу или кнопку с ролью (act:userAction/@role).
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isExecutive = Boolean(currentUser.isExecutive);
  const myNotifications = notifications.filter(n => n.role === 'ALL' || (n.org === currentUser.org && n.role === currentUser.role));
  const UserIcon = currentUser.icon;
  const currentOrder = orders.find(o => o.id === selectedOrderId) || orders[0] || null;

  /**
   * Кнопки схемы, которые рисует кабинет.
   *
   * Ключи — из `ACTION_ID`, всё остальное (надпись, иконка, роль, событие,
   * узлы) берётся из схемы. Ветки кабинета сравнивают «текущий шаг» заказа
   * (`customerActiveElementId`/`supplierActiveElementId`) с узлом-хостом кнопки:
   * кнопка показывается там, где её объявили в схеме. Кнопки, чьих ключей в
   * `ACTION_ID` нет, ветки не рисуют — их собирает `schemaStepActions`.
   */
  const createOrderAction = actionOf('CUSTOMER', ACTION_ID.CREATE_ORDER);
  const sendToSupplierAction = actionOf('CUSTOMER', ACTION_ID.SEND_TO_SUPPLIER);
  const issuePassAction = actionOf('CUSTOMER', ACTION_ID.ISSUE_PASS);
  const securityPassAction = actionOf('CUSTOMER', ACTION_ID.SECURITY_PASS);
  const qualityApproveAction = actionOf('CUSTOMER', ACTION_ID.QUALITY_APPROVE);
  const createDocsAction = actionOf('SUPPLIER', ACTION_ID.CREATE_DOCS);
  const shipmentAction = actionOf('SUPPLIER', ACTION_ID.SHIPMENT);

  /** Инициатор запуска: роль объявлена в самой кнопке стартового события. */
  const canCreateOrder = Boolean(createOrderAction) && currentUser.role === actionRoleOf('CUSTOMER', createOrderAction);

  /**
   * Шаги схемы, которых кабинет не знает поимённо.
   *
   * Кабинет — демо, и поимённо («что записать в payload, в какой журнал
   * записать») он разбирает только свои шаги: их ключи перечислены в
   * `ACTION_ID`. Но блок, добавленный в схеме вместе с кнопкой, тоже должен
   * работать — поэтому такие кнопки собираются здесь. Вычисляемых данных у
   * шага нет: он только двигает токен парой «событие + узел» из схемы, а саму
   * пару подставляет `resolveActionEntry`.
   *
   * Что попадает в список:
   *
   * - кнопки на «текущем шаге» своего контура (`activeStepOf`) — кнопка шага
   *   живёт там, где её объявили, и не всплывает на других шагах процесса;
   * - кроме стартового события: заказ заводит кнопка `createOrder` (со своим
   *   обработчиком), а кнопка старта дублировала бы её;
   * - только «моей» роли — `act:userAction/@role`, а если роли у кнопки нет,
   *   то роли узла (`bpmn:potentialOwner`), как у остальных шагов кабинета.
   *
   * @type {Array<{elementId: string, action: object, stepName: string}>}
   */
  const schemaStepActions = (() => {
    const org = currentUser.org;
    const activeElementId = activeStepOf(currentOrder, org);

    if (!activeElementId) return [];

    const xml = schemaXml(org);
    const startHostId = startStepOf(xml)?.elementId || '';
    const stepNames = listFlowElements(xml).reduce(
      (names, element) => ({ ...names, [element.id]: element.name || element.id }),
      {}
    );

    return listActions(xml)
      .filter((entry) => entry.elementId === activeElementId && entry.elementId !== startHostId)
      .map((entry) => resolveActionEntry(xml, entry))
      .filter((entry) => !KNOWN_ACTION_IDS.includes(entry.action.id))
      // Роль кнопки: своя (`act:userAction/@role`) либо роль узла. Шаг без роли —
      // общая очередь: так ведут себя схемы, где роль не назначена ни задаче, ни
      // кнопке, и загруженный BPMN можно отыграть без правок в редакторе.
      .filter((entry) => {
        const role = actionRoleOf(org, entry);
        return !role || currentUser.role === role;
      })
      .map((entry) => ({ ...entry, stepName: stepNames[entry.elementId] || entry.elementId }));
  })();

  /**
   * Активный шаг — внешняя задача (`bpmn:serviceTask`)?
   *
   * У такого шага нет `act:userAction`: команду публикует движок, а токен
   * двигает ответ воркера. Кабинет показывает подсказку вместо кнопок, чтобы
   * пустой блок действий не читался как ошибка (`schemaStepActions`).
   *
   * @type {{name: string, topic: string}|null}
   */
  const activeExternalTask = (() => {
    const activeElementId = activeStepOf(currentOrder, currentUser.org);
    if (!activeElementId) return null;

    const doc = parseXml(schemaXml(currentUser.org));
    if (!doc) return null;

    const node = Array.from(doc.getElementsByTagName('*')).find(
      (item) => item.getAttribute('id') === activeElementId
    );

    if (!node || getLocalName(node) !== 'serviceTask') return null;

    return {
      name: node.getAttribute('name') || activeElementId,
      topic: node.getAttribute('camunda:topic') || 'default',
    };
  })();

  /* ------------------------------ *
   * Локальный кэш схемы в браузере
   * ------------------------------ */

  const currentOrg = currentUser.org;
  const currentSchemaXml = schemaXml(currentOrg);
  // Правки расходятся с сохранённой копией проекта.
  const isSchemaUnsaved = savedProject.xml !== projectXml;

  /** Подпись бейджа: несохранённые правки / копия в браузере. */
  const schemaSaveLabel = () => {
    if (isSchemaUnsaved) return '⚠ Есть несохранённые изменения';

    const savedAt = formatProjectSavedAt(savedProject.updatedAt);
    return savedAt ? `✅ Сохранено в ${savedAt}` : '✅ Сохранено в браузере';
  };

  /** Кнопка «Сохранить схему»: правки проекта переживут перезагрузку страницы. */
  const handleSaveSchema = () => {
    const record = persistProject(projectXml);

    if (!record) {
      logEvent(currentOrg, 'ALL', 'Схема не сохранена', 'Браузер не дал сохранить схему локально (приватный режим или переполнено хранилище).');
      return;
    }

    logEvent(currentOrg, 'ALL', 'Схема сохранена', `Схема сохранена в браузере в ${formatProjectSavedAt(record.updatedAt)} — правки подхватятся при следующем открытии приложения.`);
  };

  /**
   * Кнопка «Демо-схема»: возвращает демо-процесс своего контура.
   *
   * Проект остаётся проектом: меняется только процесс текущей организации, а
   * процесс второй стороны не трогается — иначе сброс одной стороны ломал бы
   * связи `startsProcess`/`counterpartEvent` другой.
   */
  const handleResetSchema = () => {
    const defaultXml = DEFAULT_SCHEMA_BY_ORG[currentOrg];
    const process = currentOrg === 'SUPPLIER' ? supplierProcess : customerProcess;

    if (!defaultXml || !process) return;

    const nextProjectXml = replaceProcessXml(projectXml, process.id, defaultXml);

    setProjectXml(nextProjectXml);
    persistProject(nextProjectXml);

    logEvent(currentOrg, 'ALL', 'Схема сброшена', `Восстановлена демо-схема ${currentOrg}: процесс заменён в проекте.`);
  };

  const isOrderCompleted = (order) => {
    return order && (order.checkedAt || order.customerProcessState === 'COMPLETED' || order.customerActiveElementId === 'EndEvent_Customer');
  };

  /**
   * Подпись «Состояния» в списке заказов производства.
   *
   * Локальные артефакты сценария (`documents`, `passData`, `entryTime`) сервер
   * не хранит: пока браузер ведёт заказ, они точнее пустых полей. После F5 их
   * нет, и подпись берётся из серверной карточки — статус плюс текущий шаг из
   * `tokens` (M4), а не догадка «Оформление ТТН» по отсутствию документов.
   */
  const getOrderStatusText = (order) => {
    if (!order) return '—';
    if (isOrderCompleted(order)) return 'Выполнен (Молоко в производстве)';

    if (order.entryTime) return 'В работе (Лабораторный анализ ОТК)';
    if (order.passData) return 'В работе (Ожидание проезда КПП)';
    if (order.shippedAt) return 'В работе (Оформление пропуска)';
    if (order.documents) return 'В работе (Отгрузка сырья Поставщиком)';

    // Без локальных артефактов шаг знает только движок.
    const step = order.customerActiveElementId || order.supplierActiveElementId;

    return step ? `${orderStatusText(order)}: ${step}` : orderStatusText(order);
  };

  const RenderActionStatus = ({ orderId }) => {
    const loadingText = actionLoading[orderId];
    const errorText = actionErrors[orderId];

    if (!loadingText && !errorText) return null;

    return (
      <div style={{ marginTop: '12px' }}>
        {loadingText && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1e40af' }}>
            <Loader2 className="spinner-animation" size={18} />
            <span style={{ fontSize: '13px', fontWeight: '500' }}>{loadingText}</span>
          </div>
        )}

        {errorText && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b' }}>
            <AlertCircle size={18} color="#dc2626" />
            <span style={{ fontSize: '13px', fontWeight: '500' }}>{errorText}</span>
          </div>
        )}
      </div>
    );
  };

  /**
   * Поле формы заказа (M4).
   *
   * Подпись видна глазом, `aria-label` — для тестов и скринридеров: у полей нет
   * `id`, а дублировать разметку ради `htmlFor` незачем.
   */
  const OrderField = ({ label, name, type = 'text', min, step }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', fontWeight: '600', color: '#92400e' }}>
      {label}
      <input
        type={type}
        min={min}
        step={step}
        value={orderDraft[name]}
        aria-label={`Поле заказа: ${label}`}
        onChange={(event) => setOrderDraft(prev => ({ ...prev, [name]: event.target.value }))}
        style={{ padding: '6px 8px', border: '1px solid #fcd34d', borderRadius: '6px', fontSize: '12px', color: '#78350f', backgroundColor: '#fff' }}
      />
    </label>
  );

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh', padding: '24px' }}>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spinner-animation {
          animation: spin 1s linear infinite;
        }
      `}</style>

      {/* Шапка */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', backgroundColor: '#fff', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>🥛 ERP «{currentUser.orgName}»</h1>
          <span style={{ fontSize: '13px', color: '#64748b' }}>
            Проект: <strong>{project.name}</strong> | Контур: <strong>{CONTOUR_LABELS[currentUser.org]}</strong> | Оркестратор: {wsConnected ? <strong style={{ color: '#16a34a' }}>✅ Подключен</strong> : <strong style={{ color: '#dc2626' }}>❌ Offline</strong>}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', backgroundColor: '#f1f5f9', borderRadius: '20px' }}>
            <UserIcon size={18} color="#2563eb" />
            <span style={{ fontSize: '13px', fontWeight: '600' }}>{currentUser.roleName}</span>
          </div>

          <button
            onClick={() => { setCurrentUser(null); setProjects(listProjects()); setScreen('projects'); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', backgroundColor: '#fff', color: '#334155', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}
          >
            <FolderOpen size={16} /> Проекты
          </button>

          <button onClick={() => setCurrentUser(null)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', backgroundColor: '#fff', color: '#ef4444', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>
            <LogOut size={16} /> Выход
          </button>
        </div>
      </header>

      {/* Панель внутренних заказов */}
      <div style={{ backgroundColor: '#fff', padding: '14px 20px', borderRadius: '12px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={18} color="#2563eb" /> Внутренние заказы:
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {orders.map(o => {
              const completed = isOrderCompleted(o);
              const isSlaBreached = o.customerProcessState === 'SLA_VIOLATED';

              return (
                <button 
                  key={o.id} 
                  onClick={() => setSelectedOrderId(o.id)} 
                  style={{ 
                    padding: '6px 12px', 
                    borderRadius: '6px', 
                    fontSize: '12px', 
                    fontWeight: '600', 
                    cursor: 'pointer', 
                    border: isSlaBreached ? '2px solid #ef4444' : (o.id === selectedOrderId ? '2px solid #2563eb' : '1px solid #cbd5e1'), 
                    backgroundColor: isSlaBreached ? '#fef2f2' : (o.id === selectedOrderId ? '#eff6ff' : '#f8fafc'), 
                    color: isSlaBreached ? '#991b1b' : (o.id === selectedOrderId ? '#1e40af' : '#475569'), 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px' 
                  }}
                >
                  Заказ {o.id}
                  <span style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: isSlaBreached ? '#ef4444' : (completed ? '#22c55e' : '#eab308') 
                  }} />
                </button>
              );
            })}
            {orders.length === 0 && <span style={{ fontSize: '13px', color: '#94a3b8' }}>Заказов пока нет.</span>}
          </div>
        </div>

        {/* Старт процесса: кнопка инициатора объявлена на стартовом событии
            схемы (`act:userAction`); роль там указана в самой кнопке, потому что
            `bpmn:potentialOwner` по спецификации BPMN 2.0 есть только у Activity. */}
        {canCreateOrder && (
          <ActionButton
            action={createOrderAction.action}
            onClick={handleProductionCreateOrder}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}
          />
        )}
      </div>

      <div id="main-dashboard-container" style={{ display: 'flex', width: '100%', position: 'relative' }}>
        
        {/* ЛЕВАЯ КОЛОНКА */}
        <div style={{ width: `${leftWidth}%`, paddingRight: '8px', boxSizing: 'border-box' }}>
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: '100%' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <UserIcon size={20} color="#2563eb"/> Кабинет: {currentUser.roleName} {currentOrder ? `(Заказ ${currentOrder.id})` : ''}
            </h2>

            {/* Запуск процесса для схемы без кнопки инициатора: загруженный BPMN
                может не объявлять `act:userAction` на стартовом событии, но
                экземпляр всё равно нужен — иначе шаги кабинета не подсветятся. */}
            {!createOrderAction && (
              <div style={{ padding: '16px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Play size={18} /> Запуск по схеме
                </h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#1e3a8a' }}>
                  В схеме нет кнопки инициатора: экземпляр стартует со стартового события, а токен встанет на первый узел процесса.
                </p>
                <button
                  onClick={handleStartBySchema}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}
                >
                  <Play size={16} /> Запустить процесс
                </button>
              </div>
            )}

            {/* 1. РОЛЬ: ПРОИЗВОДСТВО. Запуск процесса — кнопка на стартовом
                событии схемы; в ней же указана роль инициатора (см. `ACTION_ID`). */}
            {canCreateOrder && (
              <div>
                <div style={{ padding: '16px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <PackageCheck size={18} /> Инициация поставок сырья
                  </h3>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#92400e' }}>
                    Создание заказа запускает BPMN-процесс закупки в оркестраторе. Номер
                    заказа продолжает список, а карточка сохраняется в БД движка.
                  </p>

                  {/* Поля заказа (M4): заказ — запись в БД, поэтому номенклатуру,
                      объём и срок вводит пользователь, а не константа «100 Л». */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                    <OrderField label="Номенклатура" name="nomenclature" />
                    <OrderField label="Объём, л" name="volumeLiters" type="number" min={1} step={1} />
                    <OrderField label="Жирность, %" name="fatContent" type="number" min={0} step={0.1} />
                    <OrderField label="Упаковка" name="packaging" />
                    <OrderField label="Срок годности" name="dueDate" type="date" />
                    <OrderField label="Контрагент" name="counterparty" />
                  </div>
                  <ActionButton
                    action={createOrderAction.action}
                    onClick={handleProductionCreateOrder}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}
                  />

                  {currentOrder && <RenderActionStatus orderId={currentOrder.id} />}
                </div>

                <h4 style={{ fontSize: '13px', color: '#334155', marginBottom: '8px' }}>Статус внутренних заказов производства:</h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '8px 12px' }}>№ Заказа</th>
                        <th style={{ padding: '8px 12px' }}>Номенклатура</th>
                        <th style={{ padding: '8px 12px' }}>Объем</th>
                        <th style={{ padding: '8px 12px' }}>Срок</th>
                        <th style={{ padding: '8px 12px' }}>Состояние</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const completed = isOrderCompleted(o);
                        return (
                          <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', backgroundColor: o.id === selectedOrderId ? '#fef3c7' : '#fff' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{o.id}</td>
                            <td style={{ padding: '8px 12px' }}>{o.nomenclature || '—'}</td>
                            <td style={{ padding: '8px 12px' }}>{o.volume}</td>
                            <td style={{ padding: '8px 12px' }}>{formatDueDate(o.dueDate)}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600', backgroundColor: completed ? '#dcfce7' : '#fef3c7', color: completed ? '#15803d' : '#b45309', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                {completed ? <CheckCircle2 size={12}/> : <Clock size={12}/>}
                                {getOrderStatusText(o)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {orders.length === 0 && (
                        <tr><td colSpan={5} style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>Заказов не создано</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2. РОЛЬ: РУКОВОДИТЕЛИ */}
            {isExecutive && (
              <div>
                <div style={{ padding: '16px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', marginBottom: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <BarChart2 size={18} /> Контроль и управление BPMN-схемами
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#1e3a8a' }}>
                    Управляйте графической схемой процесса в правой панели и отправляйте конфигурации в оркестратор.
                  </p>
                </div>

                {/* Инфографика по процессам: руководитель видит время выполнения
                    завершённых запусков — метрика живёт в браузере
                    (`src/metricsStore.js`), поэтому её видно и после F5. */}
                <MetricsPanel
                  runs={processRuns}
                  preferredOrg={currentUser.org}
                  onClear={handleClearMetrics}
                />

                <h4 style={{ fontSize: '13px', color: '#334155', marginBottom: '8px' }}>Все заказы в контуре {currentUser.orgName}:</h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '8px 12px' }}>Заказ</th>
                        <th style={{ padding: '8px 12px' }}>Номенклатура</th>
                        <th style={{ padding: '8px 12px' }}>Инстанс</th>
                        <th style={{ padding: '8px 12px' }}>Текущий шаг</th>
                        <th style={{ padding: '8px 12px' }}>Срок</th>
                        <th style={{ padding: '8px 12px' }}>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', backgroundColor: o.id === selectedOrderId ? '#eff6ff' : '#fff' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{o.id}</td>
                          <td style={{ padding: '8px 12px' }}>{o.nomenclature || '—'}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#64748b' }}>{currentUser.org === 'CUSTOMER' ? o.customerInstanceId : (o.supplierInstanceId || '—')}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#64748b' }}>
                            {(currentUser.org === 'CUSTOMER' ? o.customerActiveElementId : o.supplierActiveElementId) || '—'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>{formatDueDate(o.dueDate)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', backgroundColor: '#dcfce7', color: '#166534' }}>
                              {currentUser.org === 'CUSTOMER' ? o.customerProcessState : o.supplierProcessState}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 3. РОЛЬ: МЕНЕДЖЕР ЗАКУПОК ЗАКАЗЧИКА. Шаги роли — те, где в схеме
                объявлены кнопки `sendToSupplier` и `issuePass` (роль берётся у
                узлов `Task_CreatePurchaseOrder` и `Task_ReceiveDocsAndIssuePass`). */}
            {canWork('CUSTOMER', [ACTION_ID.SEND_TO_SUPPLIER, ACTION_ID.ISSUE_PASS]) && currentOrder && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : isOrderCompleted(currentOrder) ? (
                  <p style={{ color: '#166534', fontSize: '13px' }}>
                    ✅ Процесс закупки по Заказу {currentOrder.id} полностью завершен. Сырье сдано в производство.
                  </p>
                ) : currentOrder.passData ? (
                  <p style={{ color: '#166534', fontSize: '13px' }}>
                    ✅ Электронный пропуск №{currentOrder.passData.passNumber} оформлен и передан на КПП.
                  </p>
                ) : currentOrder.shippedAt || currentOrder.customerActiveElementId === issuePassAction?.elementId ? (
                  <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 4px 0', fontWeight: '600', color: '#15803d' }}>
                      🚚 Поставщик отгрузил молоко по Заказу {currentOrder.id}!
                    </p>
                    {currentOrder.documents && (
                      <p style={{ fontSize: '12px', color: '#475569', margin: '0 0 12px 0' }}>
                        Получены сопроводительные документы: {currentOrder.documents.ttnNumber}, {currentOrder.documents.updNumber} (Водитель: {currentOrder.documents.driverName}, Авто: {currentOrder.documents.vehicleNum})
                      </p>
                    )}
                    <ActionButton
                      action={issuePassAction?.action}
                      onClick={() => handleCustomerIssuePass(currentOrder.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                    />
                  </div>
                ) : currentOrder.supplierInstanceId ? (
                  <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', color: '#15803d', margin: 0, fontWeight: '600' }}>
                      ✅ Заказ {currentOrder.id} отправлен Поставщику.
                    </p>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '6px 0 0 0' }}>
                      Ожидаем отгрузку и поступление ТТН/УПД со стороны ООО «Альпийские Луга»... Кнопка выписки пропуска станет доступна автоматически после подтверждения отгрузки Поставщиком.
                    </p>
                  </div>
                ) : (
                  <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>
                      Получен внутренний заказ <strong>{currentOrder.id}</strong> от Производства на 100 л молока. Передать его Поставщику?
                    </p>
                    <ActionButton
                      action={sendToSupplierAction?.action}
                      onClick={() => handleCustomerSendOrderToSupplier(currentOrder.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                    />
                  </div>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 4. РОЛЬ: МЕНЕДЖЕР ПОСТАВЩИКА. Шаги роли — кнопки `createDocs` и
                `shipment` в схеме Поставщика. */}
            {canWork('SUPPLIER', [ACTION_ID.CREATE_DOCS, ACTION_ID.SHIPMENT]) && currentOrder && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : currentOrder.shippedAt ? (
                  <p style={{ color: '#166534', fontSize: '13px' }}>
                    ✅ Отгрузка по Заказу {currentOrder.id} выполнена. Документы у Заказчика.
                  </p>
                ) : currentOrder.documents || currentOrder.supplierActiveElementId === shipmentAction?.elementId ? (
                  <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 4px 0', fontWeight: '600' }}>Пакет документов сформирован ({currentOrder.documents?.ttnNumber})</p>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 12px 0' }}>Подтвердите факт отгрузки автоцистерны со склада для передачи сигнала Заказчику.</p>
                    <ActionButton
                      action={shipmentAction?.action}
                      onClick={() => handleSupplierShipment(currentOrder.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                    />
                  </div>
                ) : currentOrder.supplierInstanceId ? (
                  <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>Поступила заявка {currentOrder.id} от Заказчика. Сформировать пакет документов?</p>
                    <ActionButton
                      action={createDocsAction?.action}
                      onClick={() => handleSupplierCreateDocs(currentOrder.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                    />
                  </div>
                ) : (
                  <p style={{ color: '#64748b', fontSize: '13px' }}>Ожидание передачи заказа от Заказчика...</p>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 5. РОЛЬ: ОХРАНА КПП ЗАКАЗЧИКА. Шаг роли — кнопка `securityPass`
                на узле `Task_SecurityCheck` схемы. */}
            {canWork('CUSTOMER', [ACTION_ID.SECURITY_PASS]) && currentOrder && (
              <div>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : currentOrder.customerActiveElementId === securityPassAction?.elementId || (currentOrder.passData && !currentOrder.entryTime) ? (
                  <div style={{ padding: '16px', backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#92400e' }}>🚚 Автоцистерна на КПП [Заказ {currentOrder.id}]</h4>
                    <p style={{ fontSize: '12px', color: '#b45309', margin: '0 0 12px 0' }}>
                      Пропуск №{currentOrder.passData?.passNumber} оформлен. Подтвердите проверку и откройте ворота.
                    </p>
                    <ActionButton
                      action={securityPassAction?.action}
                      onClick={() => handleSecurityCheckAndPass(currentOrder.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                    />
                  </div>
                ) : currentOrder.shippedAt && !currentOrder.passData ? (
                  <div style={{ padding: '16px', backgroundColor: '#fff7ed', border: '1px solid #ffedd5', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertCircle size={18} /> 🚚 Машина отгружена Поставщиком, но пропуск еще не оформлен!
                    </h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#9a3412' }}>
                      Автоцистерна находится в пути / у КПП. Менеджер закупок еще не выписал электронный пропуск. Въезд <strong>запрещен</strong> до выписки пропуска.
                    </p>
                  </div>
                ) : (
                  <p style={{ color: '#64748b', fontSize: '13px' }}>Ожидание отгрузки сырья Поставщиком...</p>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 6. РОЛЬ: СПЕЦИАЛИСТ ОТК ЗАКАЗЧИКА. Шаг роли — кнопка
                `qualityApprove` на узле `Task_QualityControl` схемы. */}
            {canWork('CUSTOMER', [ACTION_ID.QUALITY_APPROVE]) && currentOrder && (
              <div>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : currentOrder.customerActiveElementId === qualityApproveAction?.elementId || (currentOrder.entryTime && !isOrderCompleted(currentOrder)) ? (
                  <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>🧪 Сырье доставлено. Провести экспресс-анализ молока [Заказ {currentOrder.id}].</p>
                    <ActionButton
                      action={qualityApproveAction?.action}
                      onClick={() => handleQualityApprove(currentOrder.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#15803d', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                    />
                  </div>
                ) : (
                  <p style={{ color: '#64748b', fontSize: '14px' }}>Ожидание въезда сырья для лаборатории...</p>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 7. ШАГИ СХЕМЫ БЕЗ ОБРАБОТЧИКА. Блок, добавленный в редакторе вместе
                с кнопкой, работает без правок кода: на текущем шаге показываем ту
                кнопку, чья роль (`role` либо `bpmn:potentialOwner` узла) — моя.
                Payload такому шагу не нужен: он только двигает токен, а событие и
                узел для этого доводит схема (`handleSchemaStepAction`). */}
            {currentOrder && schemaStepActions.length > 0 && (
              <div>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : (
                  schemaStepActions.map((entry) => (
                    <div
                      key={entry.elementId + ':' + entry.action.id}
                      style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '16px' }}
                    >
                      <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>
                        📋 Шаг «{entry.stepName}» по схеме процесса [Заказ {currentOrder.id}].
                      </p>
                      {entry.action.elementId ? (
                        <ActionButton
                          action={entry.action}
                          onClick={() => handleSchemaStepAction(entry, currentOrder)}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                        />
                      ) : (
                        /* Нажимать нечего: движок двигает токен узлом события, а у
                           блока нет единственной исходящей связи — узел нужно
                           назвать в кнопке (инспектор узлов). */
                        <p style={{ fontSize: '12px', color: '#b45309', margin: 0 }}>
                          Шаг некуда выполнить: кнопка не объявляет узел, а у блока нет единственной исходящей связи. Заполните «Узел после нажатия» в инспекторе узлов.
                        </p>
                      )}
                    </div>
                  ))
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 7.1. ВНЕШНЯЯ ЗАДАЧА (`bpmn:serviceTask`). Кнопок у шага нет:
                движок уже опубликовал команду воркеру, и токен сдвинет его
                ответ. Подсказка объясняет пустой блок действий. */}
            {currentOrder && schemaStepActions.length === 0 && activeExternalTask && (
              <div style={{ padding: '16px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ fontSize: '14px', margin: '0 0 8px 0', color: '#1e40af' }}>
                  ⚙️ Шаг «{activeExternalTask.name}» исполняет внешняя система (тема <code>{activeExternalTask.topic}</code>) [Заказ {currentOrder.id}].
                </p>
                <p style={{ fontSize: '12px', margin: 0, color: '#1e3a8a' }}>
                  Команда опубликована в <code>mes.out.v1.cmd.{activeExternalTask.topic}</code>.
                  Результат придёт в кабинет автоматически: ответ воркера двигает процесс дальше.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Разделитель */}
        <div onMouseDown={handleColumnResizeMouseDown} style={{ width: '8px', cursor: 'col-resize', backgroundColor: '#e2e8f0', borderRadius: '4px', margin: '0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <div style={{ width: '2px', height: '24px', backgroundColor: '#94a3b8', borderRadius: '1px' }} />
        </div>

        {/* ПРАВАЯ КОЛОНКА */}
        <div style={{ width: `${100 - leftWidth}%`, paddingLeft: '8px', boxSizing: 'border-box' }}>
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: '100%' }}>
             
             {isExecutive ? (
               <div>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                   <h3 style={{ margin: 0, fontSize: '15px', color: '#1e293b' }}>
                     BPMN Схема: {currentUser.org === 'CUSTOMER' ? 'Заказчика' : 'Поставщика'} {currentOrder ? `[Заказ ${currentOrder.id}]` : ''}
                   </h3>

                   {/* Кэш схемы в браузере: сохранение и подпись состояния копии */}
                   <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginLeft: 'auto' }}>
                     <span
                       data-testid="schema-save-state"
                       style={{ fontSize: '12px', fontWeight: '600', color: isSchemaUnsaved ? '#b45309' : '#15803d' }}
                     >
                       {schemaSaveLabel()}
                     </span>

                     <button
                       onClick={handleSaveSchema}
                       title="Сохранить схему в браузере: правки подхватятся при следующем открытии приложения"
                       style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#15803d', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}
                     >
                       <Save size={14} /> Сохранить схему
                     </button>

                     <button
                       onClick={handleResetSchema}
                       title="Вернуть демо-схему из SDK и удалить сохранённую в браузере копию"
                       style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#fff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}
                     >
                       <RotateCcw size={14} /> Демо-схема
                     </button>
                   </div>

                   <button 
                     onClick={() => deployBpmnSchema(currentUser.org, currentUser.org === 'CUSTOMER' ? customerBpmnXml : supplierBpmnXml)} 
                     disabled={isDeploying} 
                     style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '12px' }}
                   >
                     <Upload size={14} /> {isDeploying ? 'Деплой...' : 'Задеплоить BPMN в Оркестратор'}
                   </button>
                 </div>

                 {/* Переключение режима: просмотр с токенами / редактор схемы */}
                 <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                   {[
                     { mode: 'view', title: 'Просмотр процесса', Icon: Layers },
                     { mode: 'edit', title: 'Редактор схемы', Icon: Pencil }
                   ].map(({ mode, title, Icon }) => {
                     const isActive = schemaMode === mode;
                     return (
                       <button
                         key={mode}
                         onClick={() => setSchemaMode(mode)}
                         style={{
                           display: 'flex', alignItems: 'center', gap: '6px',
                           padding: '6px 12px', fontSize: '12px', fontWeight: '600',
                           borderRadius: '6px', cursor: 'pointer',
                           border: `1px solid ${isActive ? '#2563eb' : '#cbd5e1'}`,
                           backgroundColor: isActive ? '#eff6ff' : '#fff',
                           color: isActive ? '#1d4ed8' : '#475569'
                         }}
                       >
                         <Icon size={14} /> {title}
                       </button>
                     );
                   })}
                 </div>

                  {/* Схема несовместима с движком: определение не
                      скомпилируется, токенов не будет, и процесс не
                      запустится. Предупреждаем до деплоя — сам движок об этом
                      отказе молчит. */}
                  {engineProblems.length > 0 && (
                    <div
                      data-testid="schema-problems"
                      style={{ marginBottom: '12px', padding: '10px 12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b' }}
                    >
                      <strong style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertCircle size={14} /> Схема несовместима с движком ({engineProblems.length}): процесс по ней не запустится
                      </strong>
                      <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px', fontSize: '11px' }}>
                        {engineProblems.slice(0, 4).map((problem) => (
                          <li key={`${problem.code}:${problem.elementId}:${problem.flowId}:${problem.message}`}>
                            {problem.message}{problem.hint ? ` ${problem.hint}` : ''}
                          </li>
                        ))}
                        {engineProblems.length > 4 && <li>и ещё {engineProblems.length - 4}…</li>}
                      </ul>
                    </div>
                  )}

                 {!currentSchemaXml ? (
                   <p style={{ fontSize: '13px', color: '#b45309', margin: 0 }}>
                     В проекте нет процесса для этого контура: добавьте второй процесс или откройте другой проект.
                   </p>
                 ) : schemaMode === 'edit' ? (
                   /* Редактор правит проект целиком: второй процесс виден на холсте,
                      а роли и триггеры подсказываются из всей схемы. */
                   <BpmnEditor
                     xml={projectXml}
                     onChange={setProjectXml}
                     roleOptions={analysis.roleCodes}
                     triggerTargets={currentOrg === 'CUSTOMER' ? customerTriggerTargets : supplierTriggerTargets}
                     height={520}
                   />
                 ) : (
                   /* Просмотрщик показывает проект, поэтому подсветка собирается из
                      токенов обоих экземпляров: у сторон свои узлы и свои токены. */
                   <BpmnViewer
                     xml={projectXml}
                     tokens={mergeTokens(
                       tokensFor(currentOrder?.customerInstanceId),
                       tokensFor(currentOrder?.supplierInstanceId)
                     )}
                     activeElementId={
                       currentOrg === 'SUPPLIER'
                         ? currentOrder?.supplierActiveElementId
                         : currentOrder?.customerActiveElementId
                     }
                     height={520}
                   />
                 )}
               </div>
             ) : (
               <div>
                 <h3 style={{ marginTop: 0, fontSize: '16px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <History size={18} color="#2563eb" /> Журнал событий процесса
                 </h3>

                 <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '480px', overflowY: 'auto' }}>
                    {myNotifications.map((item) => (
                      <div key={item.id} style={{ borderLeft: '4px solid #2563eb', backgroundColor: '#f8fafc', padding: '10px', borderRadius: '0 6px 6px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <strong style={{ fontSize: '12px', color: '#0f172a' }}>{item.title}</strong>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>{item.timestamp}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '11px', color: '#475569' }}>{item.message}</p>
                      </div>
                    ))}
                 </div>
               </div>
             )}

          </div>
        </div>

      </div>
    </div>
  );
}