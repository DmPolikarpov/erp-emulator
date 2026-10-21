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

import {
  ELEMENT_ID_PATTERN,
  ENGINE_EVENTS,
  INSTANCE_PREFIX_PATTERN,
  ROLE_PATTERN,
  TRIGGER_PAYLOAD_KEYS_SEPARATOR,
  TRIGGER_PAYLOAD_KEY_PATTERN,
} from '../constants';
import {
  TRIGGER_FIELDS,
  TRIGGER_LOCAL_NAME,
  TRIGGER_NAMESPACE,
  TRIGGER_NAMESPACE_PREFIX,
} from './triggerModdle';
import {
  ACTION_FIELDS,
  ACTION_LOCAL_NAME,
  ACTION_NAMESPACE,
  ACTION_NAMESPACE_PREFIX,
} from './actionModdle';
import { ROLE_CATALOG_LOCAL_NAME, ROLE_LOCAL_NAME, ROLE_NAMESPACE } from './rolesModdle';
import { extractProcessXml } from './projectXml';

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
  if (role === '') return removeInlineElement(xml, existing);

  if (!isActivityType(range.name)) {
    throw new Error(
      'Роль назначается только Activity-узлам (задача, подпроцесс): у "' +
        elementId +
        '" (' +
        range.name +
        ') нет resourceRole по спецификации BPMN 2.0.'
    );
  }

  const ownerTag = buildOwnerTag(
    existing ? existing.tag : prefixedTagName(range.name, POTENTIAL_OWNER_LOCAL_NAME),
    role
  );

  return existing
    ? xml.slice(0, existing.start) + ownerTag + xml.slice(existing.end)
    : insertIntoElement(xml, range, ownerTag);
}

/* ------------------------------------------------------------------ *
 * Кросс-процессный запуск: `trg:processTrigger`
 * ------------------------------------------------------------------ */

/** Полное имя элемента триггера в XML (`trg:processTrigger`). */
export const TRIGGER_TAG_NAME = TRIGGER_NAMESPACE_PREFIX + ':' + TRIGGER_LOCAL_NAME;

/** Локальное имя контейнера расширений (`bpmn:extensionElements`). */
const EXTENSION_ELEMENTS_LOCAL_NAME = 'extensionElements';

/**
 * Проверяет, что узел может быть хостом триггера.
 *
 * Триггер срабатывает в момент активации узла, поэтому хостом может быть
 * только узел, который движок активирует токеном: задача, событие, шлюз,
 * подпроцесс или вызов активности. `bpmn:extensionElements` по спецификации
 * есть у любого `BaseElement` (в том числе у `sequenceFlow`), но
 * последовательный поток токеном не активируется — триггер на нём никогда
 * не сработает, поэтому такая разметка запрещена на уровне SDK.
 *
 * @param {string} type Тип узла (`bpmn:userTask`, `UserTask` или `userTask`).
 * @returns {boolean}
 */
export function isTriggerHostType(type) {
  return isFlowElementType(type) || isActivityType(type);
}

/**
 * Проверяет префикс идентификатора экземпляра.
 *
 * Пустая строка считается допустимой: это необязательное поле, и «пусто»
 * означает «идентификатор собирает движок» (`inst-` + uuid).
 *
 * @param {string} prefix Префикс (`inst-supp-`).
 * @returns {boolean}
 */
export function isValidInstancePrefix(prefix) {
  return typeof prefix === 'string' && INSTANCE_PREFIX_PATTERN.test(prefix);
}

/**
 * Приводит список ключей payload к канонической форме `a,b,c`.
 *
 * Принимает строку (`orderNum, volume`) либо массив ключей (так удобнее
 * вызывать из React-формы). Пробелы вокруг ключей убираются, пустые элементы
 * (следствие лишней запятой) и повторы отбрасываются.
 *
 * @param {string|string[]} payloadKeys Список ключей.
 * @returns {string} Канонический список через запятую (возможно, `''`).
 */
export function normalizePayloadKeys(payloadKeys) {
  const parts = Array.isArray(payloadKeys)
    ? payloadKeys
    : String(payloadKeys == null ? '' : payloadKeys).split(TRIGGER_PAYLOAD_KEYS_SEPARATOR);

  const keys = [];
  parts.forEach((part) => {
    const key = String(part == null ? '' : part).trim();
    if (key !== '' && keys.indexOf(key) === -1) keys.push(key);
  });

  return keys.join(TRIGGER_PAYLOAD_KEYS_SEPARATOR);
}

/**
 * Проверяет список ключей payload.
 *
 * @param {string|string[]} payloadKeys Список ключей (`orderNum,volume`).
 * @returns {boolean}
 */
export function isValidPayloadKeys(payloadKeys) {
  if (typeof payloadKeys !== 'string' && !Array.isArray(payloadKeys)) return false;

  const normalized = normalizePayloadKeys(payloadKeys);
  if (normalized === '') return true;

  return normalized
    .split(TRIGGER_PAYLOAD_KEYS_SEPARATOR)
    .every((key) => TRIGGER_PAYLOAD_KEY_PATTERN.test(key));
}

/**
 * Приводит триггер к канонической форме и проверяет его поля.
 *
 * Поля триггера (см. `TRIGGER_FIELDS`): `targetProcessId` — обязательный,
 * `instancePrefix`, `startElementId`, `firstElementId`, `payloadKeys` —
 * необязательные. Неизвестные поля отбрасываются: в XML попадают только
 * поля из `TRIGGER_FIELDS` (иначе их не прочитает ни модельер, ни движок).
 *
 * @param {object} trigger Триггер (`{ targetProcessId, ... }`).
 * @returns {object} Новый объект ровно с полями `TRIGGER_FIELDS`.
 * @throws {Error} триггер не объект, нет/недопустим `targetProcessId`,
 *   недопустим `instancePrefix`, недопустим идентификатор узла,
 *   недопустим список ключей payload.
 */
export function normalizeTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
    throw new Error('Триггер запуска — это объект с полем targetProcessId.');
  }

  const targetProcessId = String(trigger.targetProcessId == null ? '' : trigger.targetProcessId).trim();
  if (!isValidElementId(targetProcessId)) {
    throw new Error(
      'Недопустимый целевой процесс триггера: "' + targetProcessId + '" (ожидается bpmn:process/@id).'
    );
  }

  const normalized = {};
  TRIGGER_FIELDS.forEach((name) => {
    const value = trigger[name] == null ? '' : String(trigger[name]).trim();
    normalized[name] = name === 'payloadKeys' ? normalizePayloadKeys(value) : value;
  });

  if (!isValidInstancePrefix(normalized.instancePrefix)) {
    throw new Error('Недопустимый префикс экземпляра: "' + normalized.instancePrefix + '"');
  }
  if (normalized.startElementId !== '' && !isValidElementId(normalized.startElementId)) {
    throw new Error('Недопустимый узел-источник триггера: "' + normalized.startElementId + '"');
  }
  if (normalized.firstElementId !== '' && !isValidElementId(normalized.firstElementId)) {
    throw new Error('Недопустимый первый узел целевого процесса: "' + normalized.firstElementId + '"');
  }
  if (!isValidPayloadKeys(normalized.payloadKeys)) {
    throw new Error('Недопустимый список ключей payload: "' + normalized.payloadKeys + '"');
  }

  return normalized;
}

/**
 * Проверяет триггер, не выбрасывая исключение.
 *
 * @param {object} trigger Триггер.
 * @returns {boolean}
 */
