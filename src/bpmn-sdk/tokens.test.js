import {
  applyTokenUpdate,
  collectActiveElementIds,
  isDeployInstanceId,
  isKnownTokenState,
  parseTokenMessage,
  resolveTokenMap,
} from './tokens';

describe('tokens: isKnownTokenState', () => {
  it('признаёт состояния движка', () => {
    ['ACTIVE', 'COMPLETED', 'FAILED', 'TIMED_OUT'].forEach((state) => {
      expect(isKnownTokenState(state)).toBe(true);
    });
  });

  it('отклоняет неизвестные состояния', () => {
    expect(isKnownTokenState('PENDING')).toBe(false);
    expect(isKnownTokenState(undefined)).toBe(false);
    expect(isKnownTokenState('')).toBe(false);
  });
});

describe('tokens: isDeployInstanceId', () => {
  it('распознаёт служебный экземпляр деплоя', () => {
    expect(isDeployInstanceId('inst-deploy-customer')).toBe(true);
    expect(isDeployInstanceId('inst-cust-1')).toBe(false);
    expect(isDeployInstanceId(undefined)).toBe(false);
  });
});

describe('tokens: resolveTokenMap', () => {
  it('сопоставляет состояния токенов CSS-классам', () => {
    expect(
      resolveTokenMap(
        {
          Task_1: 'ACTIVE',
          Task_2: 'COMPLETED',
          Task_3: 'FAILED',
          Task_4: 'TIMED_OUT',
        },
        null
      )
    ).toEqual({
      Task_1: 'bpmn-sdk-token--active',
      Task_2: 'bpmn-sdk-token--completed',
      Task_3: 'bpmn-sdk-token--failed',
      Task_4: 'bpmn-sdk-token--timed-out',
    });
  });

  it('игнорирует неизвестные состояния и пустые идентификаторы', () => {
    expect(
      resolveTokenMap({ Task_1: 'PENDING', '': 'ACTIVE', Task_2: undefined }, null)
    ).toEqual({});
  });

  it('подсвечивает legacy-проп activeElementId как ACTIVE', () => {
    expect(resolveTokenMap({}, 'Task_Legacy')).toEqual({
      Task_Legacy: 'bpmn-sdk-token--active',
    });
  });

  it('не перекрывает явное состояние токена legacy-пропом', () => {
    expect(resolveTokenMap({ Task_1: 'COMPLETED' }, 'Task_1')).toEqual({
      Task_1: 'bpmn-sdk-token--completed',
    });
  });

  it('возвращает пустую карту без входных данных', () => {
    expect(resolveTokenMap(undefined, null)).toEqual({});
    expect(resolveTokenMap(null, '')).toEqual({});
    expect(resolveTokenMap('не объект', null)).toEqual({});
  });
});

describe('tokens: applyTokenUpdate', () => {
  it('добавляет новое состояние, не мутируя исходную карту', () => {
    const initial = { Task_1: 'ACTIVE' };
    const next = applyTokenUpdate(initial, 'Task_2', 'COMPLETED');

    expect(next).toEqual({ Task_1: 'ACTIVE', Task_2: 'COMPLETED' });
    expect(initial).toEqual({ Task_1: 'ACTIVE' });
  });

  it('перезаписывает состояние существующего токена', () => {
    expect(applyTokenUpdate({ Task_1: 'ACTIVE' }, 'Task_1', 'COMPLETED')).toEqual({
      Task_1: 'COMPLETED',
    });
  });

  it('снимает подсветку при неизвестном состоянии', () => {
    expect(applyTokenUpdate({ Task_1: 'ACTIVE' }, 'Task_1', 'PENDING')).toEqual({});
  });

  it('игнорирует обновление без идентификатора элемента', () => {
    expect(applyTokenUpdate({ Task_1: 'ACTIVE' }, '', 'ACTIVE')).toEqual({
      Task_1: 'ACTIVE',
    });
    expect(applyTokenUpdate(undefined, null, 'ACTIVE')).toEqual({});
  });
});

describe('tokens: collectActiveElementIds', () => {
  it('возвращает только активные узлы', () => {
    expect(
      collectActiveElementIds({
        Task_1: 'ACTIVE',
        Task_2: 'COMPLETED',
        Task_3: 'ACTIVE',
      })
    ).toEqual(['Task_1', 'Task_3']);
  });

  it('возвращает пустой массив без токенов', () => {
    expect(collectActiveElementIds(undefined)).toEqual([]);
    expect(collectActiveElementIds({})).toEqual([]);
  });
});

describe('tokens: parseTokenMessage', () => {
  const validMessage = {
    event: 'token_updated',
    instance_id: 'inst-cust-1',
    element_id: 'Task_Approve',
    state: 'ACTIVE',
    timestamp: '2026-01-01T00:00:00Z',
    payload: { order: 'A-1' },
  };

  it('разбирает валидное сообщение из строки', () => {
    expect(parseTokenMessage(JSON.stringify(validMessage))).toEqual({
      instanceId: 'inst-cust-1',
      elementId: 'Task_Approve',
      state: 'ACTIVE',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { order: 'A-1' },
    });
  });

  it('принимает уже разобранный объект', () => {
    expect(parseTokenMessage(validMessage).elementId).toBe('Task_Approve');
  });

  it('подставляет null вместо отсутствующих timestamp/payload', () => {
    expect(
      parseTokenMessage({
        event: 'token_updated',
        instance_id: 'inst-cust-1',
        element_id: 'Task_Approve',
        state: 'COMPLETED',
      })
    ).toEqual({
      instanceId: 'inst-cust-1',
      elementId: 'Task_Approve',
      state: 'COMPLETED',
      timestamp: null,
      payload: null,
    });
  });

  it('отбрасывает аудит-события движка', () => {
    expect(
      parseTokenMessage({
        process_id: 'Process_Demo',
        event_type: 'AUDIT',
        payload: {},
      })
    ).toBeNull();
  });

  it('отбрасывает сообщения без обязательных полей', () => {
    expect(parseTokenMessage({ event: 'token_updated' })).toBeNull();
    expect(
      parseTokenMessage({ event: 'token_updated', instance_id: 'i', element_id: 'e' })
    ).toBeNull();
    expect(
      parseTokenMessage({
        event: 'token_updated',
        instance_id: 'i',
        element_id: 'e',
        state: 'NOPE',
      })
    ).toBeNull();
    expect(
      parseTokenMessage({ event: 'token_updated', instance_id: 'i', state: 'ACTIVE' })
    ).toBeNull();
  });

  it('не падает на некорректном JSON и не-объектах', () => {
    expect(parseTokenMessage('{ не json')).toBeNull();
    expect(parseTokenMessage('')).toBeNull();
    expect(parseTokenMessage(null)).toBeNull();
    expect(parseTokenMessage(undefined)).toBeNull();
    expect(parseTokenMessage(42)).toBeNull();
  });
});
