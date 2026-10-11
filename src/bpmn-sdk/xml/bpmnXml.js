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

import { ELEMENT_ID_PATTERN, ROLE_PATTERN } from '../constants';

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
 * Проверяет, что узел — Activity (задача, подпроцесс, вызов активности).
 *
 * Это важно для ролей: `resourceRole` (`bpmn:potentialOwner`) по спецификации
 * BPMN 2.0 есть только у `Activity`. На событии или шлюзе `bpmn-moddle`
 * не признаёт элемент (`unparsable content`) и молча теряет его при
 * сохранении схемы, поэтому роль разрешено назначать только Activity.
 */
export function isActivityType(type) {
  const localName = String(type || '').split(':').pop();

  return (
    /Task$/.test(localName) ||
    /SubProcess$/i.test(localName) ||
    localName === 'callActivity' ||
    localName === 'transaction'
  );
}

/** Проверяет, что узел DOM — Activity. */
export function isActivityElement(node) {
  return isActivityType(getLocalName(node));
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

/* ------------------------------------------------------------------ *
 * Роль исполнителя узла: `bpmn:potentialOwner`
 * ------------------------------------------------------------------ */

/**
 * Роль исполнителя хранится в самой схеме: `Activity#resources` типа
 * `bpmn:potentialOwner`, роль — в атрибуте `name`.
 *
 * Почему именно так:
 *  - `bpmn:potentialOwner` — тип из BPMN 2.0, уже описанный в `bpmn-moddle`
 *    внутри `bpmn-js`: ничего не нужно добавлять в `moddleExtensions`
 *    моделлера (`BpmnEditor` создаёт `Modeler` без расширений, поэтому
 *    `camunda:*` и подобные атрибуты молча теряются, а этот тип — нет);
 *  - «каноническая» запись роли по спецификации
 *    (`resourceAssignmentExpression` -> `formalExpression`) при сериализации
 *    переписывается моддлом в `bpmn:expression xsi:type="bpmn:tFormalExpression"`,
 *    поэтому `name` читается/пишется стабильнее;
 *  - элемент пишется **без `id`**: `renameElementId` переименовывает все `id`
 *    схемы, и роль «уехала» бы вместе с переименованным узлом.
 *
 * Движок оркестратора роль не читает и не проверяет (проверено спайком на
 * реальном движке: маршрут процесса со `potentialOwner` проходит целиком) —
 * это разметка маршрутизации в UI, а не авторизация.
 */

/** Тип moddle роли исполнителя (`Activity#resources`). */
export const POTENTIAL_OWNER_TYPE = 'bpmn:PotentialOwner';

/**
 * Локальное имя элемента роли в XML.
 *
 * В XML имя начинается со строчной буквы (`<bpmn:potentialOwner ...>` — тип
 * BPMN 2.0), а `bpmn:PotentialOwner` — имя типа moddle, поэтому константа не
 * выводится из `POTENTIAL_OWNER_TYPE`, а задана явно.
 */
export const POTENTIAL_OWNER_LOCAL_NAME = 'potentialOwner';

/** Элементы «длинной» записи роли по спецификации (читаются, но не пишутся). */
const ROLE_EXPRESSION_LOCAL_NAMES = ['formalExpression', 'expression'];

/** Проверяет допустимость роли (`bpmn:potentialOwner/@name`). */
export function isValidRole(role) {
  return typeof role === 'string' && ROLE_PATTERN.test(role);
}



/**
 * Назначения ролей «узел -> роль» по всей схеме.
 *
 * Роль берётся у элемента-владельца (`potentialOwner` — прямой потомок узла),
 * поэтому в результат попадают только узлы вроде `bpmn:userTask`, а не
 * служебные элементы вроде `bpmn:process`.
 *
 * Читаются обе записи: каноничная для SDK (`name`) и «длинная» по спецификации
 * (`resourceAssignmentExpression` -> `formalExpression`, она же `expression`
 * после нормализации моддлом). Пишется всегда каноничная для SDK.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Object<string, string>} например `{Task_QualityControl: 'QUALITY'}`.
 */
export function getRoleAssignments(xml) {
  const doc = parseXml(xml);
  if (!doc) return {};

  const assignments = {};

  Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === POTENTIAL_OWNER_LOCAL_NAME)
    .forEach((node) => {
      const role = node.getAttribute('name') || readExpressionRole(node);
      const owner = node.parentNode;
      const elementId = owner && owner.getAttribute ? owner.getAttribute('id') : null;

      // Только Activity: у события/шлюза роль не поддерживается спецификацией
      // и не переживёт сохранение схемы (см. `isActivityType`).
      if (role && elementId && isActivityElement(owner)) assignments[elementId] = role;
    });

  return assignments;
}