export function isValidTrigger(trigger) {
  try {
    normalizeTrigger(trigger);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Читает триггер узла из схемы.
 *
 * Чтение идёт по DOM: триггер вложен в `bpmn:extensionElements` узла, а не
 * лежит атрибутом на самом узле (как роль), поэтому «плоский» разбор по `id`
 * (см. `findPotentialOwnerTag`) здесь не работает.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId Идентификатор узла (`element_id`).
 * @returns {object|null} Триггер с полями `TRIGGER_FIELDS` либо `null`.
 */
export function getElementTrigger(xml, elementId) {
  if (typeof xml !== 'string' || !elementId) return null;

  const doc = parseXml(xml);
  if (!doc) return null;

  const node = Array.from(doc.getElementsByTagName('*'))
    .filter((candidate) => getLocalName(candidate) === TRIGGER_LOCAL_NAME)
    .find((candidate) => extensionOwnerId(candidate) === elementId);

  return node ? triggerFromNode(node) : null;
}

/**
 * Собирает все триггеры схемы в порядке появления в XML.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Array<{elementId: string, trigger: object}>} Триггеры с узлами.
 */
export function listTriggers(xml) {
  if (typeof xml !== 'string') return [];

  const doc = parseXml(xml);
  if (!doc) return [];

  return Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === TRIGGER_LOCAL_NAME)
    .map((node) => ({ elementId: extensionOwnerId(node), trigger: triggerFromNode(node) }))
    .filter((item) => item.elementId !== '');
}

/**
 * Возвращает карту триггеров схемы: `{ [element_id]: trigger }`.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Object<string, object>} Триггеры по идентификаторам узлов.
 */
export function getTriggerAssignments(xml) {
  const assignments = {};
  listTriggers(xml).forEach((item) => {
    assignments[item.elementId] = item.trigger;
  });

  return assignments;
}

/**
 * Назначает (меняет, снимает) триггер кросс-процессного запуска в XML.
 *
 * Правка, как и у роли, выполняется текстом: схема пользователя должна
 * отличаться от исходной ровно на добавленный (изменённый) фрагмент, а
 * `DOMParser` + `XMLSerializer` переформатировали бы всю схему целиком.
 *
 * Триггер пишется канонической формой
 * `<trg:processTrigger targetProcessId="..." ... />` внутри
 * `bpmn:extensionElements` узла; контейнер создаётся при необходимости, а в
 * `bpmn:definitions` добавляется объявление namespace `xmlns:trg`. Остальные
 * значения `extensionElements` узла (чужие расширения) сохраняются.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId Идентификатор узла (`element_id`).
 * @param {object|null} [trigger=null] Триггер либо `null`, чтобы снять его.
 * @returns {string} Схема с изменённым триггером (та же строка, если менять нечего).
 * @throws {Error} пустая схема, недопустимый триггер, узел не найден,
 *   узел не является узлом потока (последовательный поток не активируется).
 */
export function setElementTrigger(xml, elementId, trigger = null) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('Пустая BPMN-схема: назначение триггера невозможно.');
  }

  const range = readElementRange(xml, elementId);
  if (!range) {
    throw new Error('Элемент с идентификатором "' + elementId + '" не найден в схеме.');
  }

  const extensionElements = findExtensionElementsTag(xml, range);
  const existing = extensionElements ? findTriggerTag(xml, extensionElements) : null;

  if (!trigger) {
    // Снять триггер можно у любого узла (например, чтобы починить схему, где
    // триггер записали в sequenceFlow вручную), а вот назначить — только узлу
    // потока: последовательный поток движок токеном не активирует.
    if (!existing) return xml;
    return removeInlineElement(xml, existing);
  }

  if (!isTriggerHostType(range.name)) {
    throw new Error(
      'Триггер запуска назначается только узлам потока (задача, событие, шлюз, подпроцесс), а "' +
        elementId +
        '" — ' +
        range.name +
        '.'
    );
  }

  const normalized = normalizeTrigger(trigger);
  const triggerTag = buildTriggerTag(TRIGGER_TAG_NAME, normalized);

  if (existing) {
    // Схема не должна меняться, если триггер уже такой (та же логика, что у
    // `setElementRole`): правка «в себя» порождала бы ложные изменения в
    // списке несохранённых правок редактора.
    if (isSameTrigger(existing.trigger, normalized)) return xml;

    return ensureTriggerNamespace(xml.slice(0, existing.start) + triggerTag + xml.slice(existing.end));
  }

  const patched = extensionElements
    ? insertIntoExtensionElements(xml, extensionElements, triggerTag)
    : insertExtensionElements(xml, range, triggerTag);

  return ensureTriggerNamespace(patched);
}

/* ------------------------------------------------------------------ *
 * Кнопки участников: `act:userAction`
 * ------------------------------------
 * Кнопка описывает шаг участника: надпись, роль, событие и узел, который
 * станет `ACTIVE`. Событие и узел необязательны — их выводят из схемы
 * `resolveActionEvent`/`resolveActionTarget` (умолчания `DEFAULT_ACTION_EVENT` и
 * `getNextElementId`), а значение, записанное в XML явно, всегда важнее
 * умолчания.
 * ------------------------------------------------------------------ */

/** Полное имя элемента кнопки в XML (`act:userAction`). */
export const ACTION_TAG_NAME = ACTION_NAMESPACE_PREFIX + ':' + ACTION_LOCAL_NAME;

/**
 * Допустимое имя иконки кнопки (`icon="Truck"`).
 *
 * Схема хранит не картинку, а имя иконки из набора клиента: определение кнопки
 * остаётся данными, а оформление — делом кабинета. Незнакомое имя рисуется
 * иконкой по умолчанию, поэтому «чужая» схема интерфейс не ломает.
 */
export const ACTION_ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Проверяет, что узел может быть хостом кнопки участника.
 *
 * Кнопка описывает шаг, который ведёт участник, поэтому хостом может быть
 * только узел, который движок активирует токеном: задача, событие, шлюз,
 * подпроцесс или вызов активности. На `sequenceFlow` шаг не активируется —
 * кнопки там быть не может (та же причина, что и у триггера).
 *
 * @param {string} type Тип узла (`bpmn:userTask`, `UserTask` или `userTask`).
 * @returns {boolean}
 */
export function isActionHostType(type) {
  return isTriggerHostType(type);
}

/**
 * Событие кнопки по умолчанию: «блок выполнен, шаг закрыт».
 *
 * Движок имя события не разбирает: оно уходит в subject NATS
 * (`mes.in.v1.event.erp.${event_name}`, см. `bpmn-gateways/http-cluster`) и в
 * журнал как метка операции, а токен двигает `element_id`
 * (см. `bpmn-engine/src/main.rs`). Поэтому кнопке достаточно знать, **куда**
 * шаг переводит токен, а «что произошло» можно не писать: пустое
 * `act:userAction/@event` — это как раз «завершить блок».
 */
export const DEFAULT_ACTION_EVENT = ENGINE_EVENTS.COMPLETE_BLOCK;

/**
 * Целевые узлы исходящих связей узла (`sequenceFlow/@targetRef`).
 *
 * Порядок — как в схеме; повторы (две связи в один узел) схлопываются.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId идентификатор узла (`element_id`).
 * @returns {string[]} идентификаторы узлов-приёмников (возможно, пусто).
 */
export function getOutgoingTargetIds(xml, elementId) {
  if (typeof xml !== 'string' || !elementId) return [];

  const doc = parseXml(xml);
  if (!doc) return [];

  const targets = [];

  Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === 'sequenceFlow')
    .forEach((node) => {
      if ((node.getAttribute('sourceRef') || '') !== elementId) return;

      const target = node.getAttribute('targetRef') || '';
      if (target !== '' && targets.indexOf(target) === -1) targets.push(target);
    });

  return targets;
}

/**
 * Узел, на который движок переведёт токен после завершения блока.
 *
 * Это умолчание для пустого `act:userAction/@elementId`. Ответ даётся только
 * когда он однозначен: у развилки (шлюз, параллельное ветвление) исходящих
 * связей несколько, и «следующий шаг» из схемы не выводится — там `''`, а узел
 * кнопка обязана назвать сама.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId идентификатор узла (`element_id`).
 * @returns {string} идентификатор узла либо `''`.
 */
export function getNextElementId(xml, elementId) {
  const targets = getOutgoingTargetIds(xml, elementId);

  return targets.length === 1 ? targets[0] : '';
}

/**
 * Событие кнопки: её собственное (`event`) либо `DEFAULT_ACTION_EVENT`.
 *
 * @param {object} action Кнопка (`ACTION_FIELDS`).
 * @returns {string} `event_name` для `sendEvent` (непустой).
 */
export function resolveActionEvent(action) {
  return String((action && action.event) || '').trim() || DEFAULT_ACTION_EVENT;
}

/**
 * Узел кнопки: её собственный (`elementId`) либо следующий блок по схеме.
 *
 * Хост (узел, на котором кнопка объявлена) в событие не уходит — уходит его
 * приёмник, поэтому пустое поле читается как «шаг выполнен»: токен встаёт на
 * узел за единственной исходящей связью (`getNextElementId`).
 *
 * @param {string} xml BPMN-схема узла-хоста.
 * @param {string} elementId идентификатор узла-хоста (поле `elementId` записи
 *   `listActions`).
 * @param {object} action Кнопка (`ACTION_FIELDS`).
 * @returns {string} `element_id` для `sendEvent` (возможно, `''`).
 */
