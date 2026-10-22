/**
 * Тест вендорного бандла BPMN Client SDK (`src/vendor/bpmn-sdk`).
 *
 * Проверяет то, что не увидит `tools/verify.mjs` (там нет DOM):
 *  1. бандл загружается и отдаёт документированное публичное API;
 *  2. код бандла действительно исполняется (константы, утилиты, WS-разбор);
 *  3. React в бандле внешний: вторая копия React сломала бы хуки SDK
 *     («Invalid hook call»), поэтому реальный компонент рендерится на том же
 *     React, что и приложение (в том числе редактор схемы: он подписывается
 *     на правки холста через шину diagram-js, а не через `commandStack`);
 *  4. внедряемый CSS содержит самодостаточный шрифт иконок и привязку
 *     глифов к нему: без привязки панель инструментов редактора рисуется
 *     квадратиками, а не пиктограммами;
 *  5. артефакт актуален исходникам SDK и не правился руками после сборки —
 *     «забыли пересобрать» падает в тестах, а не на стенде.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

const path = require('path');

const sdk = require('./bpmn-sdk');
const buildInfo = require('./bpmn-sdk/BUILD_INFO.json');
const { computeSourceHash, fileHash } = require('../bpmn-sdk/tools/lib/build-info.cjs');

/** Имена, на которые опираются приложение и документация SDK. */
const PUBLIC_API = [
  // компоненты
  'BpmnViewer',
  'BpmnEditor',
  'EnginePanel',
  // хуки
  'useBpmnEngine',
  'useProcessTokens',
  'useTokenHighlight',
  // транспорт
  'GatewayClient',
  'StatusSocket',
  'createUuid',
  'normalizeGatewayUrl',
  // константы
  'DEFAULT_CUSTOMER_BPMN_XML',
  'DEFAULT_SUPPLIER_BPMN_XML',
  // демо-проект «Молочный завод» (заказ → производство → отгрузка)
  'DAIRY_PLANT_PROJECT_XML',
  'DAIRY_PLANT_PROJECT_NAME',
  'DEFAULT_GATEWAY_URL',
  'DEFAULT_WS_URL',
  'INSTANCE_PREFIX',
  'SOCKET_EVENTS',
  'TOKEN_STATES',
  'ENGINE_EVENTS',
  // логика токенов и XML
  'isDeployInstanceId',
  'parseTokenMessage',
  'resolveTokenMap',
  'applyTokenUpdate',
  'tokenMarkerClasses',
  'BPMN_TOKEN_BASE_CLASS',
  'listFlowElements',
  'isValidXml',
  // совместимость схемы с движком оркестратора
  'validateEngineSchema',
  'ENGINE_FLOW_NODE_TYPES',
  'SCHEMA_PROBLEM',
  // роль исполнителя узла (bpmn:potentialOwner)
  'getElementRole',
  'getRoleAssignments',
  'setElementRole',
  'isValidRole',
  // кросс-процессный триггер узла (trg:processTrigger)
  'getElementTrigger',
  'getTriggerAssignments',
  'setElementTrigger',
  'listTriggers',
  'isValidTrigger',
  'isValidInstancePrefix',
  'isValidPayloadKeys',
  'isTriggerHostType',
  'getProcessIds',
  'TRIGGER_NAMESPACE',
  'TRIGGER_TYPE',
  'TRIGGER_FIELDS',
  'EMPTY_TRIGGER',
  'TRIGGER_MODELE_EXTENSIONS',
  // кнопки участников узла (act:userAction)
  'listActions',
  'getElementActions',
  'getElementAction',
  'getActionAssignments',
  'getStartAction',
  'setElementActions',
  'isValidAction',
  'normalizeAction',
  'isActionHostType',
  // умолчания кнопки, выводимые из схемы (пустые event/elementId)
  'DEFAULT_ACTION_EVENT',
  'getNextElementId',
  'getOutgoingTargetIds',
  'resolveAction',
  'resolveActionEvent',
  'resolveActionTarget',
  'ACTION_NAMESPACE',
  'ACTION_TYPE',
  'ACTION_FIELDS',
  'EMPTY_ACTION',
  'ACTION_MODELE_EXTENSIONS',
  'ACTION_TAG_NAME',
  'ACTION_ICON_PATTERN',
];

