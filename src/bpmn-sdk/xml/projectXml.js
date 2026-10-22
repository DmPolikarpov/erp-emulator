/**
 * Проект как одна BPMN-схема из нескольких процессов.
 *
 * Демо-клиент «Межорганизационная ERP» — это не одна схема, а проект: процесс
 * Заказчика, процесс Поставщика и общий список ролей. Хранить их по-отдельности
 * неудобно: роли, кнопки и триггеры ссылаются друг на друга (`startsProcess`,
 * `counterpartEvent`, `trg:processTrigger`), а кабинету нужны оба процесса
 * сразу — иначе переход «заказ → отгрузка» не нарисовать.
 *
 * Поэтому проект — один XML с `bpmn:collaboration` и несколькими
 * `bpmn:process`. Оркестратор при этом остаётся однопроцессным: он читает
 * **первый** `bpmn:process` документа (`bpm_engine_bpmn/src/parser.rs`), поэтому
 * деплой, старт и метрики работают с нарезкой процесса
 * (`extractProcessXml`), а редактор и просмотрщик — с проектом целиком.
 *
 * Модуль не зависит от DOM: это чистая работа со строками, поэтому он одинаково
 * работает в браузере, в Node и в юнит-тестах без `jsdom`. Произвольные чужие
 * namespace-ы (`camunda:*` и подобные) переносятся как есть, но типы этих
 * пакетов в редакторе не зарегистрированы — холст сохранит только то, что
 * понимает `bpmn-moddle`.
 */

import { ACTION_NAMESPACE, ACTION_NAMESPACE_PREFIX } from './actionModdle';
import { ROLE_NAMESPACE, ROLE_NAMESPACE_PREFIX } from './rolesModdle';
import { TRIGGER_NAMESPACE, TRIGGER_NAMESPACE_PREFIX } from './triggerModdle';

/** Объявление XML-документа: проект и нарезки начинаются одинаково. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Идентификатор шапки объединённого проекта по умолчанию. */
export const PROJECT_DEFINITIONS_ID = 'Definitions_Project';

/** Идентификатор кооперации проекта (`bpmn:collaboration/@id`). */
export const PROJECT_COLLABORATION_ID = 'Collaboration_Project';

/** Идентификатор плоскости проекта (`bpmndi:BPMNPlane/@id`). */
export const PROJECT_PLANE_ID = 'BPMNPlane_Project';

/** Шаг между дорожками процессов по вертикали (px). */
export const PROJECT_ROW_OFFSET = 240;

/** Namespace-ы, которые проект объявляет всегда. */
const BASE_NAMESPACES = [
  ['bpmn', 'http://www.omg.org/spec/BPMN/20100524/MODEL'],
  ['bpmndi', 'http://www.omg.org/spec/BPMN/20100524/DI'],
  ['dc', 'http://www.omg.org/spec/DD/20100524/DC'],
  ['di', 'http://www.omg.org/spec/DD/20100524/DI'],
  [ACTION_NAMESPACE_PREFIX, ACTION_NAMESPACE],
  [TRIGGER_NAMESPACE_PREFIX, TRIGGER_NAMESPACE],
  [ROLE_NAMESPACE_PREFIX, ROLE_NAMESPACE],
];

/** Блок процесса целиком (`<bpmn:process ...>...</bpmn:process>`). */
const PROCESS_BLOCK_PATTERN = /<bpmn:process\b[^>]*(?:\/>|>[\s\S]*?<\/bpmn:process>)/g;

/** Узел диаграммы: фигура или связь вместе с координатами. */
const DI_NODE_PATTERN =
  /<bpmndi:BPMNShape\b[^>]*(?:\/>|>[\s\S]*?<\/bpmndi:BPMNShape>)|<bpmndi:BPMNEdge\b[^>]*(?:\/>|>[\s\S]*?<\/bpmndi:BPMNEdge>)/g;

/** Все `id` в тексте (атрибут `id="..."`). */
const ID_ATTRIBUTE_PATTERN = /\bid\s*=\s*"([^"]*)"/g;

/** Координата `y` в узле диаграммы. */
const Y_ATTRIBUTE_PATTERN = /\by="(-?[\d.]+)"/g;

/** Значение атрибута в тексте тега. */
function attributeOf(tag, name) {
  const match = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"').exec(tag || '');
  return match ? match[1] : '';
}