/** Роль из «длинной» записи по спецификации (`formalExpression`/`expression`). */
function readExpressionRole(owner) {
  const expression = Array.from(owner.getElementsByTagName('*')).find((node) =>
    ROLE_EXPRESSION_LOCAL_NAMES.includes(getLocalName(node))
  );

  return expression ? String(expression.textContent || '').trim() : '';
}

/**
 * Роль исполнителя одного узла.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId идентификатор узла.
 * @returns {string} роль либо `''`, если роль не назначена.
 */
export function getElementRole(xml, elementId) {
  if (!elementId) return '';

  return getRoleAssignments(xml)[elementId] || '';
}

/**
 * Назначает (меняет, снимает) роль исполнителя узла прямо в XML.
 *
 * Правка выполняется текстом, а не через DOM-сериализацию: `DOMParser` +
 * `XMLSerializer` переформатировали бы всю схему (включая `bpmndi:BPMNShape`
 * и порядок атрибутов), а схема пользователя должна отличаться от исходной
 * ровно на одну строку. По той же причине правка идёт по аналогии с
 * `renameElementId` — границы узла ищутся по `id`.
 *
 * Роль пишется канонической формой `<bpmn:potentialOwner name="ROLE" />`
 * внутри целевого узла; `incoming`/`outgoing`/`documentation`/
 * `extensionElements` узла сохраняются, `id` у самого `potentialOwner`
 * не появляется (см. комментарий к `POTENTIAL_OWNER_TYPE`).
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId идентификатор узла (`element_id`).
 * @param {string} [role=''] роль либо `''`, чтобы снять назначение.
 * @returns {string} схема с изменённой ролью (та же строка, если менять нечего).
 * @throws {Error} пустая схема, недопустимая роль, узел не найден,
 *   узел не является Activity (запись роли в событие/шлюз не поддерживается).
 */
export function setElementRole(xml, elementId, role = '') {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('Пустая BPMN-схема: назначение роли невозможно.');
  }
  if (role !== '' && !isValidRole(role)) {
    throw new Error('Недопустимая роль исполнителя: "' + role + '"');
  }

  const range = readElementRange(xml, elementId);
  if (!range) {
    throw new Error('Элемент с идентификатором "' + elementId + '" не найден в схеме.');
  }

  const existing = findPotentialOwnerTag(xml, range);
  if (existing ? existing.role === role : role === '') return xml;

  // Снять роль можно у любого узла (например, чтобы починить схему, где роль
  // записали в событие вручную), а вот записать — только в Activity.
  if (role === '') return removePotentialOwner(xml, existing);

  if (!isActivityType(range.name)) {
    throw new Error(
      'Роль назначается только Activity-узлам (задача, подпроцесс): у "' +
        elementId +
        '" (' +
        range.name +
        ') нет resourceRole по спецификации BPMN 2.0.'
    );
  }

  const ownerTag = buildOwnerTag(existing ? existing.tag : ownerTagName(range.name), role);

  return existing
    ? xml.slice(0, existing.start) + ownerTag + xml.slice(existing.end)
    : insertPotentialOwner(xml, range, ownerTag);
}

/* ------------------------------------------------------------------ *
 * Внутренние помощники разбора/правки текста схемы
 * ------------------------------------------------------------------ */

/**
 * Индекс закрывающего тега с учётом вложенности одноимённых элементов.
 *
 * @param {string} xml схема.
 * @param {string} name имя тега вместе с префиксом (`bpmn:userTask`).
 * @param {number} from позиция, с которой начинается поиск.
 * @returns {number} индекс `</name>` либо `-1`.
 */
function findCloseTagIndex(xml, name, from) {
  const open = '<' + name;
  const close = '</' + name + '>';
  let depth = 1;
  let cursor = from;

  while (cursor < xml.length) {
    const nextOpen = xml.indexOf(open, cursor);
    const nextClose = xml.indexOf(close, cursor);

    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const after = xml.charAt(nextOpen + open.length);
      if (after === '>' || after === '/' || /\s/.test(after)) depth += 1;
      cursor = nextOpen + open.length;
      continue;
    }

    depth -= 1;
    if (depth === 0) return nextClose;
    cursor = nextClose + close.length;
  }

  return -1;
}

