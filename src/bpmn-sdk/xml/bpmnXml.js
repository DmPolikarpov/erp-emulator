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
    .find((candidate) => triggerOwnerId(candidate) === elementId);

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
    .map((node) => ({ elementId: triggerOwnerId(node), trigger: triggerFromNode(node) }))
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

/** Вставляет дочерний элемент в узел перед закрывающим тегом, сохраняя отступы. */
function insertIntoElement(xml, range, childTag) {
  if (range.selfClosing) {
    const head = range.openTag.slice(0, -2).replace(/\s+$/, '');

    return (
      xml.slice(0, range.openStart) +
      head +
      '>' +
      childTag +
      '</' +
      range.name +
      '>' +
      xml.slice(range.bodyStart)
    );
  }

  const lineStart = xml.lastIndexOf('\n', range.closeStart) + 1;
  const indent = xml.slice(lineStart, range.closeStart);

  if (/^\s*$/.test(indent) && lineStart > range.bodyStart) {
    return xml.slice(0, lineStart) + indent + '  ' + childTag + '\n' + xml.slice(lineStart);
  }

  return xml.slice(0, range.closeStart) + childTag + xml.slice(range.closeStart);
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
 * Внутренние помощники триггера
 * ------------------------------------------------------------------ */

/**
 * Идентификатор узла-владельца триггера.
 *
 * Триггер всегда лежит внутри `bpmn:extensionElements` узла, то есть владелец
 * — «дед» элемента триггера. Если разметка неожиданная (триггер записан без
 * контейнера), поднимаемся к ближайшему предку с `id`.
 *
 * @param {Node} node DOM-узел триггера.
 * @returns {string} Идентификатор узла-владельца либо `''`.
 */
function triggerOwnerId(node) {
  let current = node ? node.parentNode : null;

  while (current && typeof current.getAttribute === 'function') {
    const id = current.getAttribute('id');
    if (id) return id;
    current = current.parentNode;
  }

  return '';
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
 * Вставляет триггер в существующий контейнер расширений узла.
 *
 * @param {string} xml схема.
 * @param {Object} extensionElements границы контейнера из `findExtensionElementsTag`.
 * @param {string} triggerTag каноническая запись триггера.
 * @returns {string} схема с добавленным триггером.
 */
function insertIntoExtensionElements(xml, extensionElements, triggerTag) {
  if (extensionElements.selfClosing) {
    const indent = lineIndent(xml, extensionElements.start);
    const inner = indent + '  ';

    return (
      xml.slice(0, extensionElements.start) +
      '<' +
      extensionElements.tag +
      '>\n' +
      inner +
      triggerTag +
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
    triggerTag
  );
}

/**
 * Создаёт контейнер расширений узла вместе с триггером.
 *
 * Контейнер пишется с тем же namespace-префиксом, что и сам узел
 * (`bpmn:extensionElements`), и с отступом на два пробела глубже узла — как
 * это делает сам `bpmn-js` при сохранении схемы.
 *
 * @param {string} xml схема.
 * @param {Object} range границы узла из `readElementRange`.
 * @param {string} triggerTag каноническая запись триггера.
 * @returns {string} схема с созданным контейнером и триггером.
 */
function insertExtensionElements(xml, range, triggerTag) {
  const wrapper = prefixedTagName(range.name, EXTENSION_ELEMENTS_LOCAL_NAME);
  const open = '<' + wrapper + '>';
  const close = '</' + wrapper + '>';
  const indent = lineIndent(xml, range.selfClosing ? range.openStart : range.closeStart);
  const inner = indent + '  ';

  if (!range.selfClosing && indent === '') {
    // Узел (и его содержимое) записаны одной строкой — расширения вставляются
    // компактно, чтобы не разрывать строку переводами.
    return xml.slice(0, range.closeStart) + open + triggerTag + close + xml.slice(range.closeStart);
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
      triggerTag +
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
    triggerTag +
    '\n' +
    inner +
    close +
    '\n' +
    xml.slice(lineStart)
  );
}

/**
 * Объявляет namespace триггера в корневом элементе схемы.
 *
 * Без `xmlns:trg` схема перестаёт быть корректной (`bpmn-js` не прочитает
 * элемент), поэтому объявление добавляется вместе с первым триггером.
 *
 * @param {string} xml схема.
 * @returns {string} схема с объявленным namespace (та же строка, если он уже есть).
 */
function ensureTriggerNamespace(xml) {
  const declared = new RegExp('xmlns:' + TRIGGER_NAMESPACE_PREFIX + '\\s*=');
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
    xml.slice(0, cursor) +
    ' xmlns:' +
    TRIGGER_NAMESPACE_PREFIX +
    '="' +
    TRIGGER_NAMESPACE +
    '"' +
    xml.slice(cursor)
  );
}

