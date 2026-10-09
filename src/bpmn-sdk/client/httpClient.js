/**
 * HTTP-клиент шлюза оркестратора.
 *
 * @see bpmn-gateways/http-cluster/index.js — контракт эндпоинта
 */

import {
  DEFAULT_GATEWAY_URL,
  ENGINE_ELEMENTS,
  ENGINE_EVENTS,
  EVENTS_SEGMENT,
  EVENTS_SUFFIX,
  REQUEST_TIMEOUT_MS,
} from '../constants';
import { deployInstanceId } from '../tokens';

/** Генерирует UUID v4 (для `correlation_key` и локальных идентификаторов). */
export function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Приводит базовый URL шлюза к виду `.../instances`. */
export function normalizeGatewayUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_GATEWAY_URL;

  return trimmed.endsWith(`/${EVENTS_SEGMENT}`)
    ? trimmed
    : `${trimmed}/${EVENTS_SEGMENT}`;
}

/** Достаёт из ответа шлюза человекочитаемую причину отказа. */
async function readErrorDetails(response) {
  try {
    const payload = await response.json();

    if (Array.isArray(payload.details) && payload.details.length > 0) {
      const fields = payload.details
        .map((detail) => `${detail.field || 'body'}: ${detail.message}`)
        .join('; ');
      return `${payload.error || 'Ошибка валидации'} (${fields})`;
    }

    return payload.error || null;
  } catch (e) {
    return null;
  }
}

/**
 * Клиент HTTP-шлюза: `POST ${baseUrl}/:instanceId/events`.
 *
 * Все методы возвращают результат в виде `{ok, ...}` и никогда не бросают
 * исключений — вызывающий код работает с флагом `ok` и текстом `error`.
 */
export class GatewayClient {
  /**
   * @param {string} [baseUrl] база вида `http://host:8080/api/v1/process/instances`.
   * @param {Object} [options]
   * @param {Function} [options.fetchImpl] подмена `fetch` (для тестов).
   * @param {number} [options.timeoutMs] таймаут запроса, мс.
   * @param {Function} [options.correlationKeyFactory] генератор `correlation_key`.
   */
  constructor(baseUrl = DEFAULT_GATEWAY_URL, options = {}) {
    this.baseUrl = normalizeGatewayUrl(baseUrl);
    this.timeoutMs =
      typeof options.timeoutMs === 'number' ? options.timeoutMs : REQUEST_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ||
      (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.correlationKeyFactory = options.correlationKeyFactory || createUuid;
  }

  /** URL приёма событий конкретного экземпляра процесса. */
  eventsUrl(instanceId) {
    return `${this.baseUrl}/${encodeURIComponent(instanceId)}/${EVENTS_SUFFIX}`;
  }

  /**
   * Отправляет событие в экземпляр процесса.
   *
   * @param {string} instanceId идентификатор экземпляра (`inst-cust-*`).
   * @param {string} eventName имя события (`StartProcess`, `SendToSupplier`, ...).
   * @param {string} [elementId] `element_id` шага, который породил событие.
   * @param {Object} [outputData] полезная нагрузка события.
   * @returns {Promise<{ok: boolean, status?: number, data?: Object,
   *                    error?: string, details?: (string|null)}>}
   */
  async sendEvent(instanceId, eventName, elementId = '', outputData = {}) {
    if (!instanceId) {
      return { ok: false, error: 'Не указан идентификатор экземпляра процесса.' };
    }
    if (!eventName) {
      return { ok: false, error: 'Не указано имя события.' };
    }
    if (!this.fetchImpl) {
      return { ok: false, error: 'fetch недоступен в текущем окружении.' };
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;

    try {
      const response = await this.fetchImpl(this.eventsUrl(instanceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: eventName,
          correlation_key: this.correlationKeyFactory(),
          element_id: elementId || '',
          output_data: outputData || {},
        }),
        signal: controller ? controller.signal : undefined,
      });

      if (!response.ok) {
        const details = await readErrorDetails(response);
        return {
          ok: false,
          status: response.status,
          error: `Оркестратор вернул ошибку (${response.status})`,
          details,
        };
      }

      const data = await response.json().catch(() => ({}));
      return { ok: true, status: response.status, data };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return {
          ok: false,
          error: `Шлюз не ответил за ${this.timeoutMs} мс.`,
        };
      }

      return {
        ok: false,
        error: 'Ошибка сети. Не удалось связаться с оркестратором.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Публикует (деплоит) BPMN-схему в кластер через служебный экземпляр
   * `inst-deploy-<org>` — движок сохраняет определение процесса.
   */
  async deploySchema(orgType, bpmnXml) {
    return this.sendEvent(
      deployInstanceId(orgType),
      ENGINE_EVENTS.DEPLOY_SCHEMA,
      ENGINE_ELEMENTS.PROCESS_DEPLOYMENT,
      { bpmn_xml: bpmnXml, org_type: orgType }
    );
  }
}