export function resolveActionTarget(xml, elementId, action) {
  const target = String((action && action.elementId) || '').trim();

  return target !== '' ? target : getNextElementId(xml, elementId);
}

/**
 * Пара «событие + узел» кнопки, разрешённая по схеме.
 *
 * Движку нужны ровно они (`event_name` и `element_id` события), а в схеме оба
 * поля необязательны: пустое `event` даёт `CompleteBlock`, пустой `elementId` —
 * следующий блок по связи. Явно записанное значение всегда важнее умолчания,
 * поэтому схемы, где пара указана руками, читаются как раньше.
 *
 * @param {string} xml BPMN-схема узла-хоста.
 * @param {string} elementId идентификатор узла-хоста.
 * @param {object} action Кнопка (`ACTION_FIELDS`).
 * @returns {{event: string, elementId: string}} аргументы `GatewayClient.sendEvent`.
 */
export function resolveAction(xml, elementId, action) {
  return {
    event: resolveActionEvent(action),
    elementId: resolveActionTarget(xml, elementId, action),
  };
}

/**
 * Приводит описание кнопки к канонической форме и проверяет поля.
 *
 * Обязательны только те поля, которые из схемы не выводятся: `id` (ключ кнопки)
 * и `label` (надпись). Пустые `event` и `elementId` допустимы и означают
 * умолчания схемы — «шаг выполнен» (`DEFAULT_ACTION_EVENT`) и следующий блок по
 * единственной исходящей связи (`getNextElementId`); их подставляет
 * `resolveAction` там, где событие собирается. Необязательные: `role`, `icon`,
 * `counterpartEvent`, `counterpartElementId`, `startsProcess`. Неизвестные поля
 * отбрасываются: в XML попадают только поля из `ACTION_FIELDS` (иначе их не
 * прочитает ни моделлер, ни клиент).
 *
 * Заполненные поля проверяются по формату даже там, где пустые допустимы:
 * опечатка в `elementId` увела бы токен в никуда, и увидеть её лучше в
 * инспекторе, а не в проде.
 *
 * @param {object} action Кнопка (`{ id, label, event?, elementId?, ... }`).
 * @returns {object} Новый объект ровно с полями `ACTION_FIELDS`.
 * @throws {Error} кнопка не объект, нет/недопустим `id`, пустая надпись,
 *   недопустимы роль, иконка, событие, узлы, имя процесса второй стороны либо
 *   задано только одно из полей второй стороны.
 */
export function normalizeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new Error('Кнопка участника — это объект с полем id.');
  }

  const normalized = {};
  ACTION_FIELDS.forEach((name) => {
    normalized[name] = action[name] == null ? '' : String(action[name]).trim();
  });

  if (!isValidElementId(normalized.id)) {
    throw new Error('Недопустимый идентификатор кнопки: "' + normalized.id + '"');
  }
  if (normalized.label === '') {
    throw new Error('У кнопки "' + normalized.id + '" нет надписи (label).');
  }
  // Пустые значения — не ошибка: их место занимают умолчания схемы
  // (`resolveAction`). Недопустимый формат непустого значения — ошибка:
  // событие уходит в subject NATS, а узел — в `element_id` события.
  if (normalized.event !== '' && !isValidElementId(normalized.event)) {
    throw new Error(
      'Недопустимое событие кнопки "' + normalized.id + '": "' + normalized.event + '"'
    );
  }
  if (normalized.elementId !== '' && !isValidElementId(normalized.elementId)) {
    throw new Error(
      'Недопустимый узел кнопки "' + normalized.id + '": "' + normalized.elementId + '"'
    );
  }
  if (normalized.role !== '' && !isValidRole(normalized.role)) {
    throw new Error('Недопустимая роль кнопки: "' + normalized.role + '"');
  }
  if (normalized.icon !== '' && !ACTION_ICON_PATTERN.test(normalized.icon)) {
    throw new Error('Недопустимое имя иконки кнопки: "' + normalized.icon + '"');
  }
  if (
    normalized.counterpartEvent !== '' &&
    !isValidElementId(normalized.counterpartEvent)
  ) {
    throw new Error(
      'Недопустимое событие второй стороны: "' + normalized.counterpartEvent + '"'
    );
  }
  if (
    normalized.counterpartElementId !== '' &&
    !isValidElementId(normalized.counterpartElementId)
  ) {
    throw new Error(
      'Недопустимый узел второй стороны: "' + normalized.counterpartElementId + '"'
    );
  }
  if (normalized.startsProcess !== '' && !isValidElementId(normalized.startsProcess)) {
    throw new Error(
      'Недопустимый запускаемый процесс кнопки: "' + normalized.startsProcess + '"'
    );
  }
  // Событие второй стороны без узла (и наоборот) — недописанная пара: событие
  // адресуется конкретному узлу чужого экземпляра, без узла оно не сработает.
  if (
    (normalized.counterpartEvent === '') !==
    (normalized.counterpartElementId === '')
  ) {
    throw new Error(
      'Событие и узел второй стороны задаются вместе ("' +
        normalized.counterpartEvent +
        '" / "' +
        normalized.counterpartElementId +
        '").'
    );
  }

  return normalized;
}

/**
 * Проверяет кнопку, не выбрасывая исключение.
 *
 * @param {object} action Кнопка.
 * @returns {boolean}
 */
export function isValidAction(action) {
  try {
    normalizeAction(action);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Собирает все кнопки схемы в порядке появления в XML.
 *
 * Чтение идёт по DOM: кнопка вложена в `bpmn:extensionElements` узла, а не
 * лежит атрибутом на самом узле (как роль), поэтому «плоский» разбор по `id`
 * здесь не работает.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Array<{elementId: string, action: object}>} Кнопки с узлами-хостами.
 */
export function listActions(xml) {
  if (typeof xml !== 'string') return [];

  const doc = parseXml(xml);
  if (!doc) return [];

  return Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === ACTION_LOCAL_NAME)
    .map((node) => ({ elementId: extensionOwnerId(node), action: actionFromNode(node) }))
    .filter((item) => item.elementId !== '');
}

/**
 * Кнопки узла из схемы.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId Идентификатор узла (`element_id`).
 * @returns {Array<object>} Кнопки с полями `ACTION_FIELDS` (возможно, пусто).
 */
export function getElementActions(xml, elementId) {
  if (typeof xml !== 'string' || !elementId) return [];

  return listActions(xml)
    .filter((item) => item.elementId === elementId)
    .map((item) => item.action);
}

/**
 * Кнопка узла по её ключу (`id`).
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId Идентификатор узла.
 * @param {string} actionId Ключ кнопки (`sendToSupplier`).
 * @returns {object|null} Кнопка либо `null`.
 */
export function getElementAction(xml, elementId, actionId) {
  if (!actionId) return null;

  return (
    getElementActions(xml, elementId).find((action) => action.id === actionId) || null
  );
}

/**
 * Возвращает карту кнопок схемы: `{ [element_id]: [кнопка, ...] }`.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Object<string, Array<object>>} Кнопки по идентификаторам узлов.
 */
export function getActionAssignments(xml) {
  const assignments = {};

  listActions(xml).forEach((item) => {
    assignments[item.elementId] = [...(assignments[item.elementId] || []), item.action];
  });

  return assignments;
}

/**
 * Кнопка запуска процесса.
 *
 * Конвенция клиента: кнопка, объявленная на стартовом событии процесса,
 * описывает **запуск** этого процесса — надпись кнопки инициатора, его роль
 * (у события нет `resourceRole`, поэтому роль указана в самой кнопке), а также
 * событие и узел первого шага: движок переводит токен двумя событиями
 * (`StartProcess` на стартовое событие, затем событие первого шага).
 *
 * Пара «событие + узел» может быть и не записана: у стартового события ровно
 * одна исходящая связь, поэтому её дополняет `resolveAction` (`CompleteBlock` и
 * первый блок процесса).
 *
 * @param {string} xml BPMN-схема.
 * @returns {{elementId: string, action: object}|null} Кнопка старта с
 *   узлом-хостом (стартовым событием) либо `null`, если её нет.
 */
export function getStartAction(xml) {
  if (typeof xml !== 'string') return null;

  const doc = parseXml(xml);
  if (!doc) return null;

  const process = firstProcess(doc);
  if (!process) return null;

  const startIds = elementChildren(process)
    .filter((child) => getLocalName(child) === 'startEvent')
    .map((child) => child.getAttribute('id'))
    .filter(Boolean);

  if (startIds.length === 0) return null;

  return listActions(xml).find((item) => startIds.indexOf(item.elementId) !== -1) || null;
}

