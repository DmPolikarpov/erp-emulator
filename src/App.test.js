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
import { SOCKET_EVENTS } from './vendor/bpmn-sdk';

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

    await waitFor(() => expect(mockSendEvent).toHaveBeenCalledTimes(1));
    const [instanceId, eventName, elementId, outputData] =
      mockSendEvent.mock.calls[0];

    expect(instanceId).toMatch(/^inst-cust-/);
    expect(eventName).toBe('StartProcess');
    expect(elementId).toBe('StartEvent_Customer');
    expect(outputData.orderNum).toBe('№101');
    expect(outputData.bpmn_xml).toContain('Process_MilkCustomer_v1');
  });
});
