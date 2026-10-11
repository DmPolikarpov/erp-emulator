import { act, renderHook } from '@testing-library/react';

import { SOCKET_STATUS, TOKEN_STATES } from '../constants';
import { GatewayClient } from '../client/httpClient';
import { SOCKET_EVENTS, StatusSocket } from '../client/wsClient';
import { useBpmnEngine } from './useBpmnEngine';
import { useProcessTokens } from './useProcessTokens';
import { useTokenHighlight } from './useTokenHighlight';

/** Заглушка сокета: ручная рассылка событий и учёт подписчиков. */
function createSocketStub() {
  const listeners = {};

  return {
    status: SOCKET_STATUS.CLOSED,
    connectCount: 0,
    disconnectCount: 0,
    get connected() {
      return this.status === SOCKET_STATUS.OPEN;
    },
    on(event, listener) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
      return () => {
        listeners[event] = listeners[event].filter((item) => item !== listener);
      };
    },
    emit(event, payload) {
      (listeners[event] || []).slice().forEach((listener) => listener(payload));
    },
    subscriberCount(event) {
      return (listeners[event] || []).length;
    },
    connect() {
      this.connectCount += 1;
    },
    disconnect() {
      this.disconnectCount += 1;
    },
  };
}

const tokenMessage = (instanceId, elementId, state) => ({
  instanceId,
  elementId,
  state,
  timestamp: null,
  payload: null,
});

describe('useProcessTokens', () => {
  it('накапливает состояния токенов по экземплярам', () => {
    const socket = createSocketStub();
    const { result } = renderHook(() => useProcessTokens(socket, []));

    act(() => {
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-cust-1', 'Task_Approve', TOKEN_STATES.ACTIVE)
      );
    });
    act(() => {
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-supp-1', 'Task_Pay', TOKEN_STATES.ACTIVE)
      );
    });

    expect(result.current.tokensFor('inst-cust-1')).toEqual({
      Task_Approve: TOKEN_STATES.ACTIVE,
    });
    expect(result.current.tokensFor('inst-supp-1')).toEqual({
      Task_Pay: TOKEN_STATES.ACTIVE,
    });
    expect(result.current.activeElementsFor('inst-cust-1')).toEqual(['Task_Approve']);
    expect(result.current.lastEvent.instanceId).toBe('inst-supp-1');
  });

  it('заменяет состояние токена при повторном событии', () => {
    const socket = createSocketStub();
    const { result } = renderHook(() => useProcessTokens(socket, []));

    act(() => {
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-cust-1', 'Task_Approve', TOKEN_STATES.ACTIVE)
      );
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-cust-1', 'Task_Approve', TOKEN_STATES.COMPLETED)
      );
    });

    expect(result.current.tokensFor('inst-cust-1')).toEqual({
      Task_Approve: TOKEN_STATES.COMPLETED,
    });
    expect(result.current.activeElementsFor('inst-cust-1')).toEqual([]);
  });

  it('фильтрует чужие и служебные экземпляры', () => {
    const socket = createSocketStub();
    const { result } = renderHook(() =>
      useProcessTokens(socket, ['inst-cust-1'])
    );

    act(() => {
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-cust-1', 'Task_A', TOKEN_STATES.ACTIVE)
      );
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-cust-2', 'Task_B', TOKEN_STATES.ACTIVE)
      );
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-deploy-customer', 'Process_Deployment', TOKEN_STATES.ACTIVE)
      );
    });

    expect(Object.keys(result.current.tokensByInstance)).toEqual(['inst-cust-1']);
  });

  it('принимает события деплоя по флагу', () => {
    const socket = createSocketStub();
    const { result } = renderHook(() =>
      useProcessTokens(socket, [], { includeDeployInstances: true })
    );

    act(() => {
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-deploy-customer', 'Process_Deployment', TOKEN_STATES.COMPLETED)
      );
    });

    expect(result.current.tokensFor('inst-deploy-customer')).toEqual({
      Process_Deployment: TOKEN_STATES.COMPLETED,
    });
  });

  it('не переподписывается при том же наборе экземпляров', () => {
    const socket = createSocketStub();
    const { rerender } = renderHook(
      ({ ids }) => useProcessTokens(socket, ids),
      { initialProps: { ids: ['inst-cust-1'] } }
    );

    expect(socket.subscriberCount(SOCKET_EVENTS.TOKEN)).toBe(1);

    rerender({ ids: ['inst-cust-1'] });
    rerender({ ids: ['inst-cust-1', 'inst-supp-1'] });

    expect(socket.subscriberCount(SOCKET_EVENTS.TOKEN)).toBe(1);
  });

  it('отписывается при размонтировании и умеет сбрасывать состояние', () => {
    const socket = createSocketStub();
    const { result, unmount } = renderHook(() => useProcessTokens(socket, []));

    act(() => {
      socket.emit(
        SOCKET_EVENTS.TOKEN,
        tokenMessage('inst-cust-1', 'Task_A', TOKEN_STATES.ACTIVE)
      );
    });
    expect(result.current.activeElementsFor('inst-cust-1')).toEqual(['Task_A']);

    act(() => result.current.reset());
    expect(result.current.activeElementsFor('inst-cust-1')).toEqual([]);
    expect(result.current.lastEvent).toBeNull();

    unmount();
    expect(socket.subscriberCount(SOCKET_EVENTS.TOKEN)).toBe(0);
  });

  it('работает без сокета', () => {
    const { result } = renderHook(() => useProcessTokens(null, ['inst-cust-1']));

    expect(result.current.tokensByInstance).toEqual({});
    expect(result.current.tokensFor('inst-cust-1')).toEqual({});
  });
});