/**
 * Назначает (заменяет, снимает) кнопки узла в XML.
 *
 * Правка, как и у роли с триггером, выполняется текстом: схема пользователя
 * должна отличаться от исходной ровно на добавленный (изменённый) фрагмент, а
 * `DOMParser` + `XMLSerializer` переформатировали бы всю схему целиком. Кнопки
 * пишутся канонической формой `<act:userAction ... />` внутри
 * `bpmn:extensionElements` узла; контейнер создаётся при необходимости, а в
 * `bpmn:definitions` добавляется объявление namespace `xmlns:act`. Чужие
 * расширения узла (`trg:processTrigger`, `camunda:*`) сохраняются.
 *
 * Список кнопок заменяется целиком: кабинет и инспектор редактируют кнопки
 * узла как список, поэтому «полуприменённое» состояние (часть старых, часть
 * новых) в схему не попадает. Пустой список снимает все кнопки узла. Пустые
 * `event`/`elementId` в XML не пишутся: их место занимают умолчания схемы, и
 * кнопка «выполнить шаг» остаётся короткой строкой.
 *
 * @param {string} xml BPMN-схема.
 * @param {string} elementId Идентификатор узла (`element_id`).
 * @param {Array<object>} [actions=[]] Кнопки (`ACTION_FIELDS`) либо `[]`.
 * @returns {string} Схема с изменёнными кнопками (та же строка, если менять нечего).
 * @throws {Error} пустая схема, узел не найден, недопустимая кнопка, узел не
 *   является узлом потока (последовательный поток не активируется).
 */
export function setElementActions(xml, elementId, actions = []) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('Пустая BPMN-схема: настройка кнопок участников невозможна.');
  }

  const range = readElementRange(xml, elementId);
  if (!range) {
    throw new Error('Элемент с идентификатором "' + elementId + '" не найден в схеме.');
  }

  const list = (Array.isArray(actions) ? actions : [actions]).filter(
    (action) => action && typeof action === 'object'
  );

  const extensionElements = findExtensionElementsTag(xml, range);
  const existing = extensionElements ? findActions(xml, extensionElements) : [];

  if (list.length === 0) {
    // Снять кнопки можно у любого узла (например, чтобы починить схему, где их
    // записали в `sequenceFlow` вручную), а назначить — только узлу потока.
    if (existing.length === 0) return xml;

    return removeActions(xml, existing);
  }

  if (!isActionHostType(range.name)) {
    throw new Error(
      'Кнопка участника назначается только узлам потока (задача, событие, шлюз, подпроцесс), а "' +
        elementId +
        '" — ' +
        range.name +
        '.'
    );
  }

  const tags = list.map((action) =>
    buildActionTag(ACTION_TAG_NAME, normalizeAction(action))
  );

  if (existing.length === 0) {
    const patched = extensionElements
      ? insertIntoExtensionElements(xml, extensionElements, tags)
      : insertExtensionElements(xml, range, tags);

    return ensureNamespace(patched, ACTION_NAMESPACE_PREFIX, ACTION_NAMESPACE);
  }

  // Прежние теги убираются первыми, а границы узла и контейнера пересчитываются
  // на уже правленой строке: иначе смещения новых тегов разъехались бы.
  const cleared = removeActions(xml, existing);
  const clearedRange = readElementRange(cleared, elementId);
  const clearedExtensionElements = findExtensionElementsTag(cleared, clearedRange);
  const patched = clearedExtensionElements
    ? insertIntoExtensionElements(cleared, clearedExtensionElements, tags)
    : insertExtensionElements(cleared, clearedRange, tags);

  return ensureNamespace(patched, ACTION_NAMESPACE_PREFIX, ACTION_NAMESPACE);
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

/** Имя дочернего тега с тем же namespace-префиксом, что у родительского. */
function prefixedTagName(elementTagName, localName) {
  const colon = String(elementTagName || '').indexOf(':');

  return colon === -1 ? localName : elementTagName.slice(0, colon + 1) + localName;
}

/** Каноническая запись роли: `<bpmn:potentialOwner name="ROLE" />`. */
function buildOwnerTag(tag, role) {
  return '<' + tag + ' name="' + role + '" />';
}

/**
 * Вставляет дочерние элементы в узел перед закрывающим тегом, сохраняя отступы.
 *
 * @param {string} xml схема.
 * @param {Object} range границы узла (или контейнера расширений).
 * @param {string|string[]} childTag каноническая запись одного или нескольких
 *   дочерних элементов (несколько — у узла может быть несколько кнопок).
 */
function insertIntoElement(xml, range, childTag) {
  const childTags = toTagList(childTag);

  if (range.selfClosing) {
    const head = range.openTag.slice(0, -2).replace(/\s+$/, '');

    return (
      xml.slice(0, range.openStart) +
      head +
      '>' +
      childTags.join('') +
      '</' +
      range.name +
      '>' +
      xml.slice(range.bodyStart)
    );
  }

  const lineStart = xml.lastIndexOf('\n', range.closeStart) + 1;
  const indent = xml.slice(lineStart, range.closeStart);

  if (/^\s*$/.test(indent) && lineStart > range.bodyStart) {
    return (
      xml.slice(0, lineStart) +
      indent +
      '  ' +
      childTags.join('\n' + indent + '  ') +
      '\n' +
      xml.slice(lineStart)
    );
  }

  return xml.slice(0, range.closeStart) + childTags.join('') + xml.slice(range.closeStart);
}

/** Удаляет дочерний элемент вместе с «осиротевшим» переводом строки, если он остался. */
function removeInlineElement(xml, existing) {
  const lineStart = xml.lastIndexOf('\n', existing.start) + 1;
  const before = xml.slice(lineStart, existing.start);
  const rest = xml.slice(existing.end);
  const lineEnd = rest.indexOf('\n');

  if (/^\s*$/.test(before) && lineEnd !== -1 && /^\s*$/.test(rest.slice(0, lineEnd))) {
    return xml.slice(0, lineStart) + rest.slice(lineEnd + 1);
  }

  return xml.slice(0, existing.start) + rest;
}

/* ------------------------------------------------------------------ *
 * Внутренние помощники расширений узла
 * ------------------------------------------------------------------ */

/**
 * Идентификатор узла-владельца расширения.
 *
 * Триггер и кнопки лежат внутри `bpmn:extensionElements` узла, то есть
 * владелец — «дед» элемента расширения. Если разметка неожиданная (элемент
 * записан без контейнера), поднимаемся к ближайшему предку с `id`.
 *
 * @param {Node} node DOM-узел расширения (`trg:processTrigger`, `act:userAction`).
 * @returns {string} Идентификатор узла-владельца либо `''`.
 */
function extensionOwnerId(node) {
  let current = node ? node.parentNode : null;

  while (current && typeof current.getAttribute === 'function') {
    const id = current.getAttribute('id');
    if (id) return id;
    current = current.parentNode;
  }

  return '';
}

/**
 * Читает поля кнопки из DOM-узла `act:userAction`.
 *
 * @param {Node} node DOM-узел кнопки.
 * @returns {object} Кнопка с полями `ACTION_FIELDS` (пустые — `''`).
 */
function actionFromNode(node) {
  const action = {};

  ACTION_FIELDS.forEach((name) => {
    action[name] = String(node.getAttribute(name) || '');
  });

  return action;
}

/**
 * Читает поля кнопки из строки атрибутов открывающего тега.
 *
 * @param {string} attributes Атрибуты тега (` id="..." label="..." `).
 * @returns {object} Кнопка с полями `ACTION_FIELDS` (пустые — `''`).
 */
function actionFromAttributes(attributes) {
  const action = {};

  ACTION_FIELDS.forEach((name) => {
    const hit = new RegExp('\\s' + name + '="([^"]*)"').exec(attributes || '');
    action[name] = hit ? unescapeXmlAttribute(hit[1]) : '';
  });

  return action;
}

/**
 * Каноническая запись кнопки: `<act:userAction field="..." />`.
 *
 * Записываются только непустые поля и в порядке `ACTION_FIELDS` — так схема
 * пользователя остаётся предсказуемой, а сравнение «изменилось ли» сводится к
 * сравнению разобранных полей.
 */
