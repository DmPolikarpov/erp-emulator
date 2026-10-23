/**
 * Интеграционный тест `App` после перехода на вендорный бандл SDK.
 *
 * Приложение импортирует `./vendor/bpmn-sdk` — собранный UMD-артефакт
 * (`npm run sdk:refresh`), внутри которого упакованы `bpmn-js` и
 * `lucide-react`, а React остаётся external. Поэтому Jest может загрузить
 * реальный SDK (`jest.requireActual`), а подменяются только точки стыковки:
 * транспорт (`useBpmnEngine`) и холсты (`BpmnViewer`/`BpmnEditor`), пропсы
 * которых проверяются. Заодно тест ловит регрессии артефакта: если бандл не
 * собран или устарел, ожидаемое API из него не придёт.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from './App';
import { beginRun, completeRun, loadRuns } from './metricsStore';
import { analyzeProject } from './projectRoles';
import { createProject, listProjects } from './projectStore';
import {
  DAIRY_PLANT_PROCESS_ID,
  DAIRY_PLANT_PROCESS_XML,
  DAIRY_PLANT_PROJECT_NAME,
  DAIRY_SUPPLIER_PROCESS_ID,
  DAIRY_SUPPLIER_PROCESS_XML,
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_SUPPLIER_BPMN_XML,
  SOCKET_EVENTS,
  buildProjectXml,
  getProcessIds,
  getRoleAssignments,
  setElementActions,
  setElementRole,
} from './vendor/bpmn-sdk';

/**
 * Та же «правка редактора», но совместимая с движком: старт → шаг → конец.
 *
 * Деплой и старт процесса проверяют схему перед отправкой (движок об отказе
 * молчит), поэтому «успешные» сценарии идут по схеме, которую он примет.
 */
const EDITED_VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_EditedInEditor" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Edited_v1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Edited" name="Старт" />
    <bpmn:userTask id="Task_Edited" name="Шаг" />
    <bpmn:endEvent id="EndEvent_Edited" name="Финиш" />
    <bpmn:sequenceFlow id="Flow_Edited_1" sourceRef="StartEvent_Edited" targetRef="Task_Edited" />
    <bpmn:sequenceFlow id="Flow_Edited_2" sourceRef="Task_Edited" targetRef="EndEvent_Edited" />
  </bpmn:process>
</bpmn:definitions>`;

/**
 * Схема, которую движок не примет: шаг добавлен из палитры редактора как
 * базовый `<bpmn:task>`. Парсер движка такой узел пропускает, связи через него
 * становятся висячими, и определение не компилируется целиком.
 *
 * Меняется открывающий и закрывающий тег сразу: иначе XML перестал бы быть
 * корректным (несовпадение тегов) и проверка остановилась бы на разборе.
 */
const INCOMPATIBLE_XML = DEFAULT_CUSTOMER_BPMN_XML.replace(
  /<bpmn:userTask id="Task_QualityControl"([\s\S]*?)<\/bpmn:userTask>/,
  '<bpmn:task id="Task_QualityControl"$1</bpmn:task>'
);

/** Правка «сохранённого» процесса Заказчика: по ней видно, какая схема уехала. */
const EDITED_CUSTOMER_XML = DEFAULT_CUSTOMER_BPMN_XML.replace(
  'Закупка и приемка сырого молока',
  'Закупка и правка Заказчика'
);

/** Проект из демо-процессов с этой правкой — то, что отдаёт редактор холста. */
const EDITED_PROJECT_XML = buildProjectXml([
  { xml: EDITED_CUSTOMER_XML, participantName: 'Молочный Завод' },
  { xml: DEFAULT_SUPPLIER_BPMN_XML, participantName: 'ООО «Альпийские Луга»' },
]);

/**
 * Правка редактора: после ОТК добавлен блок приёмки сырья на склад в роли ОТК.
 *
 * Кнопка блока — без параметров (только ключ, надпись и иконка): событие и узел
 * движения токена доводит сама схема (`resolveAction`), потому что у блока одна
 * исходящая связь. Кабинету такой шаг неизвестен (ключа нет в `ACTION_ID`), и
 * он должен показать его общим блоком (`schemaStepActions`).
 */
const XML_WITH_QUALITY_STEP = DEFAULT_CUSTOMER_BPMN_XML.replace(
  '<bpmn:sequenceFlow id="Flow_C6" sourceRef="Task_QualityControl" targetRef="EndEvent_Customer" />',
  [
    '<bpmn:sequenceFlow id="Flow_C6" sourceRef="Task_QualityControl" targetRef="Task_QualityStorage" />',
    '',
    '<bpmn:userTask id="Task_QualityStorage" name="Принять сырьё на склад ОТК">',
    '      <bpmn:extensionElements>',
    '        <act:userAction id="qualityStorageAccept" label="Принять сырьё на склад" icon="PackageCheck" />',
    '      </bpmn:extensionElements>',
    '      <bpmn:incoming>Flow_C6</bpmn:incoming>',
    '      <bpmn:outgoing>Flow_C7</bpmn:outgoing>',
    '      <bpmn:potentialOwner name="QUALITY" />',
    '    </bpmn:userTask>',
    '',
    '    <bpmn:sequenceFlow id="Flow_C7" sourceRef="Task_QualityStorage" targetRef="EndEvent_Customer" />',
  ].join('\n')
);

/**
 * Схема без кнопок участников: каталог ролей на месте, а `act:userAction`
 * вырезаны. Так выглядит загруженный BPMN, нарисованный без разметки кнопок:
 * кабинет должен показать шаг и не рисовать действий.
 */
const XML_WITHOUT_ACTIONS = DEFAULT_CUSTOMER_BPMN_XML.replace(
  /<bpmn:extensionElements>\s*<act:userAction[^>]*\/>\s*<\/bpmn:extensionElements>/g,
  ''
);

/** Проект из списка проектов: один процесс, каталог ролей и кнопка старта. */
const STORE_PROJECT_XML = buildProjectXml([
  {
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:act="http://erp.mes/schema/bpmn/action"
                  xmlns:role="http://erp.mes/schema/bpmn/roles"
                  id="Definitions_Store" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Store_v1" name="Приёмка на склад" isExecutable="true">
    <bpmn:extensionElements>
      <role:catalog id="RoleCatalog_Store">
        <role:businessRole code="STOREKEEPER" title="Кладовщик" icon="PackageCheck" />
      </role:catalog>
    </bpmn:extensionElements>
    <bpmn:startEvent id="StartEvent_Store" name="Поставка пришла">
      <bpmn:extensionElements>
        <act:userAction id="createOrder" label="Принять поставку" role="STOREKEEPER" icon="PlusCircle" />
      </bpmn:extensionElements>
      <bpmn:outgoing>Flow_Store_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Store" name="Разместить на складе">
      <bpmn:incoming>Flow_Store_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Store_2</bpmn:outgoing>
      <bpmn:potentialOwner name="STOREKEEPER" />
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_Store_1" sourceRef="StartEvent_Store" targetRef="Task_Store" />
    <bpmn:sequenceFlow id="Flow_Store_2" sourceRef="Task_Store" targetRef="EndEvent_Store" />
    <bpmn:endEvent id="EndEvent_Store" name="Поставка принята">
      <bpmn:incoming>Flow_Store_2</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`,
    participantName: 'Склад',
  },
]);

