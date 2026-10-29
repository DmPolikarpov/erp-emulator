/**
 * Клиент API проектов (M6).
 *
 * Проект — BPMN-схема с процессами сторон; до этой части она жила только в
 * `localStorage` браузера, и вторая сессия видела демо-схему SDK. Теперь схема
 * хранится в БД движка: `GET /api/v1/projects` отдаёт список, `PUT` —
 * деплой с новой версией, `GET …/versions` — историю.
 *
 * REST-путь обслуживает HTTP-шлюз (`bpmn-gateways/http-cluster/index.js`),
 * который перекладывает запрос в NATS `mes.in.v1.api.projects`.
 *
 * Все методы возвращают `{ok, ...}` и не бросают исключений: кабинет работает
 * и без API — тогда проект остаётся локальным (демо-режим).
 *
 * @see bpmn-engine/src/projects.rs — модель, валидация и коды ошибок
 */

/** Базовый URL API проектов; в dev он уходит в CRA-прокси на шлюз. */
export const PROJECTS_API_BASE_URL =
  process.env.REACT_APP_PROJECTS_API_URL || '/api/v1/projects';

/** Таймаут запроса: схема завода ~90 КБ, но NATS отвечает сразу. */
export const PROJECTS_TIMEOUT_MS = 10000;

/** Подпись версии проекта: `v3`; неизвестная версия — `—`. */
export function versionLabel(version) {
  return Number.isInteger(version) && version > 0 ? `v${version}` : '—';
}

/** Размер схемы для карточки: `91 КБ`, `1,2 МБ`. */
export function formatXmlSize(bytes) {
  const size = Number(bytes);

  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return `${size} Б`;

  const kilobytes = size / 1024;

  return kilobytes < 1024
    ? `${Math.round(kilobytes)} КБ`
    : `${(kilobytes / 1024).toFixed(1).replace('.', ',')} МБ`;
}

/** Дата деплоя: ISO → `29.10.2026, 13:15` (локальное время браузера). */
export function formatDeployedAt(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Подпись состояния проекта на сервере.
 *
 * `null` — проект ещё не деплоился из этой сессии, сервер о нём не знает.
 */
export function serverProjectLabel(summary) {
  if (!summary || !summary.projectId) return '';

  const parts = [versionLabel(summary.version)];

  if (summary.updatedBy) parts.push(summary.updatedBy);
  if (summary.xmlBytes) parts.push(formatXmlSize(summary.xmlBytes));

  const deployedAt = formatDeployedAt(summary.updatedAt);
  if (deployedAt) parts.push(deployedAt);

  return parts.join(' · ');
}

/**
 * Сводка/схема сервера → запись кэша проекта (`projectStore.createProject`).
 *
 * Ключ (`id`) — тот же `projectId`, поэтому локальная копия и серверная схема
 * не расходятся после F5.
 */
export function toProjectRecord(project) {
  if (!project || !project.projectId) return null;

  const xml = typeof project.bpmnXml === 'string' ? project.bpmnXml : '';

  if (xml.trim() === '') return null;

  return {
    id: project.projectId,
    name: project.name || 'Проект',
    xml,
    createdAt: project.createdAt || '',
    updatedAt: project.updatedAt || '',
  };
}


/** Достаёт причину отказа из ответа шлюза (JSON или текст). */
async function readFailure(response) {
  try {
    const payload = await response.json();

    if (Array.isArray(payload.details) && payload.details.length > 0) {
      return payload.details
        .map((detail) => `${detail.field || 'body'}: ${detail.message}`)
        .join('; ');
    }

    if (typeof payload.details === 'string' && payload.details.trim() !== '') {
      return `${payload.error || 'Ошибка шлюза'}: ${payload.details.trim()}`;
    }

    return payload.error || null;
  } catch (error) {
    return null;
  }
}

/**
 * Клиент API проектов.
 *
 * `fetchImpl` и `timeoutMs` подменяются в тестах; в браузере — глобальный
 * `fetch` и `PROJECTS_TIMEOUT_MS`.
 */
export class ProjectsClient {
  constructor(baseUrl = PROJECTS_API_BASE_URL, options = {}) {
    this.baseUrl = String(baseUrl || PROJECTS_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : PROJECTS_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ||
      (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  /** Общий вызов: JSON-тело, роль в заголовке, таймаут и разбор отказа. */
  async request(path, { method = 'GET', body, actor } = {}) {
    if (!this.fetchImpl) {
      return { ok: false, error: 'fetch недоступен: проект останется в браузере.' };
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    const headers = {};

    if (body) headers['Content-Type'] = 'application/json';
    // Роль сессии — тот же заголовок, что у событий (M6): по нему история
    // версий знает автора деплоя.
    if (actor) headers['X-Actor-Role'] = actor;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: `API проектов вернул ошибку (${response.status})`,
          details: await readFailure(response),
        };
      }

      const data = await response.json().catch(() => ({}));
      return { ok: true, status: response.status, data };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return {
          ok: false,
          error: `API проектов не ответил за ${this.timeoutMs} мс.`,
        };
      }

      return { ok: false, error: 'API проектов недоступен.' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** `GET /api/v1/projects` → `{ok, projects}`. */
  async listProjects() {
    const result = await this.request('');
    if (!result.ok) return result;

    return { ok: true, projects: result.data.projects || [] };
  }

  /** `GET /api/v1/projects/:projectId[?version=N]` → `{ok, project}`. */
  async getProject(projectId, version) {
    if (!projectId) return { ok: false, error: 'Не указан проект.' };

    const query = Number.isInteger(version) && version > 0 ? `?version=${version}` : '';
    const result = await this.request(`/${encodeURIComponent(projectId)}${query}`);

    if (!result.ok) return result;

    return { ok: true, project: result.data.project || null };
  }

  /** `PUT /api/v1/projects/:projectId` → `{ok, project}`; версия растёт. */
  async deployProject({ projectId, name, bpmnXml, actor } = {}) {
    if (!projectId || !bpmnXml) {
      return { ok: false, error: 'Не указан проект или схема.' };
    }

    const result = await this.request(`/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      body: { name, bpmnXml },
      actor,
    });

    if (!result.ok) return result;

    return { ok: true, project: result.data.project || null };
  }

  /** `GET /api/v1/projects/:projectId/versions` → `{ok, versions}`. */
  async listVersions(projectId) {
    if (!projectId) return { ok: false, error: 'Не указан проект.' };

    const result = await this.request(`/${encodeURIComponent(projectId)}/versions`);

    if (!result.ok) return result;

    return { ok: true, versions: result.data.versions || [] };
  }
}

/** Клиент по умолчанию: приложение использует его без настройки. */
export const projectsClient = new ProjectsClient();

