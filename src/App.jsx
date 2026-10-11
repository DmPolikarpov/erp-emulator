import React, { useCallback, useEffect, useState } from 'react';
import {
  BpmnEditor,
  BpmnViewer,
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_GATEWAY_URL,
  DEFAULT_SUPPLIER_BPMN_XML,
  INSTANCE_PREFIX,
  SOCKET_EVENTS,
  TOKEN_STATES,
  createUuid,
  getElementRole,
  isDeployInstanceId,
  useBpmnEngine,
  useProcessTokens,
} from './vendor/bpmn-sdk';
import { 
  Truck, ShieldCheck, ClipboardCheck, FileText, Upload, Send, 
  LogOut, History, KeyRound, Layers, PlusCircle, BarChart2,
  PackageCheck, Clock, CheckCircle2, Loader2, AlertCircle, Pencil,
  Save, RotateCcw
} from 'lucide-react';
import { ROLE_CODES, USERS } from './roles';
import {
  clearSchema,
  formatSavedAt,
  loadSchema,
  saveSchema,
} from './schemaStore';

// Базовый URL API Gateway: `REACT_APP_GATEWAY_URL` (см. `.env`) либо
// относительный путь — тогда запросы идут через CRA-прокси (`package.json`).
const API_BASE_URL = DEFAULT_GATEWAY_URL;

/** Демо-схемы SDK по организациям — точка отсчёта правок в редакторе. */
const DEFAULT_SCHEMA_BY_ORG = {
  CUSTOMER: DEFAULT_CUSTOMER_BPMN_XML,
  SUPPLIER: DEFAULT_SUPPLIER_BPMN_XML,
};

/**
 * Стартовое событие процесса — узел, который называет событие `StartProcess`.
 *
 * В его `payload` уходит `bpmn_xml`: по нему движок компилирует определение,
 * поэтому схему нельзя перенести на другое событие старта.
 */
const START_EVENT_BY_ORG = {
  CUSTOMER: 'StartEvent_Customer',
  SUPPLIER: 'StartEvent_Supplier',
};

/**
 * Первый шаг каждой схемы — узел сразу после стартового события.
 *
 * Движок не делает переходов сам: событие называет узел, который станет
 * `ACTIVE`, а прежний активный узел закрывается как `COMPLETED`. Поэтому старт
 * процесса — это два события (см. `startProcess`): `StartProcess` ставит токен
 * на стартовое событие, а второе событие переносит его на первый шаг. Без
 * второго события «текущий шаг» интерфейса (`customerActiveElementId` /
 * `supplierActiveElementId` — в них пишется первый блок) существует только в
 * браузере: движок закроет как `COMPLETED` стартовое событие, а первый блок в
 * его состоянии вообще не появится — после выполнения он не покрасится.
 */
const FIRST_STEP_BY_ORG = {
  CUSTOMER: {
    event: 'StartPurchaseOrder',
    elementId: 'Task_CreatePurchaseOrder',
  },
  SUPPLIER: {
    event: 'StartSupplierDocs',
    elementId: 'Task_SupplierCreateDocs',
  },
};

/**
 * Схема организации на старте приложения.
 *
 * Приоритет у копии, сохранённой в браузере (`src/schemaStore.js`): правки
 * редактора переживают перезагрузку страницы. Если копии нет — демо-схема SDK.
 * Читаем кэш лениво (`useState(() => ...)`), то есть ровно один раз при
 * монтировании, а не на каждый рендер.
 */
