import {
  DEFAULT_GATEWAY_URL,
  ENGINE_ELEMENTS,
  ENGINE_EVENTS,
} from '../constants';
import {
  GatewayClient,
  createUuid,
  normalizeGatewayUrl,
} from './httpClient';

/** Ответ шлюза-заглушки. */
function createResponse({ ok = true, status = 202, body = {} } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('httpClient: normalizeGatewayUrl', () => {
  it('достраивает сегмент /instances', () => {
    expect(normalizeGatewayUrl('http://localhost:8080/api/v1/process')).toBe(
      'http://localhost:8080/api/v1/process/instances'
    );
  });

  it('не дублирует сегмент /instances и убирает слеши', () => {
    expect(normalizeGatewayUrl('/api/v1/process/instances/')).toBe(
      '/api/v1/process/instances'
    );
  });

  it('подставляет значение по умолчанию для пустой строки', () => {
    expect(normalizeGatewayUrl('')).toBe(DEFAULT_GATEWAY_URL);
    expect(normalizeGatewayUrl(undefined)).toBe(DEFAULT_GATEWAY_URL);
  });
});

describe('httpClient: createUuid', () => {
  it('выдаёт уникальные идентификаторы формата UUID', () => {
    const first = createUuid();
    const second = createUuid();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });
});

describe('httpClient: GatewayClient.sendEvent', () => {
  it('шлёт POST на /instances/:id/events с телом события', async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({ status: 202, body: { status: 'event_accepted' } })
    );
    const client = new GatewayClient('http://gateway:8080/api/v1/process', {
      fetchImpl,
      correlationKeyFactory: () => 'corr-1',
    });

    const result = await client.sendEvent(
      'inst-cust-1',
      'StartProcess',
      'StartEvent_Customer',
      { orderNum: '№101' }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];

    expect(url).toBe(
      'http://gateway:8080/api/v1/process/instances/inst-cust-1/events'
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      event_name: 'StartProcess',
      correlation_key: 'corr-1',
      element_id: 'StartEvent_Customer',
      output_data: { orderNum: '№101' },
    });

    expect(result).toEqual({
      ok: true,
      status: 202,
      data: { status: 'event_accepted' },
    });
  });

  it('подставляет пустые element_id и output_data', async () => {
    const fetchImpl = jest.fn(async () => createResponse());
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    await client.sendEvent('inst-cust-1', 'Noop');

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      event_name: 'Noop',
      correlation_key: expect.any(String),
      element_id: '',
      output_data: {},
    });
  });

  it('возвращает причину отказа из ответа 400', async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({
        ok: false,
        status: 400,
        body: {
          error: 'Validation Failed: Request body does not match expected JSON schema',
          details: [{ field: '/correlation_key', message: 'must be string' }],
        },
      })
    );
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    const result = await client.sendEvent('inst-cust-1', 'StartProcess');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('400');
    expect(result.details).toContain('/correlation_key');
    expect(result.details).toContain('must be string');
  });

  it('показывает причину из не-JSON ответа промежуточного слоя', async () => {
    // Так выглядит 500 от CRA dev-server, когда port-forward на HTTP-шлюз
    // не поднят: тело — HTML-страница, а не JSON.
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('Unexpected token < in JSON at position 0');
      },
      text: async () =>
        '<html><head><title>Error</title></head><body><pre>Error occurred while ' +
        'trying to proxy request /api/v1/process/instances/inst-deploy-customer/events ' +
        'to http://localhost:8080 (ECONNREFUSED)</pre></body></html>',
    }));
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    const result = await client.sendEvent('inst-deploy-customer', 'DeploySchema');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe('Оркестратор вернул ошибку (500)');
    expect(result.details).toContain('ECONNREFUSED');
  });

  it('показывает строковые details из JSON-ответа шлюза', async () => {
    const fetchImpl = jest.fn(async () =>
      createResponse({
        ok: false,
        status: 503,
        body: {
          error: 'NATS JetStream is not connected',
          details: 'Шлюз не подключён к NATS: проверьте стрим INBOUND_EVENTS.',
        },
      })
    );
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    const result = await client.sendEvent('inst-cust-1', 'StartProcess');

    expect(result.ok).toBe(false);
    expect(result.details).toContain('NATS JetStream is not connected');
    expect(result.details).toContain('INBOUND_EVENTS');
  });

  it('переживает ответ без JSON', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('bad json');
      },
    }));
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    const result = await client.sendEvent('inst-cust-1', 'StartProcess');

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'Оркестратор вернул ошибку (502)',
      details: null,
    });
  });

  it('сообщает об ошибке сети', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    const result = await client.sendEvent('inst-cust-1', 'StartProcess');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Ошибка сети');
  });

  it('отличает таймаут от прочих сетевых ошибок', async () => {
    const fetchImpl = jest.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const client = new GatewayClient('/api/v1/process/instances', {
      fetchImpl,
      timeoutMs: 1234,
    });

    const result = await client.sendEvent('inst-cust-1', 'StartProcess');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('1234');
  });

  it('не отправляет запрос без идентификатора или имени события', async () => {
    const fetchImpl = jest.fn();
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    const noInstance = await client.sendEvent('', 'StartProcess');
    const noEvent = await client.sendEvent('inst-cust-1', '');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(noInstance.ok).toBe(false);
    expect(noEvent.ok).toBe(false);
  });

  it('деплоит схему через служебный экземпляр организации', async () => {
    const fetchImpl = jest.fn(async () => createResponse());
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    await client.deploySchema('SUPPLIER', '<xml/>');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/instances/inst-deploy-supplier/events');

    const body = JSON.parse(init.body);
    expect(body.event_name).toBe(ENGINE_EVENTS.DEPLOY_SCHEMA);
    expect(body.element_id).toBe(ENGINE_ELEMENTS.PROCESS_DEPLOYMENT);
    expect(body.output_data).toEqual({ bpmn_xml: '<xml/>', org_type: 'SUPPLIER' });
  });

  it('экранирует идентификатор экземпляра в URL', async () => {
    const fetchImpl = jest.fn(async () => createResponse());
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    await client.sendEvent('inst cust/1', 'Noop');

    expect(fetchImpl.mock.calls[0][0]).toContain('/instances/inst%20cust%2F1/events');
  });

  /**
   * Роль сессии (M6): шлюз проверяет её на каждом событии, поэтому клиент
   * обязан отправлять её и заголовком (её читает шлюз), и полем тела (его
   * читает движок, если событие ушло мимо шлюза).
   */
  it('передаёт роль сессии заголовком и полем тела (M6)', async () => {
    const fetchImpl = jest.fn(async () => createResponse());
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    client.actor = 'SALES';
    await client.sendEvent('inst-cust-1', 'StartProcess');

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['X-Actor-Role']).toBe('SALES');
    expect(JSON.parse(init.body).actor).toBe('SALES');
  });

  it('без роли запрос остаётся прежним', async () => {
    const fetchImpl = jest.fn(async () => createResponse());
    const client = new GatewayClient('/api/v1/process/instances', { fetchImpl });

    await client.sendEvent('inst-cust-1', 'StartProcess');

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).not.toHaveProperty('actor');
  });
});