function buildActionTag(tag, action) {
  const attributes = ACTION_FIELDS.filter((name) => action[name] !== '').map(
    (name) => name + '="' + escapeXmlAttribute(action[name]) + '"'
  );

  return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + ' />';
}

/**
 * Границы всех кнопок внутри контейнера расширений.
 *
 * @param {string} xml схема.
 * @param {Object} extensionElements границы контейнера из `findExtensionElementsTag`.
 * @returns {Array<{start: number, end: number, tag: string, action: object}>}
 *   Кнопки в порядке появления; пустой массив, если их нет.
 */
function findActions(xml, extensionElements) {
  if (!extensionElements || extensionElements.selfClosing) return [];

  const body = xml.slice(extensionElements.innerStart, extensionElements.innerEnd);
  const pattern = new RegExp(
    '<([A-Za-z_][\\w.-]*:)?' + ACTION_LOCAL_NAME + '(\\s[^>]*?)?(/?)>',
    'g'
  );
  const found = [];
  let match = pattern.exec(body);

  while (match) {
    const start = extensionElements.innerStart + match.index;
    const tag = (match[1] || '') + ACTION_LOCAL_NAME;
    let end = start + match[0].length;

    if (match[3] !== '/') {
      const closeStart = xml.indexOf('</' + tag + '>', end);
      end = closeStart === -1 ? end : closeStart + tag.length + 3;
    }

    found.push({ start, end, tag, action: actionFromAttributes(match[2] || '') });
    pattern.lastIndex = end - extensionElements.innerStart;
    match = pattern.exec(body);
  }

  return found;
}

/**
 * Удаляет перечисленные кнопки из схемы (с конца, чтобы смещения не съехали).
 *
 * @param {string} xml схема.
 * @param {Array<{start: number, end: number}>} existing границы из `findActions`.
 * @returns {string} схема без кнопок.
 */
function removeActions(xml, existing) {
  let cleared = xml;

  for (let index = existing.length - 1; index >= 0; index -= 1) {
    cleared = removeInlineElement(cleared, existing[index]);
  }

  return cleared;
}

/**
 * Приводит запись расширения к массиву тегов.
 *
 * Вставка расширений умеет писать сразу несколько тегов (у узла может быть
 * несколько кнопок), а триггер передаёт один — нормализация здесь, чтобы
 * вызывающий код не дублировал `Array.isArray`.
 */
function toTagList(tags) {
  return Array.isArray(tags) ? tags : [tags];
}

/**
 * Читает поля триггера из DOM-узла.
 *
 * @param {Node} node DOM-узел `trg:processTrigger`.
 * @returns {object} Триггер с полями `TRIGGER_FIELDS` (пустые — `''`).
 */
function triggerFromNode(node) {
  const trigger = {};

  TRIGGER_FIELDS.forEach((name) => {
    trigger[name] = String(node.getAttribute(name) || '');
  });

  return trigger;
}

/**
 * Читает поля триггера из строки атрибутов открывающего тега.
 *
 * @param {string} attributes Атрибуты тега (` targetProcessId="..." `).
 * @returns {object} Триггер с полями `TRIGGER_FIELDS` (пустые — `''`).
 */
function triggerFromAttributes(attributes) {
  const trigger = {};

  TRIGGER_FIELDS.forEach((name) => {
    const hit = new RegExp('\\s' + name + '="([^"]*)"').exec(attributes || '');
    trigger[name] = hit ? unescapeXmlAttribute(hit[1]) : '';
  });

  return trigger;
}

/** Экранирует значение атрибута для записи в XML. */
function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Обратная операция к `escapeXmlAttribute`. */
function unescapeXmlAttribute(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Каноническая запись триггера: `<trg:processTrigger field="..." />`.
 *
 * Записываются только непустые поля и в порядке `TRIGGER_FIELDS` — так схема
 * пользователя остаётся предсказуемой, а сравнение «изменилось ли» сводится к
 * сравнению разобранных полей.
 */
function buildTriggerTag(tag, trigger) {
  const attributes = TRIGGER_FIELDS.filter((name) => trigger[name] !== '').map(
    (name) => name + '="' + escapeXmlAttribute(trigger[name]) + '"'
  );

  return '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + ' />';
}

/** Отступ строки, с которой начинается элемент (`''`, если элемент в середине строки). */
function lineIndent(xml, index) {
  const lineStart = xml.lastIndexOf('\n', index) + 1;
  const indent = xml.slice(lineStart, index);

  return /^\s*$/.test(indent) ? indent : '';
}

/**
 * Сравнивает прочитанный из XML триггер с канонической формой.
 *
 * Список ключей payload сравнивается после нормализации, а остальные поля —
 * после `trim`: в схеме они могут быть записаны с пробелами или в другом
 * порядке атрибутов, и это не должно считаться изменением.
 *
 * @param {object} existing Триггер, прочитанный из XML.
 * @param {object} normalized Канонический триггер из `normalizeTrigger`.
 * @returns {boolean} `true`, если триггер уже записан в этой схеме.
 */
function isSameTrigger(existing, normalized) {
  return TRIGGER_FIELDS.every((name) => {
    const value =
      name === 'payloadKeys'
        ? normalizePayloadKeys(existing[name])
        : String(existing[name] == null ? '' : existing[name]).trim();

    return value === normalized[name];
  });
}

/**
 * Границы контейнера расширений (`bpmn:extensionElements`) внутри узла.
 *
 * @param {string} xml схема.
 * @param {Object} range границы узла из `readElementRange`.
 * @returns {{start: number, end: number, innerStart: number, innerEnd: number,
 *            tag: string, selfClosing: boolean}|null}
 */
function findExtensionElementsTag(xml, range) {
  if (!range || range.selfClosing || range.closeStart === -1) return null;

  const body = xml.slice(range.bodyStart, range.closeStart);
  const open = body.match(
    new RegExp('<([A-Za-z_][\\w.-]*:)?' + EXTENSION_ELEMENTS_LOCAL_NAME + '(\\s[^>]*?)?(/?)>')
  );
  if (!open) return null;

  const start = range.bodyStart + open.index;
  const end = start + open[0].length;
  const tag = (open[1] || '') + EXTENSION_ELEMENTS_LOCAL_NAME;

  if (open[3] === '/') {
    return { start, end, innerStart: end, innerEnd: end, tag, selfClosing: true };
  }

  // `extensionElements` внутри узла не вкладываются друг в друга, поэтому
  // закрывающий тег ищется простым `indexOf` (в отличие от узлов потока).
  const closeStart = xml.indexOf('</' + tag + '>', end);
  if (closeStart === -1) return null;

  return {
    start,
    end: closeStart + tag.length + 3,
    innerStart: end,
    innerEnd: closeStart,
    tag,
    selfClosing: false,
  };
}

/**
 * Границы триггера внутри контейнера расширений.
 *
 * @param {string} xml схема.
 * @param {Object} extensionElements границы контейнера из `findExtensionElementsTag`.
 * @returns {{start: number, end: number, tag: string, trigger: object}|null}
 */
function findTriggerTag(xml, extensionElements) {
  if (!extensionElements || extensionElements.selfClosing) return null;

  const body = xml.slice(extensionElements.innerStart, extensionElements.innerEnd);
  const open = body.match(
    new RegExp('<([A-Za-z_][\\w.-]*:)?' + TRIGGER_LOCAL_NAME + '(\\s[^>]*?)?(/?)>')
  );
  if (!open) return null;

  const start = extensionElements.innerStart + open.index;
  const end = start + open[0].length;
  const tag = (open[1] || '') + TRIGGER_LOCAL_NAME;
  const trigger = triggerFromAttributes(open[2] || '');

  if (open[3] === '/') return { start, end, tag, trigger };

  const closeStart = xml.indexOf('</' + tag + '>', end);

  return {
    start,
    end: closeStart === -1 ? end : closeStart + tag.length + 3,
    tag,
    trigger,
  };
}

/**
 * Вставляет элементы расширений в существующий контейнер узла.
 *
 * @param {string} xml схема.
 * @param {Object} extensionElements границы контейнера из `findExtensionElementsTag`.
 * @param {string|string[]} tags каноническая запись элементов расширения
 *   (`trg:processTrigger`, `act:userAction`).
 * @returns {string} схема с добавленными расширениями.
 */
function insertIntoExtensionElements(xml, extensionElements, tags) {
  const list = toTagList(tags);

  if (extensionElements.selfClosing) {
    const indent = lineIndent(xml, extensionElements.start);
    const inner = indent + '  ';

    return (
      xml.slice(0, extensionElements.start) +
      '<' +
      extensionElements.tag +
      '>\n' +
      inner +
      list.join('\n' + inner) +
      '\n' +
      indent +
      '</' +
      extensionElements.tag +
      '>' +
      xml.slice(extensionElements.end)
    );
  }

  return insertIntoElement(
    xml,
    {
      name: extensionElements.tag,
      bodyStart: extensionElements.innerStart,
      closeStart: extensionElements.innerEnd,
      selfClosing: false,
    },
    list
  );
}

/**
 * Создаёт контейнер расширений узла вместе с элементами расширения.
 *
 * Контейнер пишется с тем же namespace-префиксом, что и сам узел
 * (`bpmn:extensionElements`), и с отступом на два пробела глубже узла — как
 * это делает сам `bpmn-js` при сохранении схемы.
 *
 * @param {string} xml схема.
 * @param {Object} range границы узла из `readElementRange`.
 * @param {string|string[]} tags каноническая запись элементов расширения.
 * @returns {string} схема с созданным контейнером и расширениями.
 */
function insertExtensionElements(xml, range, tags) {
  const list = toTagList(tags);
  const wrapper = prefixedTagName(range.name, EXTENSION_ELEMENTS_LOCAL_NAME);
  const open = '<' + wrapper + '>';
  const close = '</' + wrapper + '>';
  const indent = lineIndent(xml, range.selfClosing ? range.openStart : range.closeStart);
  const inner = indent + '  ';

  if (!range.selfClosing && indent === '') {
    // Узел (и его содержимое) записаны одной строкой — расширения вставляются
    // компактно, чтобы не разрывать строку переводами.
    return (
      xml.slice(0, range.closeStart) +
      open +
      list.join('') +
      close +
      xml.slice(range.closeStart)
    );
  }

  if (range.selfClosing) {
    const head = range.openTag.slice(0, -2).replace(/\s+$/, '');

    return (
      xml.slice(0, range.openStart) +
      head +
      '>\n' +
      inner +
      open +
      '\n' +
      inner +
      '  ' +
      list.join('\n' + inner + '  ') +
      '\n' +
      inner +
      close +
      '\n' +
      indent +
      '</' +
      range.name +
      '>' +
      xml.slice(range.bodyStart)
    );
  }

  const lineStart = xml.lastIndexOf('\n', range.closeStart) + 1;

  return (
    xml.slice(0, lineStart) +
    inner +
    open +
    '\n' +
    inner +
    '  ' +
    list.join('\n' + inner + '  ') +
    '\n' +
    inner +
    close +
    '\n' +
    xml.slice(lineStart)
  );
}

/**
 * Объявляет namespace расширения в корневом элементе схемы.
 *
 * Без `xmlns:trg` / `xmlns:act` схема перестаёт быть корректной (`bpmn-js` не
 * прочитает элемент), поэтому объявление добавляется вместе с первым
 * элементом расширения.
 *
 * @param {string} xml схема.
 * @param {string} prefix префикс namespace-а (`trg`, `act`).
 * @param {string} uri URI namespace-а.
 * @returns {string} схема с объявленным namespace (та же строка, если он уже есть).
 */
function ensureNamespace(xml, prefix, uri) {
  const declared = new RegExp('xmlns:' + prefix + '\\s*=');
  if (declared.test(xml)) return xml;

  const hit = /<(?!\?|!)([A-Za-z_][\w.:-]*)/.exec(xml);
  if (!hit) return xml;

  // Ищем закрывающую скобку открывающего тега, не заходя внутрь значений
  // атрибутов (в них может встретиться `>`).
  let cursor = hit.index + hit[0].length;
  let quote = '';

  while (cursor < xml.length) {
    const char = xml.charAt(cursor);

    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      break;
    }

    cursor += 1;
  }

  return (
    xml.slice(0, cursor) + ' xmlns:' + prefix + '="' + uri + '"' + xml.slice(cursor)
  );
}