/**
 * Слушатели события в шине diagram-js.
 *
 * `EventBus` держит их связным списком по приоритету (`_listeners[event]` ->
 * `listener.next`), публичного способа их пересчитать у шины нет.
 *
 * @param {Object} eventBus шина моделлера (`modeler.get('eventBus')`).
 * @param {string} event имя события.
 * @returns {number} количество слушателей.
 */
function countListeners(eventBus, event) {
  let listener = eventBus._listeners[event];
  let total = 0;

  while (listener) {
    total += 1;
    listener = listener.next;
  }

  return total;
}

/**
 * Есть ли среди собранных предупреждений сообщение об устаревшем `getPad`.
 *
 * `diagram-js` передаёт его в `console.warn` объектом `Error` со стеком, а
 * `console.warn` редактора вызывается ещё и по другим поводам, поэтому фильтр
 * идёт по тексту конкретного сообщения.
 *
 * @param {string[]} warnings тексты перехваченных предупреждений.
 * @returns {boolean} true, если сообщение об устаревшем вызове есть.
 */
function hasContextPadDeprecation(warnings) {
  return warnings.some((message) => message.includes('ContextPad#getPad is deprecated'));
}

/**
 * Правила CSS, внедрённые бандлом в документ при импорте (`style-loader`).
 *
 * Читаем CSSOM, а не текст артефакта: проверяется тот CSS, который реально
 * применяется к DOM клиента.
 *
 * @returns {CSSRule[]} список правил всех подключённых стилей.
 */
function getInjectedRules() {
  const rules = [];

  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      rules.push(...Array.from(sheet.cssRules || []));
    } catch (error) {
      // Лист без доступа к правилам (кросс-доменный) — в jsdom таких нет.
    }
  });

  return rules;
}

/**
 * Признак правила, привязывающего глифы иконок к шрифту `bpmn`.
 *
 * `bpmn-codes.css` задаёт иконкам только `content` (`\e8xx` — приватная
 * область Unicode), семейство шрифта приходит из `styles/bpmnFont.css`
 * (в upstream — из `bpmn-font/css/bpmn.css`). Без такого правила браузер
 * рисует глифы fallback-шрифтом: палитра редактора выглядит квадратиками.
 *
 * @param {CSSRule} rule правило CSS.
 * @returns {boolean} true, если правило задаёт шрифт иконкам.
 */