const initialSchemaXml = (org) => loadSchema(org)?.xml || DEFAULT_SCHEMA_BY_ORG[org];

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

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loginInput, setLoginInput] = useState('production');
  const [passwordInput, setPasswordInput] = useState('123');
  const [authError, setAuthError] = useState('');

  // Схема стороны: копия из браузера (если редактор её сохранял) либо демо-схема.
  const [customerBpmnXml, setCustomerBpmnXml] = useState(() => initialSchemaXml('CUSTOMER'));
  const [supplierBpmnXml, setSupplierBpmnXml] = useState(() => initialSchemaXml('SUPPLIER'));

  // Сохранённые в браузере копии схем по организациям: из них складывается
  // бейдж «Сохранено в …» и индикатор несохранённых правок.
  const [savedSchemas, setSavedSchemas] = useState(() => ({
    CUSTOMER: loadSchema('CUSTOMER'),
    SUPPLIER: loadSchema('SUPPLIER'),
  }));
  
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

  /** Роль исполнителя узла по схеме (`''` — роль не назначена). */
  const roleOf = useCallback(
    (org, elementId) => getElementRole(schemaXml(org), elementId),
    [schemaXml]
  );

  /**
   * Может ли текущий пользователь вести хотя бы один из перечисленных шагов.
   *
   * Роли живут в схеме (`bpmn:potentialOwner`), а не в коде: перераспределить
   * шаг между ролями можно в редакторе схемы, и интерфейс поедет за ней.
   * Организация берётся из её собственной схемы: у Заказчика и Поставщика
   * свои процессы и свои назначения.
   */
  const canWork = useCallback(
    (org, elementIds) => {
      if (!currentUser) return false;

      return elementIds.some((elementId) => roleOf(org, elementId) === currentUser.role);
    },
    [currentUser, roleOf]
  );

  /**
   * Запускает экземпляр процесса и ставит токен на его первый шаг.
   *
   * Событий два, а не одно: `StartProcess` называет стартовое событие (и несёт
   * `bpmn_xml` — по нему движок компилирует определение), а событие первого
   * шага переводит токен со стартового события на первый блок схемы. Иначе
   * подсветка первого шага живёт только в интерфейсе, и после его выполнения
   * зелёным станет стартовое событие, а сам блок — нет (см. `FIRST_STEP_BY_ORG`).
   *
   * @param {'CUSTOMER'|'SUPPLIER'} org чья схема запускает процесс.
   * @param {string} instanceId идентификатор нового экземпляра процесса.
   * @param {string} bpmnXml схема стороны (`bpmn_xml` для движка).
   * @param {Object} [payload] выходные данные запуска: уходят в оба события,
   *   поэтому во втором схему передавать не нужно.
   * @returns {Promise<{start: Object, step: Object|null}>} ответы шлюза;
   *   `step === null`, если экземпляр процесса не создан.
   */
  const startProcess = useCallback(
    async (org, instanceId, bpmnXml, payload = {}) => {
      const firstStep = FIRST_STEP_BY_ORG[org];

      const start = await client.sendEvent(
        instanceId,
        'StartProcess',
        START_EVENT_BY_ORG[org],
        { bpmn_xml: bpmnXml, ...payload }
      );

      if (!start.ok) return { start, step: null };

      const step = await client.sendEvent(
        instanceId,
        firstStep.event,
        firstStep.elementId,
        payload
      );

      return { start, step };
    },
    [client]
  );

  const [schemaMode, setSchemaMode] = useState('view');
  const [isDeploying, setIsDeploying] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);

  const [orders, setOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  const [actionLoading, setActionLoading] = useState({});
  const [actionErrors, setActionErrors] = useState({});

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

  /**
   * Пишет схему организации в кэш браузера (`localStorage`).
   *
   * Возвращает запись либо `null`: хранилище может быть недоступно
   * (приватный режим, переполненная квота) — тогда правки остаются только в
   * состоянии React, и текущая сессия работает как раньше.
   */
  const cacheBpmnSchema = (orgType, xmlData) => {
    const record = saveSchema(orgType, xmlData);
    if (record) setSavedSchemas((prev) => ({ ...prev, [orgType]: record }));
    return record;
  };

  // Деплой схемы: SDK сам формирует служебный экземпляр `inst-deploy-<org>`,
  // имя события `DeploySchema` и `element_id` = `Process_Deployment`.
  const deployBpmnSchema = async (orgType, xmlData) => {
    setIsDeploying(true);
    const result = await client.deploySchema(orgType, xmlData);
    if (result.ok) {
      // Деплой обновляет и копию в браузере: определение процесса в кластере и
      // схема, которую показывает кабинет, не должны расходиться после F5.
      cacheBpmnSchema(orgType, xmlData);
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

      logEvent('SYSTEM', 'ALL', 'Событие Оркестратора', `Инстанс ${instanceId} -> Узел: ${elementId || '—'} [Статус: ${state}]`);
    });
  }, [socket, logEvent]);

  // 1. ТОЧКА ВХОДА: Создание заказа Производством
  const handleProductionCreateOrder = async () => {
    const orderNum = `№${101 + orders.length}`;
    const custInstId = `inst-cust-${Math.random().toString(36).substring(2, 8)}`;

    setActionLoading(prev => ({ ...prev, [orderNum]: 'Создание заказа в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderNum]: null }));

    // Запуск процесса: `StartProcess` ставит токен на стартовое событие, второе
    // событие переносит его на первый шаг — `Task_CreatePurchaseOrder`.
    const { start, step } = await startProcess('CUSTOMER', custInstId, customerBpmnXml, {
      orderNum, volume: '100 Л', initiator: 'PRODUCTION'
    });

    if (start.ok) {
      const pendingOrder = {
        id: orderNum,
        createdAt: new Date().toLocaleTimeString('ru-RU'),
        volume: '100 Л',
        customerInstanceId: custInstId,
        // Первый шаг процесса (`FIRST_STEP_BY_ORG`): `startProcess` уже поставил
        // на этот узел токен в движке, поэтому подсветка и «текущий шаг» сходятся.
        customerActiveElementId: FIRST_STEP_BY_ORG.CUSTOMER.elementId,
        customerProcessState: 'ACTIVE',
        supplierInstanceId: null,
        documents: null, passData: null, shippedAt: null, entryTime: null, checkedAt: null
      };
      setOrders(prev => [pendingOrder, ...prev]);
      setSelectedOrderId(orderNum);

      // Кого уведомлять — тоже решает схема: роль первого шага процесса
      // (`FIRST_STEP_BY_ORG.CUSTOMER`) плюс роль того, кто действие выполнил.
      // Если роли в схеме не назначены, уведомление никому не адресуется.
      const notifyRoles = [
        currentUser ? currentUser.role : '',
        roleOf('CUSTOMER', FIRST_STEP_BY_ORG.CUSTOMER.elementId),
      ].filter(Boolean);

      logEvent('CUSTOMER', notifyRoles, 'Заявка производства сформирована', `Запущен процесс для ${orderNum}`, orderNum);

      // Экземпляр создан, а токен остался на стартовом событии: заказ в списке
      // есть, но подсветки первого шага на схеме не будет — движок о таком шаге
      // не знает. Пишем это в журнал: молчаливая потеря подсветки — это та же
      // ошибка, только без объяснения (см. `startProcess`).
      if (step && !step.ok) {
        logEvent('SYSTEM', notifyRoles, 'Токен не встал на первый шаг', `Узел ${FIRST_STEP_BY_ORG.CUSTOMER.elementId} остался без подсветки: движок держит токен на ${START_EVENT_BY_ORG.CUSTOMER}`, orderNum);
      }
    } else {
      setActionLoading(prev => ({ ...prev, [orderNum]: null }));
      setActionErrors(prev => ({ ...prev, [orderNum]: 'Произошла ошибка при запуске заказа. Попробуйте еще раз.' }));
    }
  };

  // 2. Менеджер закупок передает заказ Поставщику -> Переводим в узел ожидания Task_WaitForSupplierShipment
  const handleCustomerSendOrderToSupplier = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    const suppInstId = `inst-supp-${Math.random().toString(36).substring(2, 8)}`;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Оркестратор передает заказ Поставщику...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const resCust = await client.sendEvent(
      targetOrder.customerInstanceId, 'SendToSupplier', 'Task_WaitForSupplierShipment', 
      { status: 'SENT_TO_SUPPLIER', supplierInstanceId: suppInstId, orderNum: orderId }
    );

    if (resCust.ok) {
      // Процесс Поставщика стартует так же — стартовое событие плюс постановка
      // токена на первый шаг (`Task_SupplierCreateDocs`), см. `startProcess`.
      const { start: resSupp, step: resSuppStep } = await startProcess(
        'SUPPLIER', suppInstId, supplierBpmnXml, { orderNum: orderId }
      );

      if (!resSupp.ok) {
        setActionLoading(prev => ({ ...prev, [orderId]: null }));
        setActionErrors(prev => ({ ...prev, [orderId]: 'Ошибка создания процесса у Поставщика. Попробуйте еще раз.' }));
      } else if (resSuppStep && !resSuppStep.ok) {
        logEvent('SYSTEM', 'ALL', 'Токен не встал на первый шаг Поставщика', `Узел ${FIRST_STEP_BY_ORG.SUPPLIER.elementId} остался без подсветки: движок держит токен на ${START_EVENT_BY_ORG.SUPPLIER}`, orderId);
      }
    } else {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при отправке в оркестратор. Попробуйте еще раз.' }));
    }
  };

  // 3. Поставщик создает документы
  const handleSupplierCreateDocs = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder || !targetOrder.supplierInstanceId) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Формирование и регистрация ТТН/УПД в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const generatedDocs = {
      updNumber: `УПД-${Math.floor(1000 + Math.random() * 9000)}`,
      ttnNumber: `ТТН-${Math.floor(10000 + Math.random() * 90000)}`,
      vehicleNum: `А${Math.floor(100 + Math.random() * 900)}АА 777`,
      driverName: 'Иванов И.И.',
    };

    const res = await client.sendEvent(
      targetOrder.supplierInstanceId, 'CreateDocs', 'Task_SupplierShipment', 
      { documents: generatedDocs, orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при сохранении документов. Попробуйте еще раз.' }));
    }
  };

  // 4. Поставщик отгружает сырье -> Отправляет сигнал и переводит Заказчика на Task_ReceiveDocsAndIssuePass
  const handleSupplierShipment = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder || !targetOrder.supplierInstanceId) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Регистрация отгрузки в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const shippedAt = new Date().toLocaleTimeString('ru-RU');

    // 1. Финализируем процесс Поставщика
    const resSupp = await client.sendEvent(
      targetOrder.supplierInstanceId, 'Shipment', 'EndEvent_Supplier', 
      { shippedAt, orderNum: orderId }
    );

    if (resSupp.ok) {
      // 2. Отправляем триггер в процесс Заказчика, передавая документы и активируя шаг выписки пропуска!
      const resCust = await client.sendEvent(
        targetOrder.customerInstanceId, 'SupplierShippedSignal', 'Task_ReceiveDocsAndIssuePass', 
        { shippedAt, orderNum: orderId, documents: targetOrder.documents }
      );

      if (!resCust.ok) {
        setActionErrors(prev => ({ ...prev, [orderId]: 'Не удалось передать сигнал об отгрузке Заказчику.' }));
      }
    } else {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при подтверждении отгрузки. Попробуйте еще раз.' }));
    }
  };

  // 5. Менеджер Заказчика выписывает пропуск -> Продвигаем узел Заказчика на Task_SecurityCheck
  const handleCustomerIssuePass = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Выписка электронного пропуска...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const pass = {
      passNumber: `ПР-${Math.floor(100000 + Math.random() * 900000)}`,
      status: 'ISSUED',
      issuedAt: new Date().toLocaleTimeString('ru-RU')
    };

    const res = await client.sendEvent(
      targetOrder.customerInstanceId, 'IssuePass', 'Task_SecurityCheck', 
      { passData: pass, orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при выписке пропуска. Попробуйте еще раз.' }));
    }
  };

  // 6. Охрана КПП пропускает автоцистерну -> Продвигаем узел Заказчика на Task_QualityControl
  const handleSecurityCheckAndPass = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Фиксация въезда транспорта на КПП...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const entryTime = new Date().toLocaleTimeString('ru-RU');
    const res = await client.sendEvent(
      targetOrder.customerInstanceId, 'SecurityPass', 'Task_QualityControl', 
      { entryTime, orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при регистрации въезда. Попробуйте еще раз.' }));
    }
  };

  // 7. ОТК принимает качество и передает сырье в Производство -> Продвигаем узел Заказчика на EndEvent_Customer
  const handleQualityApprove = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    if (!targetOrder) return;

    setActionLoading(prev => ({ ...prev, [orderId]: 'Завершение проверки качества в оркестраторе...' }));
    setActionErrors(prev => ({ ...prev, [orderId]: null }));

    const checkedAt = new Date().toLocaleTimeString('ru-RU');
    const res = await client.sendEvent(
      targetOrder.customerInstanceId, 'QualityApprove', 'EndEvent_Customer', 
      { checkedAt, status: 'COMPLETED', orderNum: orderId }
    );

    if (!res.ok) {
      setActionLoading(prev => ({ ...prev, [orderId]: null }));
      setActionErrors(prev => ({ ...prev, [orderId]: 'Произошла ошибка при подтверждении ОТК. Попробуйте еще раз.' }));
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const found = USERS.find(u => u.username === loginInput && u.pass === passwordInput);
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

  if (!currentUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0f172a', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
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

          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '8px', fontWeight: '600' }}>Быстрый доступ (пароль 123):</span>
            
            <div style={{ fontSize: '11px', color: '#1e3a8a', fontWeight: 'bold', marginBottom: '4px' }}>1. ЗАКАЗЧИК (Молочный Завод):</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
              {USERS.filter(u => u.org === 'CUSTOMER').map(u => (
                <button key={u.username} onClick={() => { setLoginInput(u.username); setPasswordInput(u.pass); setCurrentUser(u); setAuthError(''); }} style={{ padding: '6px 8px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', backgroundColor: u.role === 'PRODUCTION' ? '#fef3c7' : u.role === 'EXECUTIVE' ? '#dbeafe' : '#f8fafc' }}>
                  {u.roleName}
                </button>
              ))}
            </div>

            <div style={{ fontSize: '11px', color: '#166534', fontWeight: 'bold', marginBottom: '4px' }}>2. ПОСТАВЩИК (ООО «Альпийские Луга»):</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {USERS.filter(u => u.org === 'SUPPLIER').map(u => (
                <button key={u.username} onClick={() => { setLoginInput(u.username); setPasswordInput(u.pass); setCurrentUser(u); setAuthError(''); }} style={{ padding: '6px 8px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', textAlign: 'left', backgroundColor: u.role === 'SUPPLIER_EXECUTIVE' ? '#dcfce7' : '#f8fafc' }}>
                  {u.roleName}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isExecutive = currentUser.role === 'EXECUTIVE' || currentUser.role === 'SUPPLIER_EXECUTIVE';
  const myNotifications = notifications.filter(n => n.role === 'ALL' || (n.org === currentUser.org && n.role === currentUser.role));
  const UserIcon = currentUser.icon;
  const currentOrder = orders.find(o => o.id === selectedOrderId) || orders[0] || null;

  /* ------------------------------ *
   * Локальный кэш схемы в браузере
   * ------------------------------ */

  const currentOrg = currentUser.org;
  const currentSchemaXml = schemaXml(currentOrg);
  const savedSchema = savedSchemas[currentOrg];
  // Правки расходятся с сохранённой копией, а если копии ещё нет — с демо-схемой.
  const isSchemaUnsaved =
    (savedSchema ? savedSchema.xml : DEFAULT_SCHEMA_BY_ORG[currentOrg]) !== currentSchemaXml;

  /** Подпись бейджа: несохранённые правки / копия в браузере / демо-схема. */
  const schemaSaveLabel = () => {
    if (isSchemaUnsaved) return '⚠ Есть несохранённые изменения';
    if (!savedSchema) return 'Схема по умолчанию';

    const savedAt = formatSavedAt(savedSchema.savedAt);
    return savedAt ? `✅ Сохранено в ${savedAt}` : '✅ Сохранено в браузере';
  };

  /** Кнопка «Сохранить схему»: правки переживут перезагрузку страницы. */
  const handleSaveSchema = () => {
    const record = cacheBpmnSchema(currentOrg, currentSchemaXml);

    if (!record) {
      logEvent(currentOrg, 'ALL', 'Схема не сохранена', 'Браузер не дал сохранить схему локально (приватный режим или переполнено хранилище).');
      return;
    }

    logEvent(currentOrg, 'ALL', 'Схема сохранена', `Схема сохранена в браузере в ${formatSavedAt(record.savedAt)} — правки подхватятся при следующем открытии приложения.`);
  };

  /** Кнопка «Демо-схема»: забывает копию в браузере и возвращает схему из SDK. */
  const handleResetSchema = () => {
    clearSchema(currentOrg);
    setSavedSchemas((prev) => ({ ...prev, [currentOrg]: null }));

    const defaultXml = DEFAULT_SCHEMA_BY_ORG[currentOrg];
    if (currentOrg === 'SUPPLIER') setSupplierBpmnXml(defaultXml);
    else setCustomerBpmnXml(defaultXml);

    logEvent(currentOrg, 'ALL', 'Схема сброшена', `Восстановлена демо-схема ${currentOrg}, сохранённая копия удалена.`);
  };

  const isOrderCompleted = (order) => {
    return order && (order.checkedAt || order.customerProcessState === 'COMPLETED' || order.customerActiveElementId === 'EndEvent_Customer');
  };

  const getOrderStatusText = (order) => {
    if (!order) return '—';
    if (isOrderCompleted(order)) return 'Выполнен (Молоко в производстве)';
    if (!order.supplierInstanceId) return 'В работе (Рассмотрение Закупки)';
    if (!order.documents) return 'В работе (Оформление ТТН Поставщиком)';
    if (!order.shippedAt) return 'В работе (Отгрузка сырья Поставщиком)';
    if (!order.passData) return 'В работе (Оформление пропуска)';
    if (!order.entryTime) return 'В работе (Ожидание проезда КПП)';
    return 'В работе (Лабораторный анализ ОТК)';
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
            Контур: <strong>{currentUser.org === 'CUSTOMER' ? 'Заказчик' : 'Поставщик'}</strong> | Оркестратор: {wsConnected ? <strong style={{ color: '#16a34a' }}>✅ Подключен</strong> : <strong style={{ color: '#dc2626' }}>❌ Offline</strong>}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', backgroundColor: '#f1f5f9', borderRadius: '20px' }}>
            <UserIcon size={18} color="#2563eb" />
            <span style={{ fontSize: '13px', fontWeight: '600' }}>{currentUser.roleName}</span>
          </div>

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

        {/* Старт процесса: `bpmn:potentialOwner` по спецификации есть только у
            Activity, поэтому у `StartEvent_Customer` роли в схеме быть не может —
            инициатора запуска клиент знает сам (см. README, «Роль исполнителя»). */}
        {currentUser.role === 'PRODUCTION' && (
          <button onClick={handleProductionCreateOrder} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
            <PlusCircle size={16} /> Сформировать заказ на 100 л сырого молока
          </button>
        )}
      </div>

      <div id="main-dashboard-container" style={{ display: 'flex', width: '100%', position: 'relative' }}>
        
        {/* ЛЕВАЯ КОЛОНКА */}
        <div style={{ width: `${leftWidth}%`, paddingRight: '8px', boxSizing: 'border-box' }}>
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: '100%' }}>
            <h2 style={{ marginTop: 0, fontSize: '16px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
               <UserIcon size={20} color="#2563eb"/> Кабинет: {currentUser.roleName} {currentOrder ? `(Заказ ${currentOrder.id})` : ''}
            </h2>

            {/* 1. РОЛЬ: ПРОИЗВОДСТВО. Запуск процесса — не шаг схемы: у событий
                нет `resourceRole`, поэтому инициатор задан ролью пользователя. */}
            {currentUser.role === 'PRODUCTION' && (
              <div>
                <div style={{ padding: '16px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <PackageCheck size={18} /> Инициация поставок сырья
                  </h3>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#92400e' }}>
                    Создание заказа запускает BPMN-процесс закупки в оркестраторе.
                  </p>
                  <button onClick={handleProductionCreateOrder} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                    <PlusCircle size={16} /> Создать внутренний заказ на 100 л
                  </button>

                  {currentOrder && <RenderActionStatus orderId={currentOrder.id} />}
                </div>

                <h4 style={{ fontSize: '13px', color: '#334155', marginBottom: '8px' }}>Статус внутренних заказов производства:</h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '8px 12px' }}>№ Заказа</th>
                        <th style={{ padding: '8px 12px' }}>Объем</th>
                        <th style={{ padding: '8px 12px' }}>Состояние</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const completed = isOrderCompleted(o);
                        return (
                          <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', backgroundColor: o.id === selectedOrderId ? '#fef3c7' : '#fff' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{o.id}</td>
                            <td style={{ padding: '8px 12px' }}>{o.volume}</td>
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
                        <tr><td colSpan={3} style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>Заказов не создано</td></tr>
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

                <h4 style={{ fontSize: '13px', color: '#334155', marginBottom: '8px' }}>Все заказы в контуре {currentUser.orgName}:</h4>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                        <th style={{ padding: '8px 12px' }}>Заказ</th>
                        <th style={{ padding: '8px 12px' }}>Инстанс</th>
                        <th style={{ padding: '8px 12px' }}>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id} onClick={() => setSelectedOrderId(o.id)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', backgroundColor: o.id === selectedOrderId ? '#eff6ff' : '#fff' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 'bold' }}>{o.id}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#64748b' }}>{currentUser.org === 'CUSTOMER' ? o.customerInstanceId : (o.supplierInstanceId || '—')}</td>
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

            {/* 3. РОЛЬ: МЕНЕДЖЕР ЗАКУПОК ЗАКАЗЧИКА (`Task_CreatePurchaseOrder`,
                `Task_ReceiveDocsAndIssuePass` в схеме) */}
            {canWork('CUSTOMER', ['Task_CreatePurchaseOrder', 'Task_ReceiveDocsAndIssuePass']) && currentOrder && (
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
                ) : currentOrder.shippedAt || currentOrder.customerActiveElementId === 'Task_ReceiveDocsAndIssuePass' ? (
                  <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 4px 0', fontWeight: '600', color: '#15803d' }}>
                      🚚 Поставщик отгрузил молоко по Заказу {currentOrder.id}!
                    </p>
                    {currentOrder.documents && (
                      <p style={{ fontSize: '12px', color: '#475569', margin: '0 0 12px 0' }}>
                        Получены сопроводительные документы: {currentOrder.documents.ttnNumber}, {currentOrder.documents.updNumber} (Водитель: {currentOrder.documents.driverName}, Авто: {currentOrder.documents.vehicleNum})
                      </p>
                    )}
                    <button onClick={() => handleCustomerIssuePass(currentOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                      <KeyRound size={16} /> Выписать пропуск на КПП
                    </button>
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
                    <button onClick={() => handleCustomerSendOrderToSupplier(currentOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                      <Send size={16} /> Сформировать и отправить заказ Поставщику
                    </button>
                  </div>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 4. РОЛЬ: МЕНЕДЖЕР ПОСТАВЩИКА (`Task_SupplierCreateDocs`,
                `Task_SupplierShipment` в схеме Поставщика) */}
            {canWork('SUPPLIER', ['Task_SupplierCreateDocs', 'Task_SupplierShipment']) && currentOrder && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : currentOrder.shippedAt ? (
                  <p style={{ color: '#166534', fontSize: '13px' }}>
                    ✅ Отгрузка по Заказу {currentOrder.id} выполнена. Документы у Заказчика.
                  </p>
                ) : currentOrder.documents || currentOrder.supplierActiveElementId === 'Task_SupplierShipment' ? (
                  <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 4px 0', fontWeight: '600' }}>Пакет документов сформирован ({currentOrder.documents?.ttnNumber})</p>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 12px 0' }}>Подтвердите факт отгрузки автоцистерны со склада для передачи сигнала Заказчику.</p>
                    <button onClick={() => handleSupplierShipment(currentOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                      <Truck size={16} /> Подтвердить отгрузку
                    </button>
                  </div>
                ) : currentOrder.supplierInstanceId ? (
                  <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>Поступила заявка {currentOrder.id} от Заказчика. Сформировать пакет документов?</p>
                    <button onClick={() => handleSupplierCreateDocs(currentOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                      <FileText size={16} /> Сформировать ТТН и УПД
                    </button>
                  </div>
                ) : (
                  <p style={{ color: '#64748b', fontSize: '13px' }}>Ожидание передачи заказа от Заказчика...</p>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
              </div>
            )}

            {/* 5. РОЛЬ: ОХРАНА КПП ЗАКАЗЧИКА (`Task_SecurityCheck` в схеме) */}
            {canWork('CUSTOMER', ['Task_SecurityCheck']) && currentOrder && (
              <div>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : currentOrder.customerActiveElementId === 'Task_SecurityCheck' || (currentOrder.passData && !currentOrder.entryTime) ? (
                  <div style={{ padding: '16px', backgroundColor: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#92400e' }}>🚚 Автоцистерна на КПП [Заказ {currentOrder.id}]</h4>
                    <p style={{ fontSize: '12px', color: '#b45309', margin: '0 0 12px 0' }}>
                      Пропуск №{currentOrder.passData?.passNumber} оформлен. Подтвердите проверку и откройте ворота.
                    </p>
                    <button onClick={() => handleSecurityCheckAndPass(currentOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                      <ShieldCheck size={16} /> Проверить пропуск и открыть ворота
                    </button>
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

            {/* 6. РОЛЬ: СПЕЦИАЛИСТ ОТК ЗАКАЗЧИКА (`Task_QualityControl` в схеме) */}
            {canWork('CUSTOMER', ['Task_QualityControl']) && currentOrder && (
              <div>
                {actionLoading[currentOrder.id] ? (
                  <RenderActionStatus orderId={currentOrder.id} />
                ) : currentOrder.customerActiveElementId === 'Task_QualityControl' || (currentOrder.entryTime && !isOrderCompleted(currentOrder)) ? (
                  <div style={{ padding: '16px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '8px' }}>
                    <p style={{ fontSize: '14px', margin: '0 0 12px 0' }}>🧪 Сырье доставлено. Провести экспресс-анализ молока [Заказ {currentOrder.id}].</p>
                    <button onClick={() => handleQualityApprove(currentOrder.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#15803d', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
                      <ClipboardCheck size={16} /> Подтвердить качество и передать в Производство
                    </button>
                  </div>
                ) : (
                  <p style={{ color: '#64748b', fontSize: '14px' }}>Ожидание въезда сырья для лаборатории...</p>
                )}

                {actionErrors[currentOrder.id] && <RenderActionStatus orderId={currentOrder.id} />}
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

                 {currentUser.org === 'CUSTOMER' ? (
                   schemaMode === 'edit' ? (
                     <BpmnEditor
                       xml={customerBpmnXml}
                       onChange={setCustomerBpmnXml}
                       roleOptions={ROLE_CODES}
                       height={520}
                     />
                   ) : (
                     <BpmnViewer
                       xml={customerBpmnXml}
                       tokens={tokensFor(currentOrder?.customerInstanceId)}
                       activeElementId={currentOrder?.customerActiveElementId}
                       height={520}
                     />
                   )
                 ) : (
                   schemaMode === 'edit' ? (
                     <BpmnEditor
                       xml={supplierBpmnXml}
                       onChange={setSupplierBpmnXml}
                       roleOptions={ROLE_CODES}
                       height={520}
                     />
                   ) : (
                     <BpmnViewer
                       xml={supplierBpmnXml}
                       tokens={tokensFor(currentOrder?.supplierInstanceId)}
                       activeElementId={currentOrder?.supplierActiveElementId}
                       height={520}
                     />
                   )
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