/**
 * Объявляет namespace триггера в корневом элементе схемы.
 *
 * @param {string} xml схема.
 * @returns {string} схема с объявленным `xmlns:trg`.
 */
function ensureTriggerNamespace(xml) {
  return ensureNamespace(xml, TRIGGER_NAMESPACE_PREFIX, TRIGGER_NAMESPACE);
}

/* ------------------------------------------------------------------ *
 * Совместимость схемы с движком оркестратора
 * ------------------------------------------------------------------ */

/**
 * Локальные имена узлов потока, которые разбирает движок оркестратора.
 *
 * Движок (`bpm-engine-bpmn`) обходит **прямых детей** `<bpmn:process>` и знает
 * ровно эти типы (плюс `sequenceFlow` — связи). Всё остальное он пропускает
 * молча, без ошибки разбора: узел другого типа (`bpmn:task` из палитры
 * редактора, `bpmn:scriptTask`, подпроцесс…) для движка не существует, а
 * связи, которые в него ведут или из него выходят, становятся «висячими» —
 * компилятор отвечает `SequenceFlowSourceNotFound` /
 * `SequenceFlowTargetNotFound` и **не компилирует определение целиком**.
 *
 * Отсюда правило клиента: схему с таким узлом в оркестратор отправлять нельзя.
 * Движок при этом отвечает `202 Accepted` (шлюз публикует событие в NATS, и на
 * этом его работа заканчивается), поэтому отказ виден только в логе движка, а
 * в интерфейсе выглядит как «ничего не произошло».
 */
export const ENGINE_FLOW_NODE_TYPES = [
  'startEvent',
  'endEvent',
  'serviceTask',
  'userTask',
  'exclusiveGateway',
  'parallelGateway',
];

/** Перечисление поддерживаемых типов — для сообщений пользователю. */
const ENGINE_FLOW_NODE_LIST = ENGINE_FLOW_NODE_TYPES.join(', ');

/**
 * Коды проблем схемы.
 *
 * Совпадают с кодами компилятора движка (`ErrorCode`) там, где такое
 * соответствие есть: отчёт клиента и отказ движка читаются одинаково.
 * `UnsupportedElement` в движке объявлен, но не используется (неизвестные типы
 * он просто пропускает) — клиент находит это первым, чтобы отказ был объяснён.
 */
export const SCHEMA_PROBLEM = {
  INVALID_XML: 'InvalidXml',
  NO_PROCESS: 'NoProcess',
  MISSING_ID: 'MissingAttribute',
  UNSUPPORTED_NODE: 'UnsupportedElement',
  NO_START_EVENT: 'NoStartEvent',
  MULTIPLE_START_EVENTS: 'MultipleStartEvents',
  NO_END_EVENT: 'NoEndEvent',
  FLOW_SOURCE_NOT_FOUND: 'SequenceFlowSourceNotFound',
  FLOW_TARGET_NOT_FOUND: 'SequenceFlowTargetNotFound',
  FLOW_SELF_LOOP: 'SequenceFlowSelfLoop',
  ORPHAN_NODE: 'OrphanNode',
  DEAD_END: 'DeadEnd',
  EXCLUSIVE_GATEWAY_NO_DEFAULT: 'ExclusiveGatewayNoDefault',
  PARALLEL_GATEWAY_INVALID_SHAPE: 'ParallelGatewayInvalidShape',
};

/**
 * Запись отчёта о схеме.
 *
 * `order` — позиция узла/связи среди детей процесса: по ней отчёт сортируется
 * в порядке схемы, а не в порядке проверок.
 */
function schemaProblem(code, message, extra = {}) {
  return {
    code,
    message,
    order: extra.order == null ? -1 : extra.order,
    elementId: extra.elementId || '',
    flowId: extra.flowId || '',
    hint: extra.hint || '',
  };
}

/** Дети элемента процесса (без текстовых узлов и комментариев). */
function elementChildren(node) {
  return Array.from((node && node.children) || []).filter(
    (child) => child.nodeType === 1
  );
}

/** Первый `<bpmn:process>` документа — ровно его и обходит движок. */
function firstProcess(doc) {
  return Array.from(doc.getElementsByTagName('*')).find(
    (node) => getLocalName(node) === 'process'
  );
}

/**
 * Узел потока по локальному имени из XML.
 *
 * Отличие от `isFlowElementType`: здесь имя приходит из XML, где локальные
 * имена в camelCase (`userTask`, `startEvent`, `subProcess`), а суффиксы —
 * заглавными (`Task`, `Event`, `Gateway`). Сравнение без учёта регистра
 * покрывает и типы, которых движок не знает (`task`, `scriptTask`,
 * `subProcess`, `callActivity`, `transaction`) — про них и нужно рассказать
 * пользователю.
 *
 * @param {string} localName локальное имя элемента.
 * @returns {boolean} узел ли это потока управления.
 */