describe('useTokenHighlight', () => {
  it('переводит состояния токенов в CSS-классы', () => {
    const tokens = {
      Task_Approve: TOKEN_STATES.ACTIVE,
      Task_Ship: TOKEN_STATES.COMPLETED,
      Task_Timeout: TOKEN_STATES.TIMED_OUT,
      Task_Broken: 'НЕИЗВЕСТНО',
    };
    const { result } = renderHook(() => useTokenHighlight(tokens));

    expect(result.current.tokenMap).toEqual({
      Task_Approve: ['bpmn-sdk-token', 'bpmn-sdk-token--active'],
      Task_Ship: ['bpmn-sdk-token', 'bpmn-sdk-token--completed'],
      Task_Timeout: ['bpmn-sdk-token', 'bpmn-sdk-token--timed-out'],
    });
    expect(result.current.activeElementIds).toEqual(['Task_Approve']);
    expect(result.current.activeElementId).toBe('Task_Approve');
  });

  it('поддерживает устаревший activeElementId и пустые токены', () => {
    const { result } = renderHook(() =>
      useTokenHighlight(undefined, { activeElementId: 'StartEvent_Customer' })
    );

    expect(result.current.tokenMap).toEqual({
      StartEvent_Customer: ['bpmn-sdk-token', 'bpmn-sdk-token--active'],
    });
    expect(result.current.activeElementId).toBe('StartEvent_Customer');
  });
});

describe('useBpmnEngine', () => {
  const createClientStub = () => ({
    sendEvent: jest.fn(async () => ({ ok: true })),
    deploySchema: jest.fn(async () => ({ ok: true })),
  });

  it('подключается при монтировании и отключается при размонтировании', () => {
    const socket = createSocketStub();
    const client = createClientStub();
    const { result, unmount } = renderHook(() =>
      useBpmnEngine({ client, socket })
    );

    expect(socket.connectCount).toBe(1);
    expect(result.current.client).toBe(client);
    expect(result.current.socket).toBe(socket);
    expect(result.current.connected).toBe(false);

    act(() => {
      socket.status = SOCKET_STATUS.OPEN;
      socket.emit(SOCKET_EVENTS.STATUS, SOCKET_STATUS.OPEN);
    });
    expect(result.current.connected).toBe(true);

    unmount();
    expect(socket.disconnectCount).toBe(1);
  });

  it('не подключается при autoConnect=false', () => {
    const socket = createSocketStub();
    const { result } = renderHook(() =>
      useBpmnEngine({ client: createClientStub(), socket, autoConnect: false })
    );

    expect(socket.connectCount).toBe(0);
    expect(result.current.connected).toBe(false);
  });

  it('проксирует вызовы HTTP-клиента', async () => {
    const client = createClientStub();
    const { result } = renderHook(() =>
      useBpmnEngine({ client, socket: createSocketStub(), autoConnect: false })
    );

    await act(async () => {
      await result.current.sendEvent('inst-cust-1', 'StartProcess');
      await result.current.deploySchema('CUSTOMER', '<xml/>');
    });

    expect(client.sendEvent).toHaveBeenCalledWith('inst-cust-1', 'StartProcess');
    expect(client.deploySchema).toHaveBeenCalledWith('CUSTOMER', '<xml/>');
  });

  it('создаёт клиентов по умолчанию из констант SDK', () => {
    const { result } = renderHook(() => useBpmnEngine({ autoConnect: false }));

    expect(result.current.client).toBeInstanceOf(GatewayClient);
    expect(result.current.socket).toBeInstanceOf(StatusSocket);
    expect(result.current.socket.status).toBe(SOCKET_STATUS.CLOSED);
  });

  it('переиспользует одного клиента между ре-рендерами', () => {
    const { result, rerender } = renderHook(() =>
      useBpmnEngine({ autoConnect: false, gatewayUrl: '/api/v1/process' })
    );

    const first = result.current.client;
    rerender();

    expect(result.current.client).toBe(first);
  });
});
