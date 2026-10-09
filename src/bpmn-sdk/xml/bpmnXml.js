/**
 * Утилиты работы с BPMN 2.0 XML.
 *
 * Модуль намеренно не зависит от `bpmn-js`: он нужен потребителям,
 * которые работают со схемой как с текстом (деплой в оркестратор,
 * валидация перед импортом) и в юнит-тестах без DOM-движка.
 *
 * Движок оркестратора адресует узлы по атрибуту `id` элемента
 * (`element_id` в событиях токенов), поэтому все проверки/переименования
 * идентификаторов выполняются на уровне XML.
 */

import { ELEMENT_ID_PATTERN } from '../constants';

/** Суффиксы локальных имён, которые считаются узлами потока управления. */
export const FLOW_ELEMENT_SUFFIXES = ['Task', 'Event', 'Gateway'];

/** Экранирует спецсимволы регулярного выражения. */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @returns {Document|null} XML-документ либо `null`, если DOM недоступен. */
export function parseXml(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') return null;
  if (typeof DOMParser === 'undefined') return null;

  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (!doc || !doc.documentElement) return null;
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch (e) {
    return null;
  }
}

/** Проверяет, что строка является корректным (well-formed) XML. */
export function isValidXml(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') return false;

  // Без DOMParser (чистый Node) ограничиваемся структурной эвристикой.
  if (typeof DOMParser === 'undefined') {
    return /<[A-Za-z_][\w.:-]*[^>]*\/>/.test(xml) || /<[A-Za-z_][\w.:-]*[^>]*>[\s\S]*<\/[A-Za-z_][\w.:-]*>/.test(xml);
  }

  return parseXml(xml) !== null;
}

/** @returns {string} локальное имя узла без namespace-префикса. */
export function getLocalName(node) {
  if (!node) return '';
  if (node.localName) return node.localName;
  const name = node.nodeName || '';
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Проверяет, что тип элемента (например `bpmn:UserTask`) — узел потока. */
export function isFlowElementType(type) {
  const localName = String(type || '').split(':').pop();
  return FLOW_ELEMENT_SUFFIXES.some((suffix) => localName.endsWith(suffix));
}

/** Проверяет, что узел является задачей/событием/шлюзом. */
export function isFlowElement(node) {
  return isFlowElementType(getLocalName(node));
}

/**
 * Список узлов потока управления в порядке документа.
 * @returns {Array<{id: string, name: string, type: string}>}
 */
export function listFlowElements(xml) {
  const doc = parseXml(xml);
  if (!doc) return [];

  return Array.from(doc.getElementsByTagName('*'))
    .filter(isFlowElement)
    .map((node) => ({
      id: node.getAttribute('id') || '',
      name: node.getAttribute('name') || '',
      type: node.nodeName,
    }))
    .filter((element) => element.id !== '');
}

/** Идентификаторы всех процессов, объявленных в схеме. */
export function getProcessIds(xml) {
  const doc = parseXml(xml);
  if (!doc) return [];

  return Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === 'process')
    .map((node) => node.getAttribute('id'))
    .filter(Boolean);
}

/** Уникальные идентификаторы всех элементов схемы. */
export function getElementIds(xml) {
  const doc = parseXml(xml);
  if (!doc) return [];

  const ids = new Set();
  Array.from(doc.getElementsByTagName('*')).forEach((node) => {
    const id = node.getAttribute && node.getAttribute('id');
    if (id) ids.add(id);
  });

  return Array.from(ids);
}

/** Проверяет допустимость идентификатора элемента. */
export function isValidElementId(id) {
  return typeof id === 'string' && ELEMENT_ID_PATTERN.test(id);
}

/** Проверяет, что идентификатор свободен внутри набора идентификаторов. */
export function isIdAvailableAmong(ids, id) {
  if (!isValidElementId(id)) return false;
  return !(ids || []).includes(id);
}

/** Проверяет, что идентификатор ещё не занят в схеме. */
export function isElementIdAvailable(xml, id) {
  return isIdAvailableAmong(getElementIds(xml), id);
}

/**
 * Переименовывает идентификатор элемента во всей схеме.
 *
 * BPMN-ссылки на элемент (`sourceRef`, `targetRef`, `bpmnElement`,
 * `flowNodeRef`, а также текстовое содержимое `<bpmn:incoming>` /
 * `<bpmn:outgoing>`) в XML являются строковыми значениями идентификатора,
 * поэтому переименование обязано затронуть и их.
 *
 * Заменяются только полные XML-токены: совпадение допускается, если слева
 * стоит кавычка, `>` или пробел, а справа — кавычка, `<` или пробел.
 *
 * @param {string} xml исходная схема
 * @param {string} oldId текущий идентификатор
 * @param {string} newId новый идентификатор
 * @returns {string} схема с переименованным элементом
 */
export function renameElementId(xml, oldId, newId) {
  if (!isValidElementId(newId)) {
    throw new Error(`Недопустимый идентификатор элемента: "${newId}"`);
  }
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('Пустая BPMN-схема: переименование невозможно.');
  }
  if (oldId === newId) return xml;
  if (!getElementIds(xml).includes(oldId)) {
    throw new Error(`Элемент с идентификатором "${oldId}" не найден в схеме.`);
  }
  if (getElementIds(xml).includes(newId)) {
    throw new Error(`Идентификатор "${newId}" уже занят в схеме.`);
  }

  // Lookahead (а не lookbehind) — совместим с более широким набором браузеров
  // и не «съедает» закрывающую границу, поэтому соседние токены не ломаются.
  const pattern = new RegExp(`(["'>\\s])${escapeRegExp(oldId)}(?=["'<\\s])`, 'g');

  return xml.replace(pattern, (match, boundary) => boundary + newId);
}