function isFlowNodeLocalName(localName) {
  const name = String(localName || '').toLowerCase();

  return (
    name.endsWith('task') ||
    name.endsWith('event') ||
    name.endsWith('gateway') ||
    name === 'subprocess' ||
    name === 'adhocsubprocess' ||
    name === 'callactivity' ||
    name === 'transaction'
  );
}

/**
 * Читает связь (`sequenceFlow`).
 *
 * `name="default"` — второй способ пометить связь шлюза «по умолчанию»
 * (первый — атрибут `default` у самого шлюза), движок понимает оба.
 */
function readFlowElement(node) {
  return {
    id: node.getAttribute('id') || '',
    sourceRef: node.getAttribute('sourceRef') || '',
    targetRef: node.getAttribute('targetRef') || '',
    isDefault:
      (node.getAttribute('name') || '').toLowerCase() === 'default',
    hasCondition: elementChildren(node).some(
      (child) => getLocalName(child) === 'conditionExpression'
    ),
  };
}

/**
 * Проверяет схему на совместимость с движком оркестратора.
 *
 * Повторяет правила компилятора `bpm-engine-bpmn`: ровно один стартовый узел,
 * хотя бы один `endEvent`, связи без «висячих» ссылок, соединённость узлов,
 * достижимость до конца, форма шлюзов. Первым проверяется то, о чём движок
 * молчит, — типы узлов, которые он не разбирает.
 *
 * @param {string} xml BPMN-схема.
 * @returns {{ok: boolean, problems: Array<{code: string, message: string,
 *   elementId: string, flowId: string, hint: string}>}} отчёт: `ok === false`,
 *   если определение в движке не скомпилируется.
 */
export function validateEngineSchema(xml) {
  const doc = parseXml(xml);

  if (!doc) {
    return {
      ok: false,
      problems: [
        schemaProblem(
          SCHEMA_PROBLEM.INVALID_XML,
          'Схему не удалось разобрать как XML — движок ответит ошибкой компиляции.'
        ),
      ],
    };
  }

  const process = firstProcess(doc);

  if (!process) {
    return {
      ok: false,
      problems: [
        schemaProblem(
          SCHEMA_PROBLEM.NO_PROCESS,
          'В схеме нет процесса (<bpmn:process>): компилировать нечего.'
        ),
      ],
    };
  }

  const problems = [];
  const nodes = new Map();
  const unsupported = new Map();
  const flows = [];

  elementChildren(process).forEach((child, order) => {
    const type = getLocalName(child);

    if (type === 'sequenceFlow') {
      flows.push({ ...readFlowElement(child), order });
      return;
    }

    // Служебные узлы процесса (`documentation`, `extensionElements`,
    // `laneSet`, `dataObject`, аннотации) движок тоже пропускает, но связей в
    // них не бывает — это не ошибка.
    if (!isFlowNodeLocalName(type)) return;

    const id = child.getAttribute('id');

    if (!id) {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.MISSING_ID,
          `Узел <bpmn:${type}> без идентификатора: движок адресует узлы по id.`,
          { order }
        )
      );
      return;
    }

    if (!ENGINE_FLOW_NODE_TYPES.includes(type)) {
      unsupported.set(id, { id, type, order });
      return;
    }

    nodes.set(id, {
      id,
      type,
      order,
      defaultFlowId: child.getAttribute('default') || '',
      incoming: [],
      outgoing: [],
    });
  });

  unsupported.forEach(({ id, type, order }) => {
    problems.push(
      schemaProblem(
        SCHEMA_PROBLEM.UNSUPPORTED_NODE,
        `Узел ${id} типа <bpmn:${type}> движок не разбирает: поддерживаются ` +
          `${ENGINE_FLOW_NODE_LIST}. Связи через него становятся висячими, и ` +
          'определение не компилируется целиком.',
        {
          order,
          elementId: id,
          hint:
            'Замените узел на User task (или Service task): базовый bpmn:task ' +
            'движок молча пропускает.',
        }
      )
    );
  });

  flows.forEach((flow) => {
    const { id, sourceRef, targetRef, order } = flow;
    const source = nodes.get(sourceRef);
    const target = nodes.get(targetRef);

    if (source) source.outgoing.push(flow);
    else if (!unsupported.has(sourceRef)) {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.FLOW_SOURCE_NOT_FOUND,
          `Связь ${id} начинается в ${sourceRef || '(sourceRef не задан)'}, ` +
            'которого нет среди узлов процесса.',
          { order, flowId: id, elementId: sourceRef }
        )
      );
    }

    if (target) target.incoming.push(flow);
    else if (!unsupported.has(targetRef)) {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.FLOW_TARGET_NOT_FOUND,
          `Связь ${id} ведёт в ${targetRef || '(targetRef не задан)'}, ` +
            'которого нет среди узлов процесса.',
          { order, flowId: id, elementId: targetRef }
        )
      );
    }

    if (sourceRef !== '' && sourceRef === targetRef) {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.FLOW_SELF_LOOP,
          `Связь ${id} замкнута сама на себя (${sourceRef}): ` +
            'движок такие связи не поддерживает.',
          { order, flowId: id, elementId: sourceRef }
        )
      );
    }
  });

  const list = Array.from(nodes.values());
  const starts = list.filter((node) => node.type === 'startEvent');
  const ends = list.filter((node) => node.type === 'endEvent');

  if (starts.length === 0) {
    problems.push(
      schemaProblem(
        SCHEMA_PROBLEM.NO_START_EVENT,
        'В процессе нет ни одного startEvent — движку не с чего начинать.'
      )
    );
  } else if (starts.length > 1) {
    starts.forEach((node) => {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.MULTIPLE_START_EVENTS,
          `В процессе ${starts.length} стартовых события (${node.id}): ` +
            'движок поддерживает ровно одно.',
          { order: node.order, elementId: node.id }
        )
      );
    });
  }

  if (ends.length === 0) {
    problems.push(
      schemaProblem(
        SCHEMA_PROBLEM.NO_END_EVENT,
        'В процессе нет ни одного endEvent.'
      )
    );
  }

  const startId = starts.length > 0 ? starts[0].id : null;
  const endIds = new Set(ends.map((node) => node.id));

  // Соединённость: узел без входящей связи (кроме стартового) и узел без
  // исходящей (кроме конечного) движок считает ошибкой `OrphanNode`.
  list.forEach((node) => {
    if (node.id !== startId && node.incoming.length === 0) {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.ORPHAN_NODE,
          `Узел ${node.id} не имеет входящей связи.`,
          {
            order: node.order,
            elementId: node.id,
            hint: 'Узел не соединён с маршрутом: добавьте sequence flow.',
          }
        )
      );
    }

    if (!endIds.has(node.id) && node.outgoing.length === 0) {
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.ORPHAN_NODE,
          `Узел ${node.id} не имеет исходящей связи.`,
          {
            order: node.order,
            elementId: node.id,
            hint: 'Узел не соединён с маршрутом: добавьте sequence flow.',
          }
        )
      );
    }
  });

  nodes.forEach((node) => {
    if (node.type === 'exclusiveGateway') {
      const outgoing = node.outgoing;
      const defaults = outgoing.filter(
        (flow) => flow.isDefault || flow.id === node.defaultFlowId
      );

      // Движок требует связь по умолчанию, если хотя бы одна исходящая связь
      // шлюза не несёт условия (`conditionExpression`).
      if (defaults.length > 1) {
        problems.push(
          schemaProblem(
            SCHEMA_PROBLEM.EXCLUSIVE_GATEWAY_NO_DEFAULT,
            `У шлюза ${node.id} отмечено связей по умолчанию: ${defaults.length}.`,
            { order: node.order, elementId: node.id }
          )
        );
      } else if (
        defaults.length === 0 &&
        outgoing.filter((flow) => flow.hasCondition).length < outgoing.length
      ) {
        problems.push(
          schemaProblem(
            SCHEMA_PROBLEM.EXCLUSIVE_GATEWAY_NO_DEFAULT,
            `У шлюза ${node.id} есть связи без условия и не отмечена связь по умолчанию.`,
            {
              order: node.order,
              elementId: node.id,
              hint: 'Отметьте одну из связей шлюза как default.',
            }
          )
        );
      }
    }

    if (node.type === 'parallelGateway') {
      const incoming = node.incoming.length;
      const outgoing = node.outgoing.length;

      if (incoming === 1 && outgoing < 2) {
        problems.push(
          schemaProblem(
            SCHEMA_PROBLEM.PARALLEL_GATEWAY_INVALID_SHAPE,
            `Параллельный шлюз ${node.id} открыт одной связью и не разветвляет ` +
              'поток: нужно минимум 2 исходящих.',
            { order: node.order, elementId: node.id }
          )
        );
      } else if (incoming < 2 && outgoing === 1) {
        problems.push(
          schemaProblem(
            SCHEMA_PROBLEM.PARALLEL_GATEWAY_INVALID_SHAPE,
            `Параллельный шлюз ${node.id} закрыт одной связью и не собирает ` +
              'поток: нужно минимум 2 входящих.',
            { order: node.order, elementId: node.id }
          )
        );
      } else if (incoming !== 1 && outgoing !== 1) {
        problems.push(
          schemaProblem(
            SCHEMA_PROBLEM.PARALLEL_GATEWAY_INVALID_SHAPE,
            `Параллельный шлюз ${node.id} разветвляет и собирает одновременно ` +
              `(${incoming} входящих, ${outgoing} исходящих) — движок это не поддерживает.`,
            {
              order: node.order,
              elementId: node.id,
              hint: 'Разделите вилку и слияние на два шлюза.',
            }
          )
        );
      }
    }
  });

  // Достижимость до конца: движок отвечает `DeadEnd` на узел, из которого
  // `endEvent` не виден, — даже если формально узел соединён.
  if (startId) {
    const reachable = new Set();
    const stack = [startId];

    while (stack.length > 0) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);

      const node = nodes.get(id);
      if (!node) continue;
      node.outgoing.forEach((flow) => stack.push(flow.targetRef));
    }

    const canReachEnd = new Set(endIds);
    let changed = true;

    while (changed) {
      changed = false;
      flows.forEach(({ sourceRef, targetRef }) => {
        if (
          canReachEnd.has(targetRef) &&
          reachable.has(sourceRef) &&
          !canReachEnd.has(sourceRef)
        ) {
          canReachEnd.add(sourceRef);
          changed = true;
        }
      });
    }

    reachable.forEach((id) => {
      if (endIds.has(id) || canReachEnd.has(id)) return;

      const node = nodes.get(id);
      problems.push(
        schemaProblem(
          SCHEMA_PROBLEM.DEAD_END,
          `Из узла ${id} нельзя дойти до endEvent.`,
          { order: node ? node.order : -1, elementId: id }
        )
      );
    });
  }

  // Отчёт — в порядке схемы, а не в порядке проверок: так его читает человек.
  problems.sort((first, second) => first.order - second.order);

  return { ok: problems.length === 0, problems };
}