/** Проект без кнопки инициатора: запуск выводится из стартового события. */
const PICK_PROJECT_XML = buildProjectXml([
  {
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Definitions_Pick" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Pick_v1" name="Сборка заказа" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Pick" name="Заказ получен">
      <bpmn:outgoing>Flow_Pick_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Pick" name="Собрать заказ">
      <bpmn:incoming>Flow_Pick_1</bpmn:incoming>
      <bpmn:outgoing>Flow_Pick_2</bpmn:outgoing>
      <bpmn:potentialOwner name="PICKER" />
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_Pick_1" sourceRef="StartEvent_Pick" targetRef="Task_Pick" />
    <bpmn:sequenceFlow id="Flow_Pick_2" sourceRef="Task_Pick" targetRef="EndEvent_Pick" />
    <bpmn:endEvent id="EndEvent_Pick" name="Заказ собран">
      <bpmn:incoming>Flow_Pick_2</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`,
    participantName: 'Сборка',
  },
]);

/* ------------------------------------------------------------------ *
 * Моки SDK
 * ------------------------------------------------------------------ */

/** Подписчики фейкового сокета: `событие -> [слушатель, ...]`. */
const mockSocketListeners = {};

const mockSocket = {
  on: (event, listener) => {
    mockSocketListeners[event] = [
      ...(mockSocketListeners[event] || []),
      listener,
    ];
    return () => {};
  },
};

const mockSendEvent = jest.fn();
const mockDeploySchema = jest.fn();

const mockEngine = {
  client: { sendEvent: mockSendEvent, deploySchema: mockDeploySchema },
  socket: mockSocket,
  connected: true,
};

/** Пропсы, с которыми `App` отрисовал компоненты SDK. */
const mockViewerProps = [];
const mockEditorProps = [];

/**
 * Подменяем только точки стыковки, остальное API берём из реального
 * вендорного бандла (`jest.requireActual`): так тест проверяет ещё и то,
 * что артефакт собран и отдаёт ожидаемый публичный API.
 */
jest.mock('./vendor/bpmn-sdk', () => {
  const actual = jest.requireActual('./vendor/bpmn-sdk');

  return {
    ...actual,
    useBpmnEngine: () => mockEngine,
    BpmnViewer: (props) => {
      mockViewerProps.push(props);
      return <div data-testid="sdk-viewer" />;
    },
    BpmnEditor: (props) => {
      mockEditorProps.push(props);
      return <div data-testid="sdk-editor" />;
    },
  };
});

/* ------------------------------------------------------------------ *
 * Вспомогательные функции
 * ------------------------------------------------------------------ */

/** Доставляет сообщение `token_updated` всем подписчикам сокета. */
const emitToken = (token) => {
  act(() => {
    (mockSocketListeners[SOCKET_EVENTS.TOKEN] || []).forEach((listener) =>
      listener(token)
    );
  });
};

const lastProps = (propsList) => propsList[propsList.length - 1];

const openAs = (roleName) => {
  render(<App />);
  fireEvent.click(screen.getByText(roleName));
};

/**
 * Кладёт в браузер проект с правкой процесса — «сохранённую схему».
 *
 * Приложение хранит схему проектом целиком (`src/projectStore.js`), а не двумя
 * независимыми копиями по организациям. Поэтому правим процесс в проекте:
 * вторая сторона остаётся демо-схемой SDK.
 */
const saveProjectProcess = (org, xml) => {
  return createProject({
    name: 'Тестовый проект',
    xml: buildProjectXml([
      {
        xml: org === 'CUSTOMER' ? xml : DEFAULT_CUSTOMER_BPMN_XML,
        participantName: 'Молочный Завод',
      },
      {
        xml: org === 'SUPPLIER' ? xml : DEFAULT_SUPPLIER_BPMN_XML,
        participantName: 'ООО «Альпийские Луга»',
      },
    ]),
  });
};

/** Демо-проект в браузере: он же нужен для проверки пропса `roleOptions`. */
const defaultProjectXml = () => listProjects()[0].xml;

describe('App: интеграция с BPMN Client SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(window, 'alert').mockImplementation(() => {});

    // CRA включает `resetMocks`, поэтому поведения задаём перед каждым тестом.
    mockSendEvent.mockResolvedValue({ ok: true, status: 202 });
    mockDeploySchema.mockResolvedValue({ ok: true, status: 202 });

    mockViewerProps.length = 0;
    mockEditorProps.length = 0;

    // Кэш проекта — общий для всего файла (`jsdom`): чистим, иначе тесты
    // подхватывали бы копию, сохранённую предыдущим тестом.
    window.localStorage.clear();

    Object.keys(mockSocketListeners).forEach(
      (event) => delete mockSocketListeners[event]
    );
  });

  it('руководитель видит SDK-просмотрщик с подсветкой токена из WS', async () => {
    openAs('Руководитель Заказчика');

    expect(screen.getByText(/BPMN Схема: Заказчика/)).toBeTruthy();
    expect(screen.getByTestId('sdk-viewer')).toBeTruthy();
    expect(screen.queryByTestId('sdk-editor')).toBeNull();
    expect(screen.getByText('Заказов пока нет.')).toBeTruthy();

    emitToken({
      instanceId: 'inst-cust-abc123',
      elementId: 'Task_SecurityCheck',
      state: 'ACTIVE',
      payload: { orderNum: '№777' },
    });

    // WS-событие наполняет список заказов...
    expect((await screen.findAllByText(/№777/)).length).toBeGreaterThan(0);

    // ...и попадает в подсветку просмотрщика вместе с активным узлом
    const viewerProps = lastProps(mockViewerProps);
    expect(viewerProps.tokens).toEqual({ Task_SecurityCheck: 'ACTIVE' });
    expect(viewerProps.activeElementId).toBe('Task_SecurityCheck');
  });

  it('служебные экземпляры деплоя не создают заказов', () => {
    openAs('Руководитель Заказчика');

    emitToken({
      instanceId: 'inst-deploy-customer',
      elementId: 'Process_Deployment',
      state: 'COMPLETED',
      payload: {},
    });

    expect(screen.getByText('Заказов пока нет.')).toBeTruthy();
    expect(lastProps(mockViewerProps).tokens).toEqual({});
  });

  // Движок держит на экземпляр ровно один ACTIVE-токен: активируя следующий
  // узел, он закрывает прежний событием `COMPLETED` (см. тесты ниже).
  it('COMPLETED прежнего узла не двигает текущий шаг и не закрывает заказ', () => {
    openAs('Руководитель Заказчика');

    emitToken({
      instanceId: 'inst-cust-move',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№810' },
    });

    emitToken({
      instanceId: 'inst-cust-move',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'COMPLETED',
      payload: {},
    });

    const viewerProps = lastProps(mockViewerProps);

    // Подсветка: узел ушёл в зелёный трейл, «текущий шаг» остался на месте.
    expect(viewerProps.tokens).toEqual({
      Task_CreatePurchaseOrder: 'COMPLETED',
    });
    expect(viewerProps.activeElementId).toBe('Task_CreatePurchaseOrder');

    // Статус процесса в таблице руководителя остался ACTIVE: событие COMPLETED
    // закрывает прежний узел, а не заказ (иначе здесь было бы COMPLETED).
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.queryByText('COMPLETED')).toBeNull();
  });

  // Регрессия «первый прямоугольник не красится зелёным после выполнения».
  // Последовательность событий движка: старт ставит токен на первый шаг, а
  // выполнение шага закрывает его `COMPLETED` (зелёный трейл) и активирует
  // следующий узел. Так первый блок виден подсветке в обоих состояниях.
  it('первый шаг уходит в COMPLETED, когда движок активирует второй узел', () => {
    openAs('Руководитель Заказчика');

    const instanceId = 'inst-cust-first-step';
    emitToken({
      instanceId,
      elementId: 'StartEvent_Customer',
      state: 'ACTIVE',
      payload: { orderNum: '№813' },
    });
    emitToken({
      instanceId,
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№813' },
    });

    // Действие менеджера закупок: движок закрывает прежний ACTIVE-узел и
    // активирует `Task_WaitForSupplierShipment`.
    emitToken({
      instanceId,
      elementId: 'StartEvent_Customer',
      state: 'COMPLETED',
      payload: {},
    });
    emitToken({
      instanceId,
      elementId: 'Task_CreatePurchaseOrder',
      state: 'COMPLETED',
      payload: {},
    });
    emitToken({
      instanceId,
      elementId: 'Task_WaitForSupplierShipment',
      state: 'ACTIVE',
      payload: { orderNum: '№813' },
    });

    const viewerProps = lastProps(mockViewerProps);

    expect(viewerProps.tokens).toEqual({
      StartEvent_Customer: 'COMPLETED',
      Task_CreatePurchaseOrder: 'COMPLETED',
      Task_WaitForSupplierShipment: 'ACTIVE',
    });
    expect(viewerProps.activeElementId).toBe('Task_WaitForSupplierShipment');
  });

  it('COMPLETED по незнакомому экземпляру не создаёт заказ', () => {
    openAs('Руководитель Заказчика');

    // Страница могла быть открыта посреди процесса: событие COMPLETED
    // приходит раньше первой активации и не должно заводить «заказ-призрак».
    emitToken({
      instanceId: 'inst-cust-orphan',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'COMPLETED',
      payload: {},
    });

    expect(screen.getByText('Заказов пока нет.')).toBeTruthy();
    expect(lastProps(mockViewerProps).tokens).toEqual({});
  });

  it('TIMED_OUT попадает в подсветку, но не двигает текущий шаг', () => {
    openAs('Руководитель Заказчика');

    emitToken({
      instanceId: 'inst-cust-sla',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№811' },
    });

    emitToken({
      instanceId: 'inst-cust-sla',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'TIMED_OUT',
      payload: {},
    });

    const viewerProps = lastProps(mockViewerProps);

    expect(viewerProps.tokens).toEqual({
      Task_CreatePurchaseOrder: 'TIMED_OUT',
    });
    expect(viewerProps.activeElementId).toBe('Task_CreatePurchaseOrder');
  });

  it('переключение в редактор и правки схемы уходят в деплой', async () => {
    openAs('Руководитель Заказчика');

    fireEvent.click(screen.getByText('Редактор схемы'));

    expect(screen.getByTestId('sdk-editor')).toBeTruthy();
    expect(screen.queryByTestId('sdk-viewer')).toBeNull();

    act(() => {
      lastProps(mockEditorProps).onChange(EDITED_VALID_XML);
    });

    fireEvent.click(screen.getByText(/Задеплоить BPMN/));

    await waitFor(() => expect(mockDeploySchema).toHaveBeenCalled());
    const [orgType, xml] = lastProps(mockDeploySchema.mock.calls);
    expect(orgType).toBe('CUSTOMER');
    expect(xml).toContain('Edited');
    expect(window.alert).toHaveBeenCalledWith(
      'Схема CUSTOMER успешно передана в оркестратор!'
    );
  });

  it('деплой отменяется, если движок схему не разберёт', async () => {
    // Движок отвечает `202` на любой запрос, а ошибку компиляции пишет только в
    // свой лог: деплой такой схемы выглядел бы успехом, не сохранив ничего.
    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    act(() => {
      lastProps(mockEditorProps).onChange(INCOMPATIBLE_XML);
    });

    fireEvent.click(screen.getByText(/Задеплоить BPMN/));

    expect(mockDeploySchema).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('Схема CUSTOMER несовместима с движком')
    );
    expect(window.alert.mock.calls[0][0]).toContain('Task_QualityControl');
  });

  it('несовместимую схему показывает предупреждение в панели схемы', () => {
    saveProjectProcess('CUSTOMER', INCOMPATIBLE_XML);

    openAs('Руководитель Заказчика');

    const warning = screen.getByTestId('schema-problems');
    expect(warning.textContent).toContain('Task_QualityControl');
    expect(warning.textContent).toContain('User task');
    expect(warning.textContent).toContain('несовместима с движком');
  });

  it('несовместимая схема не запускает процесс и не заводит заказ', async () => {
    saveProjectProcess('CUSTOMER', INCOMPATIBLE_XML);

    openAs('Мастер производства');
    fireEvent.click(screen.getAllByText(/Создать внутренний заказ на 100 л/)[0]);

    // Событий нет: движок определение не скомпилирует, экземпляра процесса не
    // появится, а в списке остался бы «заказ-призрак».
    expect(mockSendEvent).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('Схема Заказчика несовместима с движком')
    );

    const journalEntry = screen.getByText(/Заказ не создан: движок не примет схему/);
    expect(journalEntry).toBeTruthy();
    expect(
      screen.getByText(/Узел Task_QualityControl типа <bpmn:task> движок не разбирает/)
    ).toBeTruthy();
  });

  it('руководитель поставщика деплоит схему поставщика', async () => {
    openAs('Руководитель Поставщика');

    expect(screen.getByText(/BPMN Схема: Поставщика/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Задеплоить BPMN/));

    await waitFor(() => expect(mockDeploySchema).toHaveBeenCalled());
    const [orgType, xml] = lastProps(mockDeploySchema.mock.calls);
    expect(orgType).toBe('SUPPLIER');
    expect(xml).toContain('Process_SupplierSupply_v1');
  });

  it('старт процесса производством уходит в GatewayClient.sendEvent', async () => {
    openAs('Мастер производства');

    fireEvent.click(screen.getAllByText(/Создать внутренний заказ на 100 л/)[0]);

    // Старт — одно событие: `StartProcess` несёт `bpmn_xml` и называет узел
    // первого шага (его схема выводит из кнопки старта, см. `startProcess`).
    // Второго `CompleteBlock` нет: в режиме графа он
    // закрыл бы шаг, который движок только что активировал, и подсветка уехала
    // бы на следующий узел (M1, 10.2 п. 1).
    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));
    const [instanceId, eventName, elementId, outputData] =
      mockSendEvent.mock.calls[0];

    expect(instanceId).toMatch(/^inst-cust-/);
    expect(eventName).toBe('StartProcess');
    expect(elementId).toBe('Task_CreatePurchaseOrder');
    expect(outputData.orderNum).toBe('№101');
    expect(outputData.bpmn_xml).toContain('Process_MilkCustomer_v1');
  });

  // Регрессия «кнопка создания внутреннего заказа ругается на дубликат ключа».
  // Токен старта движок публикует до ответа HTTP на `StartProcess`: WS-кадр
  // приходит раньше, чем обработчик кнопки кладёт заказ в список. Тогда заказ
  // заводила ветка «незнакомый экземпляр» подписки, а обработчик добавлял второй
  // такой же — два узла с одним `key={o.id}` в списке заказов и в таблицах (см.
  // `handleProductionCreateOrder` в `App.jsx`).
  it('токен старта, обогнавший ответ HTTP, не удваивает заказ', async () => {
    // React пишет предупреждение о дубликате ключа в `console.error`: спай нужен
    // до первого рендера с дублем, поэтому ставим его в начале теста.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    openAs('Мастер производства');

    // Событие старта «зависает»: движок успевает опубликовать токен, а
    // `setOrders` обработчика ещё не выполнился.
    let releaseStart;
    mockSendEvent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStart = () => resolve({ ok: true, status: 202 });
        })
    );

    fireEvent.click(screen.getAllByText(/Создать внутренний заказ на 100 л/)[0]);

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));
    const [instanceId] = mockSendEvent.mock.calls[0];

    // `StartProcess` называет первый шаг — его движок и активирует.
    emitToken({
      instanceId,
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№101', volume: '100 Л' },
    });

    // Заказ заведён токеном и виден в списке ровно один раз.
    expect(screen.getAllByText('Заказ №101')).toHaveLength(1);

    // Приходит ответ HTTP: заказ уже известен, второй такой же не нужен.
    await act(async () => {
      releaseStart();
    });

    // Обработчик дошёл до журнала — значит, `setOrders` уже отработал.
    await waitFor(() =>
      expect(screen.getByText(/Заявка производства сформирована/)).toBeTruthy()
    );

    expect(screen.getAllByText('Заказ №101')).toHaveLength(1);

    const keyWarnings = consoleError.mock.calls
      .map((args) => args.map(String).join(' '))
      .filter((message) => message.includes('same key'));
    expect(keyWarnings).toEqual([]);

    // Спай снимаем: иначе он погасил бы `console.error` следующим тестам.
    consoleError.mockRestore();
  });

  it('передача заказа Поставщику активирует и его первый шаг', async () => {
    openAs('Менеджер закупок');

    emitToken({
      instanceId: 'inst-cust-supp',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№812' },
    });

    fireEvent.click(screen.getByText(/Сформировать и отправить заказ Поставщику/));

    // 1 — перевод заказчика, 2 — старт процесса Поставщика (одно событие:
    // `StartProcess` называет первый шаг `Task_SupplierCreateDocs`).
    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(2));
    const [custInstanceId, custEvent, custElement] = mockSendEvent.mock.calls[0];
    const [suppInstanceId, suppEvent, suppElement] = mockSendEvent.mock.calls[1];

    expect(custInstanceId).toBe('inst-cust-supp');
    // У кнопки в демо-схеме записаны только надпись и роль: событие нажатия —
    // умолчание `CompleteBlock`, а узел выведен по исходящей связи.
    expect(custEvent).toBe('CompleteBlock');
    expect(custElement).toBe('Task_WaitForSupplierShipment');

    expect(suppInstanceId).toMatch(/^inst-supp-/);
    expect(suppEvent).toBe('StartProcess');
    expect(suppElement).toBe('Task_SupplierCreateDocs');
  });

  it('кабинет показывает только шаги, роль которых в схеме принадлежит пользователю', () => {
    openAs('Мастер производства');

    // Роль `StartEvent_Customer` в схеме не задаётся (у событий нет
    // `resourceRole`), поэтому инициатор запуска определён ролью пользователя.
    expect(screen.getByText(/Инициация поставок сырья/)).toBeTruthy();
    expect(screen.queryByText(/Сырье доставлено/)).toBeNull();
    expect(screen.queryByText(/BPMN Схема: Заказчика/)).toBeNull();
  });

  it('шаг ОТК видит специалист ОТК (роль `Task_QualityControl` из схемы)', () => {
    openAs('Специалист ОТК');

    emitToken({
      instanceId: 'inst-cust-role-1',
      elementId: 'Task_QualityControl',
      state: 'ACTIVE',
      payload: { orderNum: '№808' },
    });

    expect(screen.getByText(/Сырье доставлено\. Провести экспресс-анализ молока/)).toBeTruthy();
  });

  it('перераспределение роли шага в схеме переключает кабинет', () => {
    render(<App />);

    // 1. В дефолтной схеме `Task_QualityControl` принадлежит ОТК.
    fireEvent.click(screen.getByText('Специалист ОТК'));
    emitToken({
      instanceId: 'inst-cust-role-2',
      elementId: 'Task_QualityControl',
      state: 'ACTIVE',
      payload: { orderNum: '№809' },
    });

    expect(screen.getByText(/Сырье доставлено/)).toBeTruthy();

    // 2. Руководитель Заказчика переназначает шаг менеджеру закупок прямо
    //    в схеме: правка приходит тем же `onChange`, что и правки холста.
    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Руководитель Заказчика'));
    fireEvent.click(screen.getByText('Редактор схемы'));

    // Инспектор узлов получает словарь ролей из проекта.
    expect(lastProps(mockEditorProps).roleOptions).toEqual(
      analyzeProject(defaultProjectXml()).roleCodes
    );

    act(() => {
      lastProps(mockEditorProps).onChange(
        buildProjectXml([
          {
            xml: setElementRole(DEFAULT_CUSTOMER_BPMN_XML, 'Task_QualityControl', 'MANAGER'),
            participantName: 'Молочный Завод',
          },
          { xml: DEFAULT_SUPPLIER_BPMN_XML, participantName: 'ООО «Альпийские Луга»' },
        ])
      );
    });

    // 3. Кабинет ОТК шаг больше не показывает...
    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Специалист ОТК'));

    expect(screen.queryByText(/Сырье доставлено/)).toBeNull();

    // ...а у менеджера закупок шаг появился.
    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Менеджер закупок'));

    expect(screen.getByText(/Сырье доставлено/)).toBeTruthy();
  });

  // Кросс-процессный триггер узла (`trg:processTrigger`) запускает процесс
  // второй стороны, поэтому подсказки поля «Запускаемый процесс» инспектора
  // берутся из схемы соседа: у Заказчика — процессы Поставщика и наоборот.
  it('инспектор узла подсказывает процессы второй стороны для триггера', () => {
    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    expect(lastProps(mockEditorProps).triggerTargets).toEqual([
      'Process_SupplierSupply_v1',
    ]);

    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Руководитель Поставщика'));
    fireEvent.click(screen.getByText('Редактор схемы'));

    expect(lastProps(mockEditorProps).triggerTargets).toEqual([
      'Process_MilkCustomer_v1',
    ]);
  });

  /* ------------------------------------------------------------------ *
   * Проект в браузере (`src/projectStore.js`)
   * ------------------------------------------------------------------ */

  it('схема из браузера подхватывается на старте процесса', async () => {
    const editedXml = setElementRole(EDITED_CUSTOMER_XML, 'Task_QualityControl', 'MANAGER');
    // Как после F5 с сохранённой копией: правки уже лежат в localStorage.
    saveProjectProcess('CUSTOMER', editedXml);

    openAs('Мастер производства');
    fireEvent.click(screen.getAllByText(/Создать внутренний заказ на 100 л/)[0]);

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));
    const [, , , outputData] = mockSendEvent.mock.calls[0];
    const project = listProjects()[0];

    // В движок уходит нарезка процесса проекта, а не исходная строка: роль
    // шага в ней — та, что сохранена в браузере.
    expect(project.xml).toContain('Закупка и правка Заказчика');
    expect(getRoleAssignments(outputData.bpmn_xml).Task_QualityControl).toBe('MANAGER');
    // В оркестратор уходит нарезка одного процесса, а не проект целиком.
    expect(outputData.bpmn_xml).not.toContain('<bpmn:process id="Process_SupplierSupply_v1"');
  });

  it('сохранённую схему показывает редактор руководителя', () => {
    saveProjectProcess('CUSTOMER', EDITED_CUSTOMER_XML);

    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    const xml = lastProps(mockEditorProps).xml;

    expect(xml).toContain('Закупка и правка Заказчика');
    // Редактору отдаётся проект целиком: процесс второй стороны на месте.
    expect(xml).toContain('Process_SupplierSupply_v1');
    expect(screen.getByTestId('schema-save-state').textContent).toMatch(
      /^✅ Сохранено в \d{2}:\d{2}:\d{2}$/
    );
  });

  it('кнопка «Сохранить схему» кладёт правки в браузер и меняет бейдж', () => {
    openAs('Руководитель Заказчика');

    // Демо-проект создаётся при первом запуске и сразу сохранён в браузере.
    expect(screen.getByTestId('schema-save-state').textContent).toMatch(/^✅ Сохранено в /);

    fireEvent.click(screen.getByText('Редактор схемы'));
    act(() => {
      lastProps(mockEditorProps).onChange(EDITED_PROJECT_XML);
    });

    expect(screen.getByTestId('schema-save-state').textContent).toBe(
      '⚠ Есть несохранённые изменения'
    );

    fireEvent.click(screen.getByText('Сохранить схему'));

    expect(listProjects()[0].xml).toBe(EDITED_PROJECT_XML);
    expect(screen.getByTestId('schema-save-state').textContent).toMatch(
      /^✅ Сохранено в \d{2}:\d{2}:\d{2}$/
    );
    // Сохранение локальное: в оркестратор при этом ничего не уходит.
    expect(mockDeploySchema).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it('кнопка «Демо-схема» возвращает процесс SDK и сохраняет проект', () => {
    saveProjectProcess('CUSTOMER', EDITED_CUSTOMER_XML);

    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));
    expect(lastProps(mockEditorProps).xml).toContain('Закупка и правка Заказчика');

    fireEvent.click(screen.getByText('Демо-схема'));

    const xml = lastProps(mockEditorProps).xml;

    // Сброс меняет только процесс своего контура: второй остаётся в проекте.
    expect(xml).not.toContain('Закупка и правка Заказчика');
    expect(xml).toContain('Process_MilkCustomer_v1');
    expect(xml).toContain('Process_SupplierSupply_v1');
    expect(listProjects()[0].xml).not.toContain('Закупка и правка Заказчика');
    expect(screen.getByTestId('schema-save-state').textContent).toMatch(/^✅ Сохранено в /);
  });

  it('правки переживают перезагрузку страницы', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText('Руководитель Заказчика'));
    fireEvent.click(screen.getByText('Редактор схемы'));

    act(() => {
      lastProps(mockEditorProps).onChange(EDITED_PROJECT_XML);
    });
    fireEvent.click(screen.getByText('Сохранить схему'));

    // F5: компонент монтируется заново, состояние React сбрасывается.
    unmount();
    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    expect(lastProps(mockEditorProps).xml).toBe(EDITED_PROJECT_XML);
  });

  it('деплой схемы обновляет копию в браузере', async () => {
    openAs('Руководитель Поставщика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    // Правка процесса второй стороны: проект остаётся проектом из двух процессов.
    const shippedXml = setElementRole(
      DEFAULT_SUPPLIER_BPMN_XML,
      'Task_SupplierShipment',
      'SUPPLIER_EXECUTIVE'
    );

    act(() => {
      lastProps(mockEditorProps).onChange(
        buildProjectXml([
          { xml: DEFAULT_CUSTOMER_BPMN_XML, participantName: 'Молочный Завод' },
          { xml: shippedXml, participantName: 'ООО «Альпийские Луга»' },
        ])
      );
    });

    fireEvent.click(screen.getByText(/Задеплоить BPMN/));

    await waitFor(() => expect(mockDeploySchema).toHaveBeenCalled());
    await waitFor(() =>
      expect(getRoleAssignments(listProjects()[0].xml).Task_SupplierShipment).toBe(
        'SUPPLIER_EXECUTIVE'
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('schema-save-state').textContent).toMatch(/^✅ Сохранено в /)
    );
  });

  /* ------------------------------------------------------------------ *
   * Кнопки участников (`act:userAction`) — определение в блоках схемы
   * ------------------------------------------------------------------ */

  // Надпись, роль, событие и узлы кнопки живут в схеме: правка блока меняет
  // кабинет без правок кода (см. README, «Кнопки участников»).
  it('кнопка берётся из схемы: правка надписи и события меняет кабинет', async () => {
    saveProjectProcess(
      'CUSTOMER',
      setElementActions(DEFAULT_CUSTOMER_BPMN_XML, 'Task_CreatePurchaseOrder', [
        {
          id: 'sendToSupplier',
          label: 'Отправить в Альпы',
          icon: 'Send',
          event: 'SendToAlps',
          elementId: 'Task_WaitForSupplierShipment',
          startsProcess: 'Process_SupplierSupply_v1',
        },
      ])
    );

    openAs('Менеджер закупок');

    emitToken({
      instanceId: 'inst-cust-actions',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№900' },
    });

    // Старой надписи в кабинете больше нет — есть та, что объявлена в схеме.
    expect(screen.queryByText(/Сформировать и отправить заказ Поставщику/)).toBeNull();
    fireEvent.click(screen.getByText('Отправить в Альпы'));

    // И событие уходит то, которое объявлено в кнопке.
    await waitFor(() => expect(mockSendEvent).toHaveBeenCalled());
    const [instanceId, eventName, elementId] = mockSendEvent.mock.calls[0];

    expect(instanceId).toBe('inst-cust-actions');
    expect(eventName).toBe('SendToAlps');
    expect(elementId).toBe('Task_WaitForSupplierShipment');
  });

  it('роль кнопки из схемы решает, кто её видит', () => {
    // Роль инициатора объявлена в самой кнопке стартового события: переносим её
    // на менеджера закупок — кнопку видит он, а не производство.
    saveProjectProcess(
      'CUSTOMER',
      setElementActions(DEFAULT_CUSTOMER_BPMN_XML, 'StartEvent_Customer', [
        {
          id: 'createOrder',
          label: 'Создать заказ',
          role: 'MANAGER',
          icon: 'PlusCircle',
          event: 'StartPurchaseOrder',
          elementId: 'Task_CreatePurchaseOrder',
        },
      ])
    );

    openAs('Мастер производства');

    expect(screen.queryByText(/Инициация поставок сырья/)).toBeNull();

    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Менеджер закупок'));

    // Кнопку с ролью `MANAGER` видит менеджер закупок, а не производство.
    expect(screen.getAllByText(/Создать заказ/).length).toBeGreaterThan(0);
  });

  it('схема без кнопок участников не показывает действий', () => {
    // Схема совместима с движком, но `act:userAction` в ней нет: кабинет
    // показывает только ожидание — нажимать нечего.
    saveProjectProcess('CUSTOMER', XML_WITHOUT_ACTIONS);

    openAs('Менеджер закупок');

    emitToken({
      instanceId: 'inst-cust-no-actions',
      elementId: 'Task_QualityControl',
      state: 'ACTIVE',
      payload: { orderNum: '№901' },
    });

    expect(screen.getByText(/Кабинет: Менеджер закупок/)).toBeTruthy();
    expect(screen.queryByText(/Сформировать и отправить заказ Поставщику/)).toBeNull();
    expect(screen.queryByText(/Выписать пропуск на КПП/)).toBeNull();
  });

  // Блок, добавленный в редакторе вместе с кнопкой, работает без правок кода:
  // кабинету ключ такой кнопки незнаком, но шаг всё равно показывается — он
  // только двигает токен, а событие и узел для этого доводит схема
  // (`schemaStepActions` + `handleSchemaStepAction`).
  it('блок, добавленный в схеме после ОТК, показывает кнопку своей роли', async () => {
    saveProjectProcess('CUSTOMER', XML_WITH_QUALITY_STEP);

    openAs('Специалист ОТК');

    emitToken({
      instanceId: 'inst-cust-quality-step',
      elementId: 'Task_QualityStorage',
      state: 'ACTIVE',
      payload: { orderNum: '№910' },
    });

    // Роль шага — из схемы (`bpmn:potentialOwner` блока), надпись шага — имя узла.
    expect(screen.getByText(/Шаг «Принять сырьё на склад ОТК»/)).toBeTruthy();

    fireEvent.click(screen.getByText('Принять сырьё на склад'));

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalled());

    const [instanceId, eventName, elementId] = mockSendEvent.mock.calls[0];

    // Кнопка без параметров: событие — умолчание схемы («шаг выполнен»), а узел —
    // следующий блок по единственной исходящей связи.
    expect(instanceId).toBe('inst-cust-quality-step');
    expect(eventName).toBe('CompleteBlock');
    expect(elementId).toBe('EndEvent_Customer');
  });

  it('шаг схемы без обработчика виден только на своём узле и только своей роли', () => {
    // Роль кнопки (`role`) сильнее роли узла (`potentialOwner` = `MANAGER`):
    // кнопку на шаге менеджера закупок получает охрана КПП.
    saveProjectProcess(
      'CUSTOMER',
      setElementActions(DEFAULT_CUSTOMER_BPMN_XML, 'Task_WaitForSupplierShipment', [
        {
          id: 'supplierDocsAccept',
          label: 'Принять документы на складе',
          role: 'SECURITY',
          icon: 'FileText',
        },
      ])
    );

    openAs('Менеджер закупок');

    emitToken({
      instanceId: 'inst-cust-schema-step',
      elementId: 'Task_WaitForSupplierShipment',
      state: 'ACTIVE',
      payload: { orderNum: '№911' },
    });

    expect(screen.queryByText('Принять документы на складе')).toBeNull();

    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Охрана КПП'));

    expect(screen.getAllByText('Принять документы на складе').length).toBeGreaterThan(0);

    // Токен ушёл на другой узел — кнопка шага уезжает вместе с ним.
    emitToken({
      instanceId: 'inst-cust-schema-step',
      elementId: 'Task_QualityControl',
      state: 'ACTIVE',
      payload: { orderNum: '№911' },
    });

    expect(screen.queryByText('Принять документы на складе')).toBeNull();
  });

  it('кнопка шага из схемы умеет сигнал второй стороне (`counterpartEvent`)', async () => {
    saveProjectProcess(
      'SUPPLIER',
      setElementActions(DEFAULT_SUPPLIER_BPMN_XML, 'Task_SupplierShipment', [
        {
          id: 'shipmentWithSignal',
          label: 'Отгрузить по сигналу',
          role: 'SUPPLIER_MANAGER',
          icon: 'Truck',
          counterpartEvent: 'SupplierShippedSignal',
          counterpartElementId: 'Task_ReceiveDocsAndIssuePass',
        },
      ])
    );

    openAs('Менеджер Поставщика');

    // Заказ заводит сторона Заказчика, а процесс Поставщика движок запускает по
    // сигналу — в кабинете это два токена по одному номеру заказа.
    emitToken({
      instanceId: 'inst-cust-counterpart',
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum: '№912' },
    });
    emitToken({
      instanceId: 'inst-supp-counterpart',
      elementId: 'Task_SupplierShipment',
      state: 'ACTIVE',
      payload: { orderNum: '№912' },
    });

    fireEvent.click(screen.getByText('Отгрузить по сигналу'));

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(2));

    const [step, counterpart] = mockSendEvent.mock.calls;

    // Нажатие двигает токен в своём контуре...
    expect(step[0]).toBe('inst-supp-counterpart');
    expect(step[1]).toBe('CompleteBlock');
    expect(step[2]).toBe('EndEvent_Supplier');
    // ...и уходит сигнал в экземпляр второй стороны (`counterpartEvent` кнопки).
    expect(counterpart[0]).toBe('inst-cust-counterpart');
    expect(counterpart[1]).toBe('SupplierShippedSignal');
    expect(counterpart[2]).toBe('Task_ReceiveDocsAndIssuePass');
  });

  it('заказ поставщику уходит сообщением: экземпляр второй стороны создаёт движок (M3)', async () => {
    createProject({
      name: 'Молочный завод (M3)',
      xml: buildProjectXml([
        { xml: DAIRY_PLANT_PROCESS_XML, participantName: 'Молочный завод' },
        { xml: DAIRY_SUPPLIER_PROCESS_XML, participantName: 'Поставщик сырья' },
      ]),
    });

    openAs('Менеджер по продажам');
    fireEvent.click((await screen.findAllByText('Принять заказ клиента'))[0]);

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalled());

    const orderNum = mockSendEvent.mock.calls[0][3].orderNum;
    const plantInstanceId = mockSendEvent.mock.calls[0][0];

    // Один токен завода прошёл закупку: шаг отправки активен.
    emitToken({
      instanceId: plantInstanceId,
      elementId: 'Task_SendPO',
      state: 'ACTIVE',
      payload: { orderNum },
    });

    // Кнопку отправки ведёт роль закупки.
    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Менеджер по закупкам'));

    mockSendEvent.mockClear();
    mockDeploySchema.mockClear();

    fireEvent.click((await screen.findAllByText('Отправить заказ поставщику'))[0]);

    // Схема второй стороны задеплоена заранее, а её экземпляр стартует не
    // клиент: событие одно — закрытие шага завода. Второго `StartProcess`
    // (`startProcess` поставщика) быть не должно.
    await waitFor(() => expect(mockDeploySchema).toHaveBeenCalled());
    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));

    expect(mockDeploySchema.mock.calls[0][0]).toBe('SUPPLIER');

    const [instanceId, eventName, elementId] = mockSendEvent.mock.calls[0];

    expect(instanceId).toBe(plantInstanceId);
    expect(eventName).toBe('CompleteBlock');
    expect(elementId).toBe('Event_SendPO');
  });

  it('кнопка на блоке без единственной исходящей связи подсказывает про узел', () => {
    // У конечного события связей нет: куда идти после нажатия — неизвестно, а
    // движок токен двигает именно узлом события. Кнопки такой шаг не получает:
    // вместо нажатия «в никуда» кабинет объясняет, чего не хватает в схеме.
    saveProjectProcess(
      'CUSTOMER',
      setElementActions(DEFAULT_CUSTOMER_BPMN_XML, 'EndEvent_Customer', [
        {
          id: 'archiveOrder',
          label: 'Сдать заказ в архив',
          role: 'QUALITY',
          icon: 'FileText',
        },
      ])
    );

    openAs('Специалист ОТК');

    emitToken({
      instanceId: 'inst-cust-no-target',
      elementId: 'EndEvent_Customer',
      state: 'ACTIVE',
      payload: { orderNum: '№913' },
    });

    expect(screen.getByText(/Шаг «Молоко сдано в производство»/)).toBeTruthy();
    expect(screen.getByText(/Шаг некуда выполнить/)).toBeTruthy();
    expect(screen.queryByText('Сдать заказ в архив')).toBeNull();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  /* ------------------------------------------------------------------ *
   * Метрики выполненных процессов (`src/metricsStore.js`)
   * ------------------------------------------------------------------ */

  /** Запускает заказ за производство и возвращает его экземпляр и номер. */
  const startOrderAsProduction = async () => {
    openAs('Мастер производства');
    fireEvent.click(screen.getAllByText(/Создать внутренний заказ на 100 л/)[0]);

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));

    const [instanceId, , , outputData] = mockSendEvent.mock.calls[0];

    return { instanceId, orderNum: outputData.orderNum };
  };

  // Регрессия «инфографика руководителя пуста»: время выполнения считает клиент,
  // движок о завершении процесса отдельного события не шлёт (токен просто
  // встаёт на конечный узел), а хранится метрика в браузере — поэтому её видно и
  // после перезагрузки страницы, и после смены пользователя.
  it('время выполнения процесса сохраняется и попадает в инфографику руководителя', async () => {
    const { instanceId, orderNum } = await startOrderAsProduction();

    // Движок активирует конечный узел процесса заказчика: исходящих связей у
    // конечного события нет — для схемы это финиш процесса.
    emitToken({
      instanceId,
      elementId: 'EndEvent_Customer',
      state: 'ACTIVE',
      payload: { orderNum },
    });

    const [run] = loadRuns();

    expect(run).toMatchObject({
      id: instanceId,
      org: 'CUSTOMER',
      processId: 'Process_MilkCustomer_v1',
      processName: 'Закупка и приемка сырого молока',
      orderNumber: orderNum,
      lastElementId: 'EndEvent_Customer',
      status: 'COMPLETED',
    });
    expect(typeof run.durationMs).toBe('number');

    // Журнал кабинета тоже знает о финише и его времени: запись адресована всем
    // ролям контура (`logEvent(<org>, 'ALL', …)`).
    expect(screen.getByText(/Процесс завершён/)).toBeTruthy();
    expect(screen.getByText(/выполнен за/)).toBeTruthy();

    // Смена пользователя: состояние React уходит вместе с кабинетом заказа...
    fireEvent.click(screen.getByText('Выход'));
    fireEvent.click(screen.getByText('Руководитель Заказчика'));

    // ...а метрика остаётся: она в `localStorage`, а не в состоянии React.
    // Инфографика не зависит от того, кто открыл страницу: метрику считает
    // клиент, а не движок.
    expect(screen.getByTestId('metrics-panel')).toBeTruthy();
    expect(screen.getByTestId('metrics-process').textContent).toContain(
      'Закупка и приемка сырого молока'
    );
    expect(screen.getAllByTestId('metrics-bar')).toHaveLength(1);
    expect(screen.queryByTestId('metrics-empty')).toBeNull();
  });

  it('промежуточный узел метрику не закрывает', async () => {
    const { instanceId, orderNum } = await startOrderAsProduction();

    emitToken({
      instanceId,
      elementId: 'Task_CreatePurchaseOrder',
      state: 'ACTIVE',
      payload: { orderNum },
    });

    const [run] = loadRuns();

    expect(run.status).toBe('ACTIVE');
    expect(run.durationMs).toBeNull();
    expect(run.lastElementId).toBe('');
  });

  it('метрика не пишется по экземпляру, который клиент не начинал', () => {
    openAs('Руководитель Заказчика');

    // Страница могла быть открыта посреди процесса: измерить его время нечем.
    emitToken({
      instanceId: 'inst-cust-foreign',
      elementId: 'EndEvent_Customer',
      state: 'ACTIVE',
      payload: { orderNum: '№999' },
    });

    expect(loadRuns()).toEqual([]);
    expect(screen.getByTestId('metrics-empty')).toBeTruthy();
  });

  it('кнопка «Очистить» забывает сохранённые метрики', () => {
    // Готовим метрику так же, как её создаёт клиент: старт экземпляра и финиш.
    beginRun({
      id: 'inst-cust-clear',
      org: 'CUSTOMER',
      processId: 'Process_MilkCustomer_v1',
      processName: 'Закупка и приемка сырого молока',
      orderNumber: '№102',
      startedAt: '2026-10-12T10:00:00.000Z',
    });
    completeRun('inst-cust-clear', { finishedAt: '2026-10-12T10:00:07.000Z' });

    openAs('Руководитель Заказчика');

    expect(screen.getAllByTestId('metrics-bar')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('metrics-clear'));

    expect(loadRuns()).toEqual([]);
    expect(screen.getByTestId('metrics-empty')).toBeTruthy();
  });

  /* ------------------------------------------------------------------ *
   * Проекты: загруженный BPMN играется без правок кода
   * ------------------------------------------------------------------ */

  it('проект из списка открывается со своими ролями и играется по схеме', async () => {
    // Первый проект — сохранённая копия демо-проекта, второй — «загруженный»
    // BPMN склада: другой процесс, другая роль, другая кнопка старта.
    saveProjectProcess('CUSTOMER', EDITED_CUSTOMER_XML);
    createProject({ name: 'Склад', xml: STORE_PROJECT_XML });

    render(<App />);
    fireEvent.click(screen.getByText('Проекты'));

    expect(screen.getByText('Склад')).toBeTruthy();
    const openButtons = screen.getAllByText('Открыть');
    expect(openButtons).toHaveLength(2);

    // Открываем второй проект: вход собирается из его каталога ролей.
    fireEvent.click(openButtons[1]);
    fireEvent.click(screen.getByText('Кладовщик'));

    expect(screen.getByText(/Кабинет: Кладовщик/)).toBeTruthy();

    fireEvent.click(screen.getAllByText('Принять поставку')[0]);

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));

    const [instanceId, eventName, startElementId, outputData] = mockSendEvent.mock.calls[0];

    expect(instanceId).toMatch(/^inst-cust-/);
    expect(eventName).toBe('StartProcess');
    // Первый шаг выведен из схемы: стартовое событие -> задача склада.
    expect(startElementId).toBe('Task_Store');
    expect(outputData.bpmn_xml).toContain('Process_Store_v1');
    expect(outputData.bpmn_xml).not.toContain('Process_MilkCustomer_v1');
  });

  it('схема без кнопки инициатора запускается по связи стартового события', async () => {
    createProject({ name: 'Сборка', xml: PICK_PROJECT_XML });

    render(<App />);
    // Каталога ролей нет: титул карточки — имя из `bpmn:potentialOwner`.
    fireEvent.click(screen.getByText('PICKER'));

    // Кнопки `createOrder` в схеме нет — кабинет предлагает запуск по схеме.
    expect(screen.getByText('Запуск по схеме')).toBeTruthy();
    fireEvent.click(screen.getByText('Запустить процесс'));

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));

    const [instanceId, eventName, startElementId, outputData] = mockSendEvent.mock.calls[0];

    expect(instanceId).toMatch(/^inst-cust-/);
    expect(eventName).toBe('StartProcess');
    // Токен выводится из единственной исходящей связи стартового события.
    expect(startElementId).toBe('Task_Pick');
    expect(outputData.bpmn_xml).toContain('Process_Pick_v1');
  });

  /**
   * Демо-проект «Молочный завод» — второй готовый проект SDK рядом с демо-закупкой.
   * Кнопка в списке проектов создаёт его из `DAIRY_PLANT_PROJECT_XML`, и дальше
   * приложение работает с ним как с любым загруженным BPMN: вход по каталогу
   * ролей, кабинет — по кнопкам схемы.
   */
  it('кнопка «Молочный завод» создаёт проект из двух процессов', () => {
    render(<App />);
    fireEvent.click(screen.getByText('Проекты'));
    fireEvent.click(screen.getByText('Молочный завод'));

    const project = listProjects().find(
      (item) => item.name === DAIRY_PLANT_PROJECT_NAME
    );

    expect(project).toBeTruthy();
    expect(getProcessIds(project.xml)).toEqual([
      DAIRY_PLANT_PROCESS_ID,
      DAIRY_SUPPLIER_PROCESS_ID,
    ]);

    // Проект сразу открыт: подпись в шапке и роли обоих пулов на входе.
    expect(screen.getByText(/Проект:/).textContent).toContain(DAIRY_PLANT_PROJECT_NAME);
    expect(screen.getByText('Директор завода')).toBeTruthy();
    expect(screen.getByText('Менеджер по продажам')).toBeTruthy();
    expect(screen.getByText('Менеджер по продажам сырья')).toBeTruthy();
  });
});