/** Все `xmlns:prefix="uri"` из шапки `<bpmn:definitions ...>`. */
function collectNamespaces(xml) {
  const namespaces = [];
  const pattern = /xmlns:([\w.-]+)\s*=\s*"([^"]*)"/g;
  const text = String(xml || '');
  let match = pattern.exec(text);

  while (match) {
    namespaces.push([match[1], match[2]]);
    match = pattern.exec(text);
  }

  return namespaces;
}

/** Объявления namespace-ов: базовые плюс чужие из исходных схем (без дублей). */
function namespaceDeclarations(sources = []) {
  const seen = new Set();
  const pairs = [];

  const push = (prefix, uri) => {
    if (!prefix || !uri || seen.has(prefix)) return;
    seen.add(prefix);
    pairs.push([prefix, uri]);
  };

  BASE_NAMESPACES.forEach(([prefix, uri]) => push(prefix, uri));
  sources.forEach((xml) => collectNamespaces(xml).forEach(([prefix, uri]) => push(prefix, uri)));

  return pairs.map(([prefix, uri]) => 'xmlns:' + prefix + '="' + uri + '"').join('\n                  ');
}

/** Блок процесса по его идентификатору (`''`, если такого нет). */
function processBlockOf(xml, processId) {
  const blocks = String(xml || '').match(PROCESS_BLOCK_PATTERN) || [];

  if (!processId) return blocks[0] || '';

  return blocks.find((block) => attributeOf(block, 'id') === processId) || '';
}

/** Идентификаторы процессов в порядке документа. */
function processIdsOf(xml) {
  return (String(xml || '').match(PROCESS_BLOCK_PATTERN) || []).map((block) =>
    attributeOf(block, 'id')
  );
}

/** Все `id` внутри блока: сам процесс и его элементы. */
function idsOf(block) {
  const ids = new Set();
  const text = String(block || '');
  ID_ATTRIBUTE_PATTERN.lastIndex = 0;
  let match = ID_ATTRIBUTE_PATTERN.exec(text);

  while (match) {
    if (match[1]) ids.add(match[1]);
    match = ID_ATTRIBUTE_PATTERN.exec(text);
  }

  return ids;
}

/** Узлы диаграммы (фигуры и связи) документа в порядке появления. */
function diNodesOf(xml) {
  return String(xml || '').match(DI_NODE_PATTERN) || [];
}

/** Узел диаграммы относится к одному из перечисленных элементов. */
function diNodeBelongsTo(node, ids) {
  return ids.has(attributeOf(node, 'bpmnElement'));
}

/** Сдвиг координаты `y` в тегах указанного типа. */
function shiftTagY(node, tag, offset) {
  if (!offset) return node;

  const pattern = new RegExp('(<' + tag + '\\b[^>]*\\by=")(-?[\\d.]+)(")', 'g');

  return String(node).replace(pattern, (all, before, value, after) => {
    const shifted = Math.round((Number(value) + offset) * 100) / 100;
    return before + shifted + after;
  });
}

/** Сдвиг координат по вертикали: `dc:Bounds` и `di:waypoint`. */
function shiftDiY(node, offset) {
  return shiftTagY(shiftTagY(node, 'dc:Bounds', offset), 'di:waypoint', offset);
}

/** Габариты фигур: `{right, bottom}` (0, если координат нет). */
function boundsOf(nodes) {
  const pattern = /\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/g;
  let right = 0;
  let bottom = 0;

  nodes.forEach((node) => {
    pattern.lastIndex = 0;
    let match = pattern.exec(node);

    while (match) {
      const nodeRight = Number(match[1]) + Number(match[3]);
      const nodeBottom = Number(match[2]) + Number(match[4]);
      if (Number.isFinite(nodeRight) && nodeRight > right) right = nodeRight;
      if (Number.isFinite(nodeBottom) && nodeBottom > bottom) bottom = nodeBottom;
      match = pattern.exec(node);
    }
  });

  return { right, bottom };
}

/** Минимальная координата `y` среди узлов диаграммы (`null`, если её нет). */
function minYOf(nodes) {
  let min = null;

  nodes.forEach((node) => {
    Y_ATTRIBUTE_PATTERN.lastIndex = 0;
    let match = Y_ATTRIBUTE_PATTERN.exec(node);

    while (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && (min === null || value < min)) min = value;
      match = Y_ATTRIBUTE_PATTERN.exec(node);
    }
  });

  return min;
}