/* ------------------------------------------------------------------ *
 * Проект: несколько процессов и каталог ролей в одной схеме
 * ------------------------------------------------------------------ */

/**
 * Процессы проекта в порядке документа.
 *
 * Подпись дорожки (`participantName`) берётся из `bpmn:participant` проекта:
 * это название организации, которое видит участник. У одно-процессной схемы
 * кооперации нет, и подписью остаётся имя процесса.
 *
 * @param {string} xml BPMN-схема (проект или обычная схема процесса).
 * @returns {Array<{id: string, name: string, isExecutable: boolean, participantName: string}>}
 */
export function getProjectProcesses(xml) {
  const doc = parseXml(xml);
  if (!doc) return [];

  const participants = {};
  const all = Array.from(doc.getElementsByTagName('*'));

  all
    .filter((node) => getLocalName(node) === 'participant' && node.getAttribute('processRef'))
    .forEach((node) => {
      participants[node.getAttribute('processRef')] = node.getAttribute('name') || '';
    });

  return all
    .filter((node) => getLocalName(node) === 'process')
    .map((node) => {
      const id = node.getAttribute('id') || '';

      return {
        id,
        name: node.getAttribute('name') || id,
        isExecutable: node.getAttribute('isExecutable') !== 'false',
        participantName: participants[id] || '',
      };
    })
    .filter((process) => process.id !== '');
}

/**
 * Владелец каждого элемента: `{elementId: processId}`.
 *
 * Нужен, чтобы разложить роли и кнопки по процессам: в проекте их несколько, и
 * `bpmn:potentialOwner` сам по себе не говорит, чьему процессу принадлежит шаг.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Object<string, string>} например `{Task_QualityControl: 'Process_MilkCustomer_v1'}`.
 */
export function getElementOwners(xml) {
  const doc = parseXml(xml);
  if (!doc) return {};

  const owners = {};

  Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === 'process')
    .forEach((processNode) => {
      const processId = processNode.getAttribute('id') || '';
      if (!processId) return;

      owners[processId] = processId;

      Array.from(processNode.getElementsByTagName('*')).forEach((node) => {
        const id = node.getAttribute && node.getAttribute('id');
        if (id) owners[id] = processId;
      });
    });

  return owners;
}

/**
 * Каталог ролей `role:catalog` процесса (или всех процессов проекта).
 *
 * Роль — это титул: `code` адресует шаг (`potentialOwner`/`userAction`), `title`
 * показывает кабинет. Схема без каталога — не ошибка: клиент возьмёт название
 * из самого `bpmn:potentialOwner/@name` (см. `analyzeProject` в демо-клиенте).
 *
 * @param {string} xml BPMN-схема (проект или процесс).
 * @param {string} [processId] только этот процесс (`''` — все).
 * @returns {Array<{processId: string, code: string, title: string, kind: string, icon: string}>}
 */
export function getRoleCatalog(xml, processId) {
  const doc = parseXml(xml);
  if (!doc) return [];

  const catalog = [];

  Array.from(doc.getElementsByTagName('*'))
    .filter((node) => getLocalName(node) === 'process')
    .forEach((processNode) => {
      const ownerId = processNode.getAttribute('id') || '';
      if (processId && ownerId !== processId) return;

      Array.from(processNode.getElementsByTagName('*'))
        .filter((node) => getLocalName(node) === ROLE_CATALOG_LOCAL_NAME)
        .filter((node) => !node.namespaceURI || node.namespaceURI === ROLE_NAMESPACE)
        .forEach((catalogNode) => {
          Array.from(catalogNode.getElementsByTagName('*'))
            .filter((node) => getLocalName(node) === ROLE_LOCAL_NAME)
            .forEach((role) => {
              const code = (role.getAttribute('code') || '').trim();
              if (!code) return;

              catalog.push({
                processId: ownerId,
                code,
                title: (role.getAttribute('title') || '').trim(),
                kind: (role.getAttribute('kind') || '').trim(),
                icon: (role.getAttribute('icon') || '').trim(),
              });
            });
        });
    });

  return catalog;
}

/**
 * Роли, объявленные прямо в кнопках (`act:userAction/@role`).
 *
 * У события нет `bpmn:potentialOwner` (спецификация BPMN 2.0 разрешает роль
 * только Activity), поэтому роль кнопки старта живёт в самой кнопке. Кабинет
 * должен знать такую роль, даже если её нет в каталоге.
 *
 * @param {string} xml BPMN-схема.
 * @returns {Array<{elementId: string, role: string, label: string}>}
 */
export function getActionRoles(xml) {
  return listActions(xml)
    .filter((entry) => entry.action && entry.action.role)
    .map((entry) => ({
      elementId: entry.elementId,
      role: entry.action.role,
      label: entry.action.label || entry.action.id || '',
    }));
}

/**
 * Проверка проекта: каждый процесс — отдельно, как его увидит движок.
 *
 * Оркестратор читает только первый `bpmn:process`, поэтому валидировать проект
 * целиком бессмысленно: второй процесс для него не существует. Проблемы
 * помечаются идентификатором процесса, чтобы их можно было объяснить человеку.
 *
 * @param {string} projectXml XML проекта.
 * @returns {{ok: boolean, problems: Array<Object>, processes: Array<Object>}}
 */
export function validateProjectSchema(projectXml) {
  const processes = getProjectProcesses(projectXml);
  const problems = [];

  processes.forEach((process) => {
    const report = validateEngineSchema(extractProcessXml(projectXml, process.id));

    report.problems.forEach((problem) => {
      problems.push({ ...problem, processId: process.id, processName: process.name });
    });
  });

  return { ok: problems.length === 0, problems, processes };
}


