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
import { ROLE_CODES } from './roles';
import { loadSchema, saveSchema } from './schemaStore';
import { DEFAULT_CUSTOMER_BPMN_XML, SOCKET_EVENTS, setElementRole } from './vendor/bpmn-sdk';

/** XML «правок редактора»: маркер, по которому видно, какая схема поехала дальше. */
const EDITED_XML = '<bpmn:definitions id="EditedInEditor" />';

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

describe('App: интеграция с BPMN Client SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(window, 'alert').mockImplementation(() => {});

    // CRA включает `resetMocks`, поэтому поведения задаём перед каждым тестом.
    mockSendEvent.mockResolvedValue({ ok: true, status: 202 });
    mockDeploySchema.mockResolvedValue({ ok: true, status: 202 });

    mockViewerProps.length = 0;
    mockEditorProps.length = 0;

    // Кэш схем — общий для всего файла (`jsdom`): чистим, иначе тесты
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
  // Последовательность событий реального движка: старт процесса ставит токен на
  // `StartEvent_Customer`, второе событие старта переносит его на первый шаг, а
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
      lastProps(mockEditorProps).onChange('<bpmn:definitions id="Edited" />');
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

    fireEvent.click(screen.getByText(/Создать внутренний заказ на 100 л/));

    // Старт — два события: `StartProcess` (стартовое событие + `bpmn_xml`),
    // затем постановка токена на первый шаг (см. `startProcess` в `App.jsx`).
    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(2));
    const [instanceId, eventName, elementId, outputData] =
      mockSendEvent.mock.calls[0];

    expect(instanceId).toMatch(/^inst-cust-/);
    expect(eventName).toBe('StartProcess');
    expect(elementId).toBe('StartEvent_Customer');
    expect(outputData.orderNum).toBe('№101');
    expect(outputData.bpmn_xml).toContain('Process_MilkCustomer_v1');
  });

  // Регрессия: движок закрывает `COMPLETED` тот узел, который был `ACTIVE`,
  // поэтому первый блок красится только если токен на него встал. Без второго
  // события старта движок держал `ACTIVE` на `StartEvent_Customer`, и первый
  // прямоугольник (`Task_CreatePurchaseOrder`) не появлялся в его состоянии
  // вообще — зелёным он не становился.
  it('старт процесса переносит токен на первый шаг заказчика', async () => {
    openAs('Мастер производства');

    fireEvent.click(screen.getByText(/Создать внутренний заказ на 100 л/));

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(2));
    const [instanceId, eventName, elementId, outputData] =
      mockSendEvent.mock.calls[1];

    // Тот же экземпляр, что и у `StartProcess`: иначе токен уехал бы в чужой.
    expect(instanceId).toBe(mockSendEvent.mock.calls[0][0]);
    expect(eventName).toBe('StartPurchaseOrder');
    expect(elementId).toBe('Task_CreatePurchaseOrder');
    // Схема уехала первым событием: во втором её нет.
    expect(outputData.bpmn_xml).toBeUndefined();
    expect(outputData.orderNum).toBe('№101');
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

    // 1 — перевод заказчика, 2 и 3 — старт процесса Поставщика (стартовое
    // событие и первый шаг `Task_SupplierCreateDocs`).
    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(3));
    const [custInstanceId, custEvent, custElement] = mockSendEvent.mock.calls[0];
    const [suppInstanceId, suppEvent, suppElement] = mockSendEvent.mock.calls[1];
    const [, suppStepEvent, suppStepElement] = mockSendEvent.mock.calls[2];

    expect(custInstanceId).toBe('inst-cust-supp');
    expect(custEvent).toBe('SendToSupplier');
    expect(custElement).toBe('Task_WaitForSupplierShipment');

    expect(suppInstanceId).toMatch(/^inst-supp-/);
    expect(suppEvent).toBe('StartProcess');
    expect(suppElement).toBe('StartEvent_Supplier');

    expect(mockSendEvent.mock.calls[2][0]).toBe(suppInstanceId);
    expect(suppStepEvent).toBe('StartSupplierDocs');
    expect(suppStepElement).toBe('Task_SupplierCreateDocs');
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

    // Инспектор узлов получает словарь ролей из приложения.
    expect(lastProps(mockEditorProps).roleOptions).toEqual(ROLE_CODES);

    act(() => {
      lastProps(mockEditorProps).onChange(
        setElementRole(DEFAULT_CUSTOMER_BPMN_XML, 'Task_QualityControl', 'MANAGER')
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
   * Локальный кэш схем (`src/schemaStore.js`)
   * ------------------------------------------------------------------ */

  it('схема из браузера подхватывается на старте процесса', async () => {
    const editedXml = setElementRole(DEFAULT_CUSTOMER_BPMN_XML, 'Task_QualityControl', 'MANAGER');
    // Как после F5 с сохранённой копией: правки уже лежат в localStorage.
    saveSchema('CUSTOMER', editedXml);

    openAs('Мастер производства');
    fireEvent.click(screen.getByText(/Создать внутренний заказ на 100 л/));

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(2));
    const [, , , outputData] = mockSendEvent.mock.calls[0];
    expect(outputData.bpmn_xml).toBe(editedXml);
  });

  it('сохранённую схему показывает редактор руководителя', () => {
    saveSchema('CUSTOMER', EDITED_XML);

    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    expect(lastProps(mockEditorProps).xml).toBe(EDITED_XML);
    expect(screen.getByTestId('schema-save-state').textContent).toMatch(
      /^✅ Сохранено в \d{2}:\d{2}:\d{2}$/
    );
  });

  it('кнопка «Сохранить схему» кладёт правки в браузер и меняет бейдж', () => {
    openAs('Руководитель Заказчика');

    // Пока правок нет, копии в браузере тоже нет — используется демо-схема SDK.
    expect(loadSchema('CUSTOMER')).toBeNull();
    expect(screen.getByTestId('schema-save-state').textContent).toBe('Схема по умолчанию');

    fireEvent.click(screen.getByText('Редактор схемы'));
    act(() => {
      lastProps(mockEditorProps).onChange(EDITED_XML);
    });

    expect(screen.getByTestId('schema-save-state').textContent).toBe(
      '⚠ Есть несохранённые изменения'
    );

    fireEvent.click(screen.getByText('Сохранить схему'));

    expect(loadSchema('CUSTOMER')?.xml).toBe(EDITED_XML);
    expect(screen.getByTestId('schema-save-state').textContent).toMatch(
      /^✅ Сохранено в \d{2}:\d{2}:\d{2}$/
    );
    // Сохранение локальное: в оркестратор при этом ничего не уходит.
    expect(mockDeploySchema).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it('кнопка «Демо-схема» возвращает схему SDK и чистит копию', () => {
    saveSchema('CUSTOMER', EDITED_XML);

    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));
    expect(lastProps(mockEditorProps).xml).toBe(EDITED_XML);

    fireEvent.click(screen.getByText('Демо-схема'));

    expect(lastProps(mockEditorProps).xml).toBe(DEFAULT_CUSTOMER_BPMN_XML);
    expect(loadSchema('CUSTOMER')).toBeNull();
    expect(screen.getByTestId('schema-save-state').textContent).toBe('Схема по умолчанию');
  });

  it('правки переживают перезагрузку страницы', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText('Руководитель Заказчика'));
    fireEvent.click(screen.getByText('Редактор схемы'));

    act(() => {
      lastProps(mockEditorProps).onChange(EDITED_XML);
    });
    fireEvent.click(screen.getByText('Сохранить схему'));

    // F5: компонент монтируется заново, состояние React сбрасывается.
    unmount();
    openAs('Руководитель Заказчика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    expect(lastProps(mockEditorProps).xml).toBe(EDITED_XML);
  });

  it('деплой схемы обновляет копию в браузере', async () => {
    openAs('Руководитель Поставщика');
    fireEvent.click(screen.getByText('Редактор схемы'));

    act(() => {
      lastProps(mockEditorProps).onChange(EDITED_XML);
    });

    fireEvent.click(screen.getByText(/Задеплоить BPMN/));

    await waitFor(() => expect(loadSchema('SUPPLIER')?.xml).toBe(EDITED_XML));
    await waitFor(() =>
      expect(screen.getByTestId('schema-save-state').textContent).toMatch(/^✅ Сохранено в /)
    );
  });
});