/** Текст шапки `<bpmn:definitions ...>` (атрибуты, без самого тега). */
function definitionsAttributes(xml) {
  const match = /<bpmn:definitions\b([^>]*)>/.exec(String(xml || ''));
  return match ? match[1].trim() : '';
}

/**
 * Собирает проект из готовых схем процессов.
 *
 * Координаты DI исходных схем сохраняются, но каждая следующая дорожка
 * сдвигается вниз на `rowOffset`: иначе процессы нарисовались бы друг поверх
 * друга (у обеих демо-схем фигуры начинаются с `y=78`).
 *
 * @param {Array<{xml: string, processId?: string, participantName?: string}>} processes
 *   схемы процессов в порядке дорожек; `participantName` — подпись дорожки
 *   (название организации), по умолчанию `bpmn:process/@name`.
 * @param {Object} [options]
 * @param {string} [options.id=PROJECT_DEFINITIONS_ID] id шапки проекта.
 * @param {string} [options.name] имя проекта (`bpmn:definitions/@name`).
 * @param {string} [options.targetNamespace] targetNamespace шапки.
 * @param {number} [options.rowOffset=PROJECT_ROW_OFFSET] шаг дорожек по вертикали.
 * @returns {string} XML проекта.
 * @throws {Error} если список пуст или в схеме нет `<bpmn:process>`.
 */
