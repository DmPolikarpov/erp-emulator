/**
 * Клиент API проектов (M6).
 *
 * Тесты держат контракт с движком (`bpmn-engine/src/projects.rs`) и шлюзом
 * (`bpmn-gateways/http-cluster`): camelCase, коды ответов, роль в заголовке и
 * разбор ошибок. Сеть не нужна — `fetch` подменяется на каждом тесте.
 */

import {
  PROJECTS_API_BASE_URL,
  ProjectsClient,
  formatXmlSize,
  serverProjectLabel,
  toProjectRecord,
  versionLabel,
} from './projectsApi';

/** Сводка в том виде, в каком её отдаёт `GET /api/v1/projects`. */
const SERVER_SUMMARY = {
  projectId: 'project-dairy',
  name: 'Молочный завод',
  version: 3,
  xmlBytes: 91234,
  updatedBy: 'DIRECTOR',
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-29T10:15:00Z',
};

/** Схема в том виде, в каком её отдаёт `GET /api/v1/projects/:id`. */
const SERVER_PROJECT = {
  projectId: 'project-dairy',
  name: 'Молочный завод',
  version: 3,
  bpmnXml: '<bpmn:definitions><bpmn:process id="Process_Dairy"/></bpmn:definitions>',
  updatedBy: 'DIRECTOR',
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-29T10:15:00Z',
};

/** Ответ шлюза на успешный запрос. */
const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

describe('projectsApi: подписи и запись кэша', () => {
  it('подписывает версию и размер схемы', () => {
    expect(versionLabel(3)).toBe('v3');
    expect(versionLabel(0)).toBe('—');
    expect(versionLabel(undefined)).toBe('—');

    expect(formatXmlSize(512)).toBe('512 Б');
    expect(formatXmlSize(91234)).toBe('89 КБ');
    expect(formatXmlSize(2.5 * 1024 * 1024)).toBe('2,5 МБ');
    expect(formatXmlSize(0)).toBe('—');
  });

  it('собирает подпись серверного проекта', () => {
    const label = serverProjectLabel(SERVER_SUMMARY);

    expect(label).toContain('v3');
    expect(label).toContain('DIRECTOR');
    expect(label).toContain('89 КБ');
    expect(serverProjectLabel(null)).toBe('');
  });

  it('превращает серверную схему в запись кэша проекта', () => {
    const record = toProjectRecord(SERVER_PROJECT);

    expect(record).toEqual({
      id: 'project-dairy',
      name: 'Молочный завод',
      xml: SERVER_PROJECT.bpmnXml,
      createdAt: SERVER_PROJECT.createdAt,
      updatedAt: SERVER_PROJECT.updatedAt,
    });

    // Без схемы или ключа запись кэша не имеет смысла.
    expect(toProjectRecord({ ...SERVER_PROJECT, bpmnXml: '   ' })).toBeNull();
    expect(toProjectRecord({ ...SERVER_PROJECT, projectId: '' })).toBeNull();
  });
});

describe('projectsApi: HTTP-клиент', () => {
  it('по умолчанию ходит в REST-путь шлюза', () => {
    expect(PROJECTS_API_BASE_URL).toBe('/api/v1/projects');
  });

  it('читает список проектов', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ projects: [SERVER_SUMMARY] }));
    const client = new ProjectsClient('http://gateway/api/v1/projects/', { fetchImpl });

    const result = await client.listProjects();

    expect(result.ok).toBe(true);
    expect(result.projects).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://gateway/api/v1/projects',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('берёт последнюю версию и версию из истории', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ project: SERVER_PROJECT }));
    const client = new ProjectsClient('', { fetchImpl });

    expect((await client.getProject('project-dairy')).project.version).toBe(3);

    await client.getProject('project-dairy', 1);

    expect(fetchImpl.mock.calls[1][0]).toBe(
      '/api/v1/projects/project-dairy?version=1'
    );
  });

  it('деплоит проект PUT-ом с ролью сессии в заголовке', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ project: SERVER_PROJECT }));
    const client = new ProjectsClient('', { fetchImpl });

    const result = await client.deployProject({
      projectId: 'project-dairy',
      name: 'Молочный завод',
      bpmnXml: SERVER_PROJECT.bpmnXml,
      actor: 'DIRECTOR',
    });

    expect(result.ok).toBe(true);
    expect(result.project.version).toBe(3);

    const [url, options] = fetchImpl.mock.calls[0];

    expect(url).toBe('/api/v1/projects/project-dairy');
    expect(options.method).toBe('PUT');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Actor-Role': 'DIRECTOR',
    });
    expect(JSON.parse(options.body)).toEqual({
      name: 'Молочный завод',
      bpmnXml: SERVER_PROJECT.bpmnXml,
    });
  });

  it('читает историю версий', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        versions: [
          {
            version: 3,
            xmlBytes: 91234,
            updatedBy: 'DIRECTOR',
            createdAt: '2026-10-29T10:15:00Z',
          },
          {
            version: 2,
            xmlBytes: 90100,
            updatedBy: 'SALES',
            createdAt: '2026-10-28T09:00:00Z',
          },
        ],
      })
    );
    const client = new ProjectsClient('', { fetchImpl });

    const result = await client.listVersions('project-dairy');

    expect(result.ok).toBe(true);
    expect(result.versions.map((item) => item.version)).toEqual([3, 2]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      '/api/v1/projects/project-dairy/versions'
    );
  });

  it('разбирает 400 с ошибками полей', async () => {
    const client = new ProjectsClient('', {
      fetchImpl: jest.fn(async () =>
        jsonResponse(
          {
            error: 'Проект не прошёл валидацию',
            details: [{ field: 'bpmnXml', message: 'нужна BPMN-схема' }],
          },
          400
        )
      ),
    });

    const result = await client.deployProject({
      projectId: 'project-dairy',
      bpmnXml: 'не схема',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.details).toBe('bpmnXml: нужна BPMN-схема');
  });

  it('не бросает исключений, когда API недоступен', async () => {
    const offline = new ProjectsClient('', {
      fetchImpl: jest.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });

    expect(await offline.listProjects()).toEqual({
      ok: false,
      error: 'API проектов недоступен.',
    });

    const withoutFetch = new ProjectsClient('', { fetchImpl: null });
    withoutFetch.fetchImpl = null;

    expect(await withoutFetch.listProjects()).toEqual({
      ok: false,
      error: 'fetch недоступен: проект останется в браузере.',
    });
  });
});