/**
 * Границы узла с заданным `id` (открывающий тег, начало тела, закрывающий тег).
 *
 * @param {string} xml схема.
 * @param {string} elementId идентификатор узла.
 * @returns {{name: string, openStart: number, bodyStart: number, openTag: string,
 *            selfClosing: boolean, closeStart: number}|null}
 */
function readElementRange(xml, elementId) {
  if (typeof xml !== 'string' || !elementId) return null;

  const hit = new RegExp('\\sid="' + escapeRegExp(elementId) + '"').exec(xml);
  if (!hit) return null;

  const openStart = xml.lastIndexOf('<', hit.index);
  const openEnd = xml.indexOf('>', hit.index);
  if (openStart === -1 || openEnd === -1) return null;

  const openTag = xml.slice(openStart, openEnd + 1);
  const nameMatch = openTag.match(/^<([A-Za-z_][\w.:-]*)/);
  if (!nameMatch) return null;

  const bodyStart = openEnd + 1;
  const selfClosing = openTag.endsWith('/>');

  return {
    name: nameMatch[1],
    openStart,
    bodyStart,
    openTag,
    selfClosing,
    closeStart: selfClosing ? -1 : findCloseTagIndex(xml, nameMatch[1], bodyStart),
  };
}

/**
 * Границы элемента роли внутри узла.
 *
 * @param {string} xml схема.
 * @param {Object} range границы узла из `readElementRange`.
 * @returns {{start: number, end: number, role: string, tag: string}|null}
 */
function findPotentialOwnerTag(xml, range) {
  if (!range || range.selfClosing || range.closeStart === -1) return null;

  const body = xml.slice(range.bodyStart, range.closeStart);
  const open = body.match(
    new RegExp('<([A-Za-z_][\\w.-]*:)?' + POTENTIAL_OWNER_LOCAL_NAME + '(\\s[^>]*?)?(/?)>')
  );

  if (!open) return null;

  const start = range.bodyStart + open.index;
  const attributes = open[2] || '';
  const nameMatch = attributes.match(/\sname="([^"]*)"/);
  const tag = (open[1] || '') + POTENTIAL_OWNER_LOCAL_NAME;

  if (open[3] === '/') {
    return { start, end: start + open[0].length, role: nameMatch ? nameMatch[1] : '', tag };
  }

  const closeTag = '</' + tag + '>';
  const closeStart = xml.indexOf(closeTag, start);

  return {
    start,
    end: closeStart === -1 ? start + open[0].length : closeStart + closeTag.length,
    role: nameMatch ? nameMatch[1] : '',
    tag,
  };
}

/** Имя тега роли с тем же namespace-префиксом, что у узла. */
function ownerTagName(elementTagName) {
  const colon = String(elementTagName || '').indexOf(':');

  return colon === -1
    ? POTENTIAL_OWNER_LOCAL_NAME
    : elementTagName.slice(0, colon + 1) + POTENTIAL_OWNER_LOCAL_NAME;
}

/** Каноническая запись роли: `<bpmn:potentialOwner name="ROLE" />`. */
function buildOwnerTag(tag, role) {
  return '<' + tag + ' name="' + role + '" />';
}

/** Вставляет роль в узел перед закрывающим тегом, сохраняя отступы. */
function insertPotentialOwner(xml, range, ownerTag) {
  if (range.selfClosing) {
    const head = range.openTag.slice(0, -2).replace(/\s+$/, '');

    return (
      xml.slice(0, range.openStart) +
      head +
      '>' +
      ownerTag +
      '</' +
      range.name +
      '>' +
      xml.slice(range.bodyStart)
    );
  }

  const lineStart = xml.lastIndexOf('\n', range.closeStart) + 1;
  const indent = xml.slice(lineStart, range.closeStart);

  if (/^\s*$/.test(indent) && lineStart > range.bodyStart) {
    return xml.slice(0, lineStart) + indent + '  ' + ownerTag + '\n' + xml.slice(lineStart);
  }

  return xml.slice(0, range.closeStart) + ownerTag + xml.slice(range.closeStart);
}

/** Удаляет роль вместе с «осиротевшим» переводом строки, если он остался. */
function removePotentialOwner(xml, existing) {
  const lineStart = xml.lastIndexOf('\n', existing.start) + 1;
  const before = xml.slice(lineStart, existing.start);
  const rest = xml.slice(existing.end);
  const lineEnd = rest.indexOf('\n');

  if (/^\s*$/.test(before) && lineEnd !== -1 && /^\s*$/.test(rest.slice(0, lineEnd))) {
    return xml.slice(0, lineStart) + rest.slice(lineEnd + 1);
  }

  return xml.slice(0, existing.start) + rest;
}