export function buildProjectXml(processes, options = {}) {
  const list = (Array.isArray(processes) ? processes : []).filter(
    (item) => item && typeof item.xml === 'string' && item.xml.trim() !== ''
  );

  if (list.length === 0) {
    throw new Error('Проект без процессов: передайте хотя бы одну BPMN-схему.');
  }

  const rowOffset = Number.isFinite(options.rowOffset) ? options.rowOffset : PROJECT_ROW_OFFSET;
  const sources = list.map((item) => item.xml);

  const processXml = [];
  const participants = [];
  const di = [];

  list.forEach((item, index) => {
    const block = processBlockOf(item.xml, item.processId);

    if (!block) {
      const label = item.processId || item.participantName || '#' + (index + 1);
      throw new Error('В схеме процесса «' + label + '» нет <bpmn:process>.');
    }

    const processId = attributeOf(block, 'id');
    const processName = attributeOf(block, 'name') || processId;
    const offset = index * rowOffset;

    processXml.push(block);

    const participantId = 'Participant_' + processId;
    const participantName = item.participantName || processName;

    participants.push(
      '    <bpmn:participant id="' + participantId + '" name="' + escapeAttribute(participantName) +
        '" processRef="' + processId + '" />'
    );

    const nodes = processDi(item.xml, block, offset);
    const bounds = boundsOf(nodes);

    di.push(
      '      <bpmndi:BPMNShape id="' + participantId + '_di" bpmnElement="' + participantId + '" isHorizontal="true">',
      '        <dc:Bounds x="40" y="' + Math.max(offset - 20, 0) + '" width="' + Math.max(bounds.right + 80, 700) +
        '" height="' + Math.max(bounds.bottom - offset + 60, 160) + '" />',
      '      </bpmndi:BPMNShape>'
    );
    di.push(...nodes.map((node) => '      ' + node));
  });

  return [
    XML_DECLARATION,
    '<bpmn:definitions ' + namespaceDeclarations(sources),
    '                  id="' + (options.id || PROJECT_DEFINITIONS_ID) + '"',
    options.name ? '                  name="' + escapeAttribute(options.name) + '"' : '',
    '                  targetNamespace="' + (options.targetNamespace || 'http://bpmn.io/schema/bpmn') + '">',
    '  <bpmn:collaboration id="' + (options.collaborationId || PROJECT_COLLABORATION_ID) + '">',
    participants.join('\n'),
    '  </bpmn:collaboration>',
    '',
    processXml.join('\n\n'),
    '',
    '  <bpmndi:BPMNDiagram id="BPMNDiagram_Project">',
    '    <bpmndi:BPMNPlane id="' + (options.planeId || PROJECT_PLANE_ID) + '" bpmnElement="' +
      (options.collaborationId || PROJECT_COLLABORATION_ID) + '">',
    di.join('\n'),
    '    </bpmndi:BPMNPlane>',
    '  </bpmndi:BPMNDiagram>',
    '</bpmn:definitions>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** DI одного процесса: только узлы этого процесса, сдвинутые на дорожку. */
function processDi(xml, block, offset) {
  const ids = idsOf(block);
  const nodes = diNodesOf(xml).filter((node) => diNodeBelongsTo(node, ids));

  return nodes.map((node) => shiftDiY(node, offset));
}

/** Экранирует значение атрибута XML. */
function escapeAttribute(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Нарезка процесса из проекта — то, что уходит в оркестратор.
 *
 * Движок читает только первый `bpmn:process` документа, поэтому проект целиком
 * ему отправлять нельзя: второго процесса для него просто нет. Нарезка содержит
 * ровно один процесс и его DI.
 *
 * @param {string} projectXml XML проекта (возможно, обычная одно-процессная схема).
 * @param {string} [processId] идентификатор процесса (по умолчанию первый).
 * @returns {string} самостоятельная схема процесса (`''`, если процесса нет).
 */
export function extractProcessXml(projectXml, processId) {
  if (typeof projectXml !== 'string' || projectXml.trim() === '') return '';

  const block = processBlockOf(projectXml, processId);
  if (!block) return '';

  const ids = processIdsOf(projectXml);
  const targetId = attributeOf(block, 'id');

  // Один процесс и нет кооперации — нарезать нечего: отдаём документ как есть
  // (важно для схем, которые уже лежат в оркестраторе, и для тестов).
  if (ids.length === 1 && !/<bpmn:collaboration\b/.test(projectXml)) {
    return projectXml;
  }

  const nodes = diNodesOf(projectXml).filter((node) => diNodeBelongsTo(node, idsOf(block)));

  return [
    XML_DECLARATION,
    '<bpmn:definitions ' + definitionsAttributes(projectXml) + '>',
    block,
    '',
    '  <bpmndi:BPMNDiagram id="BPMNDiagram_' + targetId + '">',
    '    <bpmndi:BPMNPlane id="BPMNPlane_' + targetId + '" bpmnElement="' + targetId + '">',
    ...nodes.map((node) => '      ' + node),
    '    </bpmndi:BPMNPlane>',
    '  </bpmndi:BPMNDiagram>',
    '</bpmn:definitions>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Заменяет процесс в проекте (кнопка «Демо-схема»).
 *
 * DI нового процесса выравнивается по вертикали старого: демо-схема Поставщика
 * нарисована с `y≈78`, а в проекте её дорожка лежит ниже — без выравнивания
 * блок уехал бы на дорожку Заказчика.
 *
 * Если в новом XML нет запрошенного процесса, проект возвращается без изменений:
 * «сброс» не должен молча удалить процесс из проекта.
 *
 * @param {string} projectXml XML проекта.
 * @param {string} processId какой процесс заменить.
 * @param {string} processXml новая схема процесса (самостоятельный документ).
 * @returns {string} XML проекта.
 */
export function replaceProcessXml(projectXml, processId, processXml) {
  if (typeof projectXml !== 'string' || projectXml.trim() === '') return projectXml || '';

  const oldBlock = processBlockOf(projectXml, processId);
  const newBlock = processBlockOf(processXml, processId);

  if (!oldBlock || !newBlock) return projectXml;

  if (processIdsOf(projectXml).length === 1) return processXml;

  const oldIds = idsOf(oldBlock);
  const oldNodes = diNodesOf(projectXml).filter((node) => diNodeBelongsTo(node, oldIds));
  const newNodes = diNodesOf(processXml).filter((node) => diNodeBelongsTo(node, idsOf(newBlock)));

  const oldMin = minYOf(oldNodes);
  const newMin = minYOf(newNodes);
  const aligned =
    oldMin === null || newMin === null
      ? newNodes
      : newNodes.map((node) => shiftDiY(node, oldMin - newMin));

  // Блок процесса вырезается по метке: его DI-узлы ищутся по идентификаторам
  // элементов, а после замены блока их в проекте уже нет.
  let result = projectXml.replace(oldBlock, '@@PROCESS@@');

  result = result.replace(DI_NODE_PATTERN, (node) => (diNodeBelongsTo(node, oldIds) ? '' : node));
  result = result.replace('@@PROCESS@@', newBlock);

  if (aligned.length > 0) {
    result = result.replace(
      /(\s*)<\/bpmndi:BPMNPlane>/,
      (match, spaces) =>
        '\n' + aligned.map((node) => '      ' + node).join('\n') + spaces + '</bpmndi:BPMNPlane>'
    );
  }

  return result.replace(/\n{3,}/g, '\n\n');
}