function isIconFontBinding(rule) {
  return (
    /bpmn-icon-/.test(String(rule.selectorText)) &&
    /font-family:\s*['"]?bpmn['"]?/.test(String(rule.cssText))
  );
}

/**
 * Селекторы привязки иконок без псевдоэлемента `:before`.
 *
 * Кнопка палитры — сам элемент (`<div class="entry bpmn-icon-task">`),
 * а глиф рисует её псевдоэлемент, поэтому для `Element.matches` класс
 * проверяется без `:before`.
 *
 * @returns {string[]} селекторы (`[]`, если привязки нет).
 */
function getIconFontSelectors() {
  const binding = getInjectedRules().find(isIconFontBinding);

  if (!binding) return [];

  return String(binding.selectorText)
    .split(',')
    .map((selector) => selector.trim().replace(/:before$/, ''));
}

/**
 * Гасит шум jsdom, который diagram-js пишет асинхронно.
 *
 * Схема в jsdom не строится (нет SVG-геометрии: `getBBox`), и ошибка
 * прилетает в `console.error` уже после того, как тест завершился, поэтому
 * фильтр стоит на весь файл, а не на отдельный рендер. Остальные ошибки
 * остаются видны: тест не должен прятать настоящие проблемы.
 */
function muteJsdomCanvasNoise() {
  const originalConsoleError = console.error;

  jest.spyOn(console, 'error').mockImplementation((...args) => {
    const message = args.map(String).join(' ');

    if (!message.includes('getBBox')) originalConsoleError(...args);
  });
}

/**
 * Рендерит редактор схемы (шум jsdom глушит `muteJsdomCanvasNoise`).
 *
 * @param {Object} props пропсы `BpmnEditor`.
 * @returns {{ unmount: Function }} результат `render`.
 */
function renderEditor(props) {
  return render(<sdk.BpmnEditor {...props} />);
}

describe('вендорный бандл BPMN Client SDK', () => {
  beforeAll(muteJsdomCanvasNoise);

  afterAll(() => {
    // Спай снимаем после всех проверок: шум jsdom приходит асинхронно.
    jest.restoreAllMocks();
  });

  it('отдаёт документированный публичный API', () => {
    expect(PUBLIC_API.filter((name) => sdk[name] === undefined)).toEqual([]);
  });

  it('исполняет код бандла: константы, утилиты, разбор WS-сообщения', () => {
    expect(sdk.INSTANCE_PREFIX.CUSTOMER).toBe('inst-cust-');
    expect(sdk.INSTANCE_PREFIX.DEPLOY).toBe('inst-deploy-');
    expect(sdk.SOCKET_EVENTS.TOKEN).toBe('token');
    expect(sdk.TOKEN_STATES.ACTIVE).toBe('ACTIVE');
    expect(sdk.DEFAULT_CUSTOMER_BPMN_XML).toContain('Process_MilkCustomer_v1');
    expect(sdk.DEFAULT_SUPPLIER_BPMN_XML).toContain('Process_SupplierSupply_v1');

    expect(sdk.createUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(sdk.isDeployInstanceId('inst-deploy-customer')).toBe(true);
    expect(sdk.isDeployInstanceId('inst-cust-abc')).toBe(false);

    expect(
      sdk.parseTokenMessage(
        JSON.stringify({
          event: 'token_updated',
          instance_id: 'inst-cust-1',
          element_id: 'Task_A',
          state: 'ACTIVE',
        })
      )
    ).toMatchObject({ instanceId: 'inst-cust-1', elementId: 'Task_A', state: 'ACTIVE' });

    expect(sdk.resolveTokenMap({ Task_A: 'ACTIVE' })).toEqual({
      Task_A: ['bpmn-sdk-token', 'bpmn-sdk-token--active'],
    });
    expect(sdk.isValidXml(sdk.DEFAULT_CUSTOMER_BPMN_XML)).toBe(true);
  });

  it('навешивает подсветку базовым классом и модификатором состояния', () => {
    // Данные: классы приходят парой. `canvas.addMarker` в diagram-js
    // навешивает один класс за вызов, поэтому базовый класс и состояние
    // передаются отдельно.
    expect(sdk.tokenMarkerClasses(sdk.TOKEN_STATES.ACTIVE)).toEqual([
      sdk.BPMN_TOKEN_BASE_CLASS,
      'bpmn-sdk-token--active',
    ]);

    expect(sdk.resolveTokenMap({ Task_A: 'COMPLETED' }, null)).toEqual({
      Task_A: [sdk.BPMN_TOKEN_BASE_CLASS, 'bpmn-sdk-token--completed'],
    });

    // CSS: заливку и обводку узла навешивает базовый класс, а модификатор
    // выбирает цвет состояния. Если базовый класс не навешен, от подсветки
    // остаётся только анимация `ACTIVE`, а `COMPLETED`/`FAILED`/`TIMED_OUT`
    // не видны совсем — это и было причиной «подсветка не показывается».
    const fillRule = getInjectedRules()
      .map((rule) => String(rule.cssText))
      .find(
        (text) =>
          /\.bpmn-sdk-token(?![\w-])/.test(text) &&
          text.includes('var(--bpmn-sdk-token-fill)')
      );

    expect(fillRule).toBeTruthy();
  });

  it('демо-схема заказчика содержит узлы, которые активирует клиент', () => {
    // `App.jsx` называет узлы в `element_id`; если узла нет в схеме, токен
    // приходит, но подсветить его нечем — на схеме «не подсвечивается
    // активный блок» (так было с `Task_WaitForSupplierShipment`, который
    // отправляет `handleCustomerSendOrderToSupplier`).
    expect(
      sdk.listFlowElements(sdk.DEFAULT_CUSTOMER_BPMN_XML).map((element) => element.id)
    ).toEqual([
      'StartEvent_Customer',
      'Task_CreatePurchaseOrder',
      'Task_WaitForSupplierShipment',
      'Task_ReceiveDocsAndIssuePass',
      'Task_SecurityCheck',
      'Task_QualityControl',
      'EndEvent_Customer',
    ]);

    expect(
      sdk.listFlowElements(sdk.DEFAULT_SUPPLIER_BPMN_XML).map((element) => element.id)
    ).toEqual([
      'StartEvent_Supplier',
      'Task_SupplierCreateDocs',
      'Task_SupplierShipment',
      'EndEvent_Supplier',
    ]);
  });

  it('пишет триггер запуска второго процесса тем же API, что и редактор', () => {
    // Подсказки поля «Запускаемый процесс» (демо-страница SDK и `App.jsx`) —
    // идентификаторы процессов второй стороны: у заказчика это поставщик.
    expect(sdk.getProcessIds(sdk.DEFAULT_SUPPLIER_BPMN_XML)).toEqual([
      'Process_SupplierSupply_v1',
    ]);
    expect(sdk.getProcessIds(sdk.DEFAULT_CUSTOMER_BPMN_XML)).toEqual([
      'Process_MilkCustomer_v1',
    ]);

    const xml = sdk.setElementTrigger(
      sdk.DEFAULT_CUSTOMER_BPMN_XML,
      'Task_WaitForSupplierShipment',
      {
        targetProcessId: 'Process_SupplierSupply_v1',
        instancePrefix: sdk.INSTANCE_PREFIX.SUPPLIER,
        startElementId: 'Task_WaitForSupplierShipment',
        firstElementId: 'Task_SupplierCreateDocs',
        payloadKeys: 'orderNum, volume',
      }
    );

    expect(sdk.getElementTrigger(xml, 'Task_WaitForSupplierShipment')).toEqual({
      targetProcessId: 'Process_SupplierSupply_v1',
      instancePrefix: 'inst-supp-',
      startElementId: 'Task_WaitForSupplierShipment',
      firstElementId: 'Task_SupplierCreateDocs',
      payloadKeys: 'orderNum,volume',
    });
    expect(sdk.getTriggerAssignments(xml)).toEqual({
      Task_WaitForSupplierShipment: sdk.getElementTrigger(xml, 'Task_WaitForSupplierShipment'),
    });

    // Правка текстовая: namespace объявлен в корне, состав узлов не изменился,
    // а снятие триггера убирает элемент из схемы.
    expect(xml).toContain(' xmlns:trg="' + sdk.TRIGGER_NAMESPACE + '"');
    expect(sdk.listFlowElements(xml)).toEqual(
      sdk.listFlowElements(sdk.DEFAULT_CUSTOMER_BPMN_XML)
    );
    expect(
      sdk.listTriggers(sdk.setElementTrigger(xml, 'Task_WaitForSupplierShipment', null))
    ).toEqual([]);

    // Инспектор узлов читает триггер из XML, когда реестр его не отдал:
    // демо-страница SDK передаёт `listFlowElements` (там только id/name/type),
    // а схему — пропом `xml`.
    render(
      <sdk.EnginePanel
        xml={xml}
        elements={sdk.listFlowElements(xml)}
        selectedElementId="Task_WaitForSupplierShipment"
        roleOptions={['MANAGER']}
        triggerTargets={sdk.getProcessIds(sdk.DEFAULT_SUPPLIER_BPMN_XML)}
      />
    );

    expect(screen.getByDisplayValue('Process_SupplierSupply_v1')).toBeTruthy();
    expect(screen.getByDisplayValue('orderNum,volume')).toBeTruthy();

    // Триггер ставится только на узел потока: последовательный поток движок
    // токеном не активирует.
    expect(() =>
      sdk.setElementTrigger(sdk.DEFAULT_CUSTOMER_BPMN_XML, 'Flow_C1', {
        targetProcessId: 'Process_SupplierSupply_v1',
      })
    ).toThrow(/только узлам потока/);
  });

  it('пишет кнопки участников тем же API, что и редактор', () => {
    // Кнопки демо-схемы — то, что рисует кабинет (`ACTION_ID` в `App.jsx`).
    expect(sdk.listActions(sdk.DEFAULT_CUSTOMER_BPMN_XML).map((item) => item.action.id)).toEqual([
      'createOrder',
      'sendToSupplier',
      'issuePass',
      'securityPass',
      'qualityApprove',
    ]);
    // Как процесс стартует, описывает кнопка на стартовом событии. Пару «событие
    // + узел» схема выводит сама: в кнопке записана только роль инициатора, а
    // `resolveAction` доводит её до первого блока (`CompleteBlock` + цель связи).
    const startDeclaration = sdk.getStartAction(sdk.DEFAULT_CUSTOMER_BPMN_XML);

    expect(startDeclaration).toMatchObject({
      elementId: 'StartEvent_Customer',
      action: { event: '', elementId: '' },
    });
    expect(
      sdk.resolveAction(
        sdk.DEFAULT_CUSTOMER_BPMN_XML,
        startDeclaration.elementId,
        startDeclaration.action
      )
    ).toEqual({
      event: 'CompleteBlock',
      elementId: 'Task_CreatePurchaseOrder',
    });

    const xml = sdk.setElementActions(sdk.DEFAULT_CUSTOMER_BPMN_XML, 'Task_WaitForSupplierShipment', [
      {
        id: 'remind',
        label: 'Напомнить поставщику',
        icon: 'Send',
        event: 'RemindSupplier',
        elementId: 'Task_WaitForSupplierShipment',
      },
    ]);

    // Правка текстовая: namespace объявлен в корне, состав узлов не изменился,
    // чужие кнопки и роли задач остались на месте.
    expect(xml).toContain(' xmlns:act="' + sdk.ACTION_NAMESPACE + '"');
    expect(sdk.listFlowElements(xml)).toEqual(
      sdk.listFlowElements(sdk.DEFAULT_CUSTOMER_BPMN_XML)
    );
    expect(sdk.getElementAction(xml, 'Task_WaitForSupplierShipment', 'remind')).toEqual({
      id: 'remind',
      label: 'Напомнить поставщику',
      role: '',
      icon: 'Send',
      event: 'RemindSupplier',
      elementId: 'Task_WaitForSupplierShipment',
      counterpartEvent: '',
      counterpartElementId: '',
      startsProcess: '',
      variables: '',
    });
    expect(sdk.getElementRole(xml, 'Task_WaitForSupplierShipment')).toBe('MANAGER');
    expect(sdk.listActions(xml)).toHaveLength(6);

    // Инспектор узлов читает кнопки из XML, когда реестр их не отдал.
    render(
      <sdk.EnginePanel
        xml={xml}
        elements={sdk.listFlowElements(xml)}
        selectedElementId="Task_WaitForSupplierShipment"
        roleOptions={['MANAGER']}
        onChangeActions={() => true}
      />
    );

    expect(screen.getByDisplayValue('Напомнить поставщику')).toBeTruthy();
    expect(screen.getByDisplayValue('RemindSupplier')).toBeTruthy();

    // Кнопка ставится только на узел потока: последовательный поток движок
    // токеном не активирует.
    expect(() =>
      sdk.setElementActions(sdk.DEFAULT_CUSTOMER_BPMN_XML, 'Flow_C1', [
        { id: 'x', label: 'X', event: 'E', elementId: 'Task_CreatePurchaseOrder' },
      ])
    ).toThrow(/только узлам потока/);
  });

  it('рендерит компонент бандла на том же React, что и приложение', () => {
    render(
      <sdk.EnginePanel
        elements={[{ id: 'Task_Approve', name: 'Согласовать', type: 'bpmn:UserTask' }]}
        selectedElementId="Task_Approve"
      />
    );

    expect(screen.getByDisplayValue('Task_Approve')).toBeTruthy();
  });

  it('рендерит редактор схемы: правки холста приходят шиной `commandStack.changed`', () => {
    const onReady = jest.fn();
    const { unmount } = renderEditor({
      xml: sdk.DEFAULT_CUSTOMER_BPMN_XML,
      onReady,
      showInspector: false,
    });

    // `onReady` вызывается после подписки на правки: пока в редакторе было
    // `commandStack.on('changed', ...)`, эффект падал на этом месте
    // (`TypeError: commandStack.on is not a function`) и схема не открывалась.
    expect(onReady).toHaveBeenCalledTimes(1);

    const modeler = onReady.mock.calls[0][0];
    const eventBus = modeler.get('eventBus');

    // `CommandStack` (diagram-js >= 14) — не `EventBus`, `on`/`off` у него нет.
    expect(modeler.get('commandStack').on).toBeUndefined();

    // Свежий `Modeler` уже слушает `commandStack.changed` (авто-закрытие
    // контекстного меню) — значит редактор добавил ровно одного слушателя,
    // и именно на это событие шины.
    const ModelerClass = modeler.constructor;
    const fresh = new ModelerClass({ container: document.createElement('div') });
    const baseline = countListeners(fresh.get('eventBus'), 'commandStack.changed');

    expect(countListeners(eventBus, 'commandStack.changed')).toBe(baseline + 1);

    unmount();

    // Размонтирование подписку снимает (`destroy` гасит шину целиком).
    expect(countListeners(eventBus, 'commandStack.changed')).toBeLessThan(baseline + 1);

    fresh.destroy();
  });

  it('гасит устаревший вызов `diagram-js` из меню «Change element»', () => {
    // Кнопка «Change element» (гаечный ключ на контекстной панели узла)
    // открывает меню замены через `ContextPad#getPad`, а `diagram-js` объявил
    // этот метод устаревшим: в консоль клиента летит
    // `Error: ContextPad#getPad is deprecated ...` (`console.warn` со стеком)
    // и читается как ошибка редактора, хотя меню открывается штатно. SDK гасит
    // ровно это сообщение, а сам вызов к библиотеке оставляет.
    const warned = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation((...args) => {
      warned.push(args.map(String).join(' '));
    });

    const onReady = jest.fn();
    const { unmount } = renderEditor({
      xml: sdk.DEFAULT_CUSTOMER_BPMN_XML,
      onReady,
      showInspector: false,
    });

    const modeler = onReady.mock.calls[0][0];
    const target = { id: 'Task_Any' };

    // Контроль: на той же копии `diagram-js`, но без заплаты SDK
    // предупреждение есть — значит тест поймает и её возврат.
    const fresh = new modeler.constructor({ container: document.createElement('div') });

    expect(fresh.get('contextPad').getPad(target).html).toBeTruthy();
    expect(hasContextPadDeprecation(warned)).toBe(true);

    warned.length = 0;

    // Панель редактора пропатчена, но отдаёт ровно тот же объект пада.
    expect(modeler.get('contextPad').getPad(target).html).toBeTruthy();
    expect(hasContextPadDeprecation(warned)).toBe(false);

    unmount();
    fresh.destroy();
    warn.mockRestore();
  });

  it('привязывает глифы иконок к шрифту `bpmn` (иначе палитра — квадратики)', () => {
    const rules = getInjectedRules();

    // Шрифт иконок лежит внутри бандла (`data:font/woff2`): отдельного файла
    // нет, поэтому `url()` не может превратиться в 404 у клиента.
    const fontFace = rules.find((rule) => /^@font-face/.test(String(rule.cssText)));

    expect(fontFace).toBeTruthy();
    expect(String(fontFace.cssText)).toMatch(/font-family:\s*['"]?bpmn['"]?/);
    expect(String(fontFace.cssText)).toContain('data:font/woff2');

    // `bpmn-codes.css` задаёт иконкам только `content` (`\e8xx`), привязку
    // к семейству даёт `styles/bpmnFont.css` — ровно одно правило.
    expect(rules.filter(isIconFontBinding)).toHaveLength(1);
  });

  it('иконки палитры редактора попадают под привязку шрифта `bpmn`', () => {
    const { unmount } = renderEditor({
      xml: sdk.DEFAULT_CUSTOMER_BPMN_XML,
      showInspector: false,
    });

    // Палитра и есть «панель инструментов» редактора: инструменты, задачи,
    // события, шлюзы, подпроцесс, пул.
    const entries = Array.from(document.querySelectorAll('.djs-palette .entry'));

    expect(entries.length).toBeGreaterThan(0);

    const selectors = getIconFontSelectors();

    expect(selectors.length).toBeGreaterThan(0);

    // Каждая кнопка несёт класс `bpmn-icon-*`, который обязан попадать под
    // селектор привязки: иначе браузер возьмёт fallback-шрифт и нарисует
    // вместо пиктограммы квадратик.
    entries.forEach((entry) => {
      expect(selectors.some((selector) => entry.matches(selector))).toBe(true);
    });

    unmount();
  });

  it('собран из текущих исходников SDK', () => {
    const { hash, count } = computeSourceHash();

    expect(`${buildInfo.sourceHash}/${buildInfo.sourceFileCount}`).toBe(`${hash}/${count}`);
  });

  it('не правился руками после сборки', () => {
    ['bpmn-sdk.umd.js', 'bpmn-sdk.umd.js.map'].forEach((name) => {
      const file = path.join(__dirname, 'bpmn-sdk', name);

      expect(fileHash(file)).toBe(buildInfo.artifacts[name].sha256);
    });
  });

  it('дефолтные схемы несут роли задач (`bpmn:potentialOwner`)', () => {
    // Роли назначены только задачам: `bpmn:potentialOwner` — свойство
    // `Activity`, у событий и шлюзов такого элемента нет в BPMN 2.0.
    expect(sdk.getRoleAssignments(sdk.DEFAULT_CUSTOMER_BPMN_XML)).toEqual({
      Task_CreatePurchaseOrder: 'MANAGER',
      Task_WaitForSupplierShipment: 'MANAGER',
      Task_ReceiveDocsAndIssuePass: 'MANAGER',
      Task_SecurityCheck: 'SECURITY',
      Task_QualityControl: 'QUALITY',
    });

    expect(sdk.getRoleAssignments(sdk.DEFAULT_SUPPLIER_BPMN_XML)).toEqual({
      Task_SupplierCreateDocs: 'SUPPLIER_MANAGER',
      Task_SupplierShipment: 'SUPPLIER_MANAGER',
    });

    // У событий роли нет — и попытка её записать должна падать, а не молча
    // создавать схему, из которой роль исчезнет при сохранении в редакторе.
    expect(() => sdk.setElementRole(sdk.DEFAULT_CUSTOMER_BPMN_XML, 'StartEvent_Customer', 'PRODUCTION')).toThrow(
      /только Activity/
    );

    expect(sdk.isValidXml(sdk.DEFAULT_CUSTOMER_BPMN_XML)).toBe(true);
    expect(sdk.isValidXml(sdk.DEFAULT_SUPPLIER_BPMN_XML)).toBe(true);
  });
});
