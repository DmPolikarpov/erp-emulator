import {
  ACTION_ICON_PATTERN,
  ACTION_TAG_NAME,
  DEFAULT_ACTION_EVENT,
  ENGINE_FLOW_NODE_TYPES,
  escapeRegExp,
  getActionAssignments,
  getElementAction,
  getElementActions,
  getElementIds,
  getElementRole,
  getElementTrigger,
  getLocalName,
  getNextElementId,
  getOutgoingTargetIds,
  getProcessIds,
  getRoleAssignments,
  getStartAction,
  getTriggerAssignments,
  isActionHostType,
  isElementIdAvailable,
  isFlowElement,
  isFlowElementType,
  isIdAvailableAmong,
  isTriggerHostType,
  isValidAction,
  isValidElementId,
  isValidInstancePrefix,
  isValidPayloadKeys,
  isValidRole,
  isValidTrigger,
  isValidXml,
  listActions,
  listFlowElements,
  listTriggers,
  normalizeAction,
  normalizePayloadKeys,
  normalizeTrigger,
  parseXml,
  renameElementId,
  resolveAction,
  resolveActionEvent,
  resolveActionTarget,
  SCHEMA_PROBLEM,
  setElementActions,
  setElementRole,
  setElementTrigger,
  validateEngineSchema,
} from './bpmnXml';
import { DEFAULT_CUSTOMER_BPMN_XML, DEFAULT_SUPPLIER_BPMN_XML } from '../defaults/milkProcess';

const SIMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Demo" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Старт">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Approve" name="Согласовать">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Approve" targetRef="Gateway_1" />
    <bpmn:endEvent id="EndEvent_1">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`;

describe('bpmnXml: escapeRegExp', () => {
  it('экранирует спецсимволы регулярного выражения', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});

describe('bpmnXml: parseXml / isValidXml', () => {
  it('разбирает корректный XML', () => {
    const doc = parseXml(SIMPLE_BPMN);
    expect(doc).not.toBeNull();
    expect(doc.documentElement.nodeName).toBe('bpmn:definitions');
  });

  it('возвращает null для пустой строки и не-строк', () => {
    expect(parseXml('')).toBeNull();
    expect(parseXml('   ')).toBeNull();
    expect(parseXml(undefined)).toBeNull();
    expect(parseXml(null)).toBeNull();
    expect(parseXml(42)).toBeNull();
  });

  it('возвращает null для некорректного XML', () => {
    expect(parseXml('<bpmn:definitions>')).toBeNull();
  });

  it('подтверждает валидность BPMN-схемы', () => {
    expect(isValidXml(SIMPLE_BPMN)).toBe(true);
  });

  it('отклоняет пустые значения и мусор', () => {
    expect(isValidXml('')).toBe(false);
    expect(isValidXml('   ')).toBe(false);
    expect(isValidXml(undefined)).toBe(false);
    expect(isValidXml(null)).toBe(false);
    expect(isValidXml('не xml')).toBe(false);
  });

  it('отклоняет незакрытый тег', () => {
    expect(isValidXml('<bpmn:definitions>')).toBe(false);
  });
});

describe('bpmnXml: getLocalName / isFlowElement', () => {
  it('снимает namespace-префикс', () => {
    const doc = parseXml(SIMPLE_BPMN);
    const task = Array.from(doc.getElementsByTagName('*')).find(
      (node) => node.getAttribute('id') === 'Task_Approve'
    );
    expect(getLocalName(task)).toBe('userTask');
  });

  it('распознаёт узлы потока управления и отбрасывает связи', () => {
    const doc = parseXml(SIMPLE_BPMN);
    const flow = Array.from(doc.getElementsByTagName('*')).find(
      (node) => node.getAttribute('id') === 'Flow_1'
    );
    expect(isFlowElement(flow)).toBe(false);
    expect(isFlowElement({ nodeName: 'bpmn:exclusiveGateway' })).toBe(true);
    expect(isFlowElement({ nodeName: 'bpmn:subProcess' })).toBe(false);
  });

  it('распознаёт тип элемента из реестра bpmn-js', () => {
    expect(isFlowElementType('bpmn:UserTask')).toBe(true);
    expect(isFlowElementType('bpmn:StartEvent')).toBe(true);
    expect(isFlowElementType('bpmn:ExclusiveGateway')).toBe(true);
    expect(isFlowElementType('bpmn:SequenceFlow')).toBe(false);
    expect(isFlowElementType('bpmn:Process')).toBe(false);
    expect(isFlowElementType(undefined)).toBe(false);
  });
});

describe('bpmnXml: getProcessIds', () => {
  it('возвращает идентификаторы процессов', () => {
    expect(getProcessIds(SIMPLE_BPMN)).toEqual(['Process_Demo']);
  });

  it('возвращает пустой массив для некорректной схемы', () => {
    expect(getProcessIds('')).toEqual([]);
    expect(getProcessIds('<broken>')).toEqual([]);
  });
});

describe('bpmnXml: listFlowElements', () => {
  it('возвращает узлы в порядке документа без sequenceFlow', () => {
    expect(listFlowElements(SIMPLE_BPMN).map((element) => element.id)).toEqual([
      'StartEvent_1',
      'Task_Approve',
      'Gateway_1',
      'EndEvent_1',
    ]);
  });

  it('отдаёт имя и тип узла', () => {
    const task = listFlowElements(SIMPLE_BPMN).find(
      (element) => element.id === 'Task_Approve'
    );
    expect(task).toEqual({
      id: 'Task_Approve',
      name: 'Согласовать',
      type: 'bpmn:userTask',
    });
  });

  it('возвращает пустой массив для некорректной схемы', () => {
    expect(listFlowElements('<broken>')).toEqual([]);
  });
});

describe('bpmnXml: getElementIds', () => {
  it('возвращает уникальные идентификаторы всех элементов', () => {
    const ids = getElementIds(SIMPLE_BPMN);
    expect(ids).toContain('Definitions_1');
    expect(ids).toContain('Process_Demo');
    expect(ids).toContain('Flow_1');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('bpmnXml: isValidElementId / isElementIdAvailable', () => {
  it('принимает корректные идентификаторы движка', () => {
    expect(isValidElementId('Task_Approve')).toBe(true);
    expect(isValidElementId('Task_Approve-1')).toBe(true);
    expect(isValidElementId('_Task')).toBe(true);
  });

  it('отклоняет некорректные идентификаторы', () => {
    expect(isValidElementId('1Task')).toBe(false);
    expect(isValidElementId('Task App')).toBe(false);
    expect(isValidElementId('Task#1')).toBe(false);
    expect(isValidElementId('')).toBe(false);
    expect(isValidElementId(null)).toBe(false);
  });

  it('сообщает о занятости идентификатора', () => {
    expect(isElementIdAvailable(SIMPLE_BPMN, 'Task_New')).toBe(true);
    expect(isElementIdAvailable(SIMPLE_BPMN, 'Task_Approve')).toBe(false);
    expect(isElementIdAvailable(SIMPLE_BPMN, 'Task New')).toBe(false);
  });

  it('проверяет занятость идентификатора в произвольном наборе', () => {
    const ids = ['Task_A', 'Task_B'];
    expect(isIdAvailableAmong(ids, 'Task_C')).toBe(true);
    expect(isIdAvailableAmong(ids, 'Task_A')).toBe(false);
    expect(isIdAvailableAmong(ids, '1 Task')).toBe(false);
    expect(isIdAvailableAmong(undefined, 'Task_A')).toBe(true);
  });
});

describe('bpmnXml: renameElementId', () => {
  it('переименовывает элемент и все ссылки на него', () => {
    const renamed = renameElementId(SIMPLE_BPMN, 'Task_Approve', 'Task_Review');

    expect(renamed).not.toContain('Task_Approve');
    expect(renamed).toContain('id="Task_Review" name="Согласовать"');
    expect(renamed).toContain('targetRef="Task_Review"');
    expect(renamed).toContain('sourceRef="Task_Review"');
    expect(renamed).toContain('<bpmn:incoming>Flow_1</bpmn:incoming>');
    expect(getElementIds(renamed)).toContain('Task_Review');
  });

  it('переименовывает ссылку в текстовом содержимом incoming/outgoing', () => {
    const renamed = renameElementId(SIMPLE_BPMN, 'Flow_1', 'Flow_Start');

    expect(renamed).toContain('<bpmn:outgoing>Flow_Start</bpmn:outgoing>');
    expect(renamed).toContain('<bpmn:incoming>Flow_Start</bpmn:incoming>');
    expect(renamed).toContain('id="Flow_Start"');
    expect(renamed).not.toContain('Flow_1');
  });

  it('не «съедает» закрывающую границу соседнего атрибута', () => {
    expect(renameElementId('<a id="X" ref="X"/>', 'X', 'Y')).toBe('<a id="Y" ref="Y"/>');
  });

  it('не трогает идентификаторы с общим префиксом', () => {
    const xml =
      '<bpmn:process xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Task_1">' +
      '<bpmn:userTask id="Task_10"/></bpmn:process>';
    const renamed = renameElementId(xml, 'Task_1', 'Task_2');

    expect(renamed).toContain('id="Task_2"');
    expect(renamed).toContain('id="Task_10"');
  });

  it('отклоняет схему с необъявленным namespace-префиксом', () => {
    expect(isValidXml('<bpmn:process id="Task_1"/>')).toBe(false);
  });

  it('возвращает схему без изменений при совпадении идентификаторов', () => {
    expect(renameElementId(SIMPLE_BPMN, 'Task_Approve', 'Task_Approve')).toBe(SIMPLE_BPMN);
  });

  it('бросает ошибку на некорректный новый идентификатор', () => {
    expect(() => renameElementId(SIMPLE_BPMN, 'Task_Approve', '1 Task')).toThrow(
      /Недопустимый идентификатор/
    );
  });

  it('бросает ошибку, если исходный элемент не найден', () => {
    expect(() => renameElementId(SIMPLE_BPMN, 'Task_Missing', 'Task_New')).toThrow(
      /не найден/
    );
  });

  it('бросает ошибку, если новый идентификатор уже занят', () => {
    expect(() => renameElementId(SIMPLE_BPMN, 'Task_Approve', 'Gateway_1')).toThrow(
      /уже занят/
    );
  });

  it('бросает ошибку на пустой схеме', () => {
    expect(() => renameElementId('', 'Task_Approve', 'Task_New')).toThrow(/Пустая BPMN-схема/);
  });
});

describe('bpmnXml: роли исполнителя (bpmn:potentialOwner)', () => {
  /** Схема с самозакрывающимся узлом: правка обязана развернуть его в парный тег. */
  const SELF_CLOSING_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Self" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Self" isExecutable="true">
    <bpmn:userTask id="Task_Solo" />
  </bpmn:process>
</bpmn:definitions>`;

  it('валидирует роль той же грамматикой, что и `element_id`', () => {
    expect(isValidRole('QUALITY')).toBe(true);
    expect(isValidRole('SUPPLIER_MANAGER')).toBe(true);
    expect(isValidRole('quality')).toBe(true);
    expect(isValidRole('ОТК')).toBe(false);
    expect(isValidRole('QUALITY MANAGER')).toBe(false);
    expect(isValidRole('1QUALITY')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole(null)).toBe(false);
  });

  it('назначает роль внутрь целевого узла, сохраняя его содержимое', () => {
    const xml = setElementRole(SIMPLE_BPMN, 'Task_Approve', 'QUALITY');

    expect(xml).toContain('<bpmn:potentialOwner name="QUALITY" />');
    expect(xml).toContain('<bpmn:incoming>Flow_1</bpmn:incoming>');
    expect(xml).toContain('<bpmn:outgoing>Flow_2</bpmn:outgoing>');

    // Роль стоит именно в `Task_Approve`, а не в соседнем узле.
    expect(xml.indexOf('potentialOwner')).toBeGreaterThan(xml.indexOf('id="Task_Approve"'));
    expect(xml.indexOf('potentialOwner')).toBeLessThan(xml.indexOf('</bpmn:userTask>'));

    // Схема не переформатирована: снятие роли возвращает исходный текст.
    expect(setElementRole(xml, 'Task_Approve', '')).toBe(SIMPLE_BPMN);
  });

  it('читает роль узла и все назначения схемы', () => {
    const twoTasks =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_Two">' +
      '<bpmn:process id="Process_Two" isExecutable="true">' +
      '<bpmn:userTask id="Task_First" />' +
      '<bpmn:serviceTask id="Task_Second" />' +
      '</bpmn:process></bpmn:definitions>';

    const xml = setElementRole(
      setElementRole(twoTasks, 'Task_First', 'QUALITY'),
      'Task_Second',
      'SECURITY'
    );

    expect(getElementRole(xml, 'Task_First')).toBe('QUALITY');
    expect(getElementRole(xml, 'Task_Second')).toBe('SECURITY');
    expect(getElementRole(SIMPLE_BPMN, 'Task_Approve')).toBe('');
    expect(getElementRole(xml, 'Task_Missing')).toBe('');
    expect(getRoleAssignments(xml)).toEqual({ Task_First: 'QUALITY', Task_Second: 'SECURITY' });
  });

  it('элемент роли не попадает в список узлов и не занимает `id`', () => {
    const xml = setElementRole(SIMPLE_BPMN, 'Task_Approve', 'QUALITY');

    // `potentialOwner` не заканчивается на Task/Event/Gateway, поэтому в
    // список узлов (его видит инспектор и подсветка токенов) не попадает.
    expect(listFlowElements(xml).map((element) => element.id)).toEqual([
      'StartEvent_1',
      'Task_Approve',
      'Gateway_1',
      'EndEvent_1',
    ]);
    expect(getElementIds(xml)).toEqual(getElementIds(SIMPLE_BPMN));
  });

  it('не путает узлы с общим префиксом идентификатора', () => {
    const xml =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">' +
      '<bpmn:process id="P"><bpmn:userTask id="Task_1" /><bpmn:userTask id="Task_10" /></bpmn:process>' +
      '</bpmn:definitions>';

    const withRole = setElementRole(xml, 'Task_1', 'QUALITY');

    expect(getRoleAssignments(withRole)).toEqual({ Task_1: 'QUALITY' });
    expect(withRole).toContain('id="Task_10"');
  });

  it('идемпотентен: повторное назначение той же роли схему не меняет', () => {
    const once = setElementRole(SIMPLE_BPMN, 'Task_Approve', 'QUALITY');

    expect(setElementRole(once, 'Task_Approve', 'QUALITY')).toBe(once);
    expect(setElementRole(SIMPLE_BPMN, 'Task_Approve', '')).toBe(SIMPLE_BPMN);
  });

  it('меняет и снимает роль', () => {
    const assigned = setElementRole(SIMPLE_BPMN, 'Task_Approve', 'QUALITY');
    const changed = setElementRole(assigned, 'Task_Approve', 'MANAGER');

    expect(getRoleAssignments(changed)).toEqual({ Task_Approve: 'MANAGER' });
    expect(changed).not.toContain('QUALITY');
    expect(changed.split('potentialOwner')).toHaveLength(2); // ровно один тег роли
    expect(setElementRole(changed, 'Task_Approve', '')).toBe(SIMPLE_BPMN);
  });

  it('пишет роль без `id`, поэтому переименование узла её не теряет', () => {
    const xml = setElementRole(SIMPLE_BPMN, 'Task_Approve', 'QUALITY');

    expect(xml).not.toMatch(/potentialOwner[^>]*\sid=/);
    expect(
      getElementRole(renameElementId(xml, 'Task_Approve', 'Task_Review'), 'Task_Review')
    ).toBe('QUALITY');
  });

  it('разворачивает самозакрывающийся узел в парный тег', () => {
    const xml = setElementRole(SELF_CLOSING_BPMN, 'Task_Solo', 'QUALITY');

    expect(isValidXml(xml)).toBe(true);
    expect(xml).toContain(
      '<bpmn:userTask id="Task_Solo"><bpmn:potentialOwner name="QUALITY" /></bpmn:userTask>'
    );
    expect(getElementRole(xml, 'Task_Solo')).toBe('QUALITY');
  });

  it('читает и перезаписывает каноническую (по спецификации) форму роли', () => {
    const canonical =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">' +
      '<bpmn:process id="P"><bpmn:userTask id="Task_A"><bpmn:potentialOwner>' +
      '<bpmn:resourceAssignmentExpression><bpmn:formalExpression>QUALITY</bpmn:formalExpression>' +
      '</bpmn:resourceAssignmentExpression></bpmn:potentialOwner></bpmn:userTask></bpmn:process>' +
      '</bpmn:definitions>';

    expect(getElementRole(canonical, 'Task_A')).toBe('QUALITY');

    // Своя же запись перезаписывается каноничной формой SDK (атрибут `name`).
    const rewritten = setElementRole(canonical, 'Task_A', 'SECURITY');

    expect(rewritten).toContain('<bpmn:potentialOwner name="SECURITY" />');
    expect(rewritten).not.toContain('resourceAssignmentExpression');
    expect(getElementRole(rewritten, 'Task_A')).toBe('SECURITY');
  });

  it('отклоняет недопустимую роль, неизвестный узел и пустую схему', () => {
    expect(() => setElementRole(SIMPLE_BPMN, 'Task_Approve', 'ОТК')).toThrow(
      /Недопустимая роль исполнителя/
    );
    expect(() => setElementRole(SIMPLE_BPMN, 'Task_Missing', 'QUALITY')).toThrow(/не найден/);
    expect(() => setElementRole('', 'Task_Approve', 'QUALITY')).toThrow(/Пустая BPMN-схема/);
    expect(() => setElementRole(null, 'Task_Approve', 'QUALITY')).toThrow(/Пустая BPMN-схема/);
  });

  it('отказывается писать роль в событие, шлюз или связь', () => {
    // `resourceRole` по спецификации BPMN 2.0 есть только у Activity: у события
    // `bpmn-js` не признаёт `bpmn:potentialOwner` и теряет его при сохранении.
    ['StartEvent_1', 'EndEvent_1', 'Gateway_1', 'Flow_1'].forEach((elementId) => {
      expect(() => setElementRole(SIMPLE_BPMN, elementId, 'QUALITY')).toThrow(/только Activity/);
    });

    expect(() => setElementRole(SIMPLE_BPMN, 'StartEvent_1', '')).not.toThrow();
  });

  it('не показывает роль, записанную в событие вручную', () => {
    const xml =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">' +
      '<bpmn:process id="P"><bpmn:startEvent id="StartEvent_1">' +
      '<bpmn:potentialOwner name="PRODUCTION" /></bpmn:startEvent></bpmn:process>' +
      '</bpmn:definitions>';

    expect(getRoleAssignments(xml)).toEqual({});
  });

  it('без DOM чтение ролей возвращает пустую карту (как `listFlowElements`)', () => {
    const originalDomParser = global.DOMParser;
    delete global.DOMParser;

    try {
      expect(getRoleAssignments(SIMPLE_BPMN)).toEqual({});
      expect(getElementRole(SIMPLE_BPMN, 'Task_Approve')).toBe('');
    } finally {
      global.DOMParser = originalDomParser;
    }
  });
});

describe('bpmnXml: триггер кросс-процессного запуска (trg:processTrigger)', () => {
  /** Триггер с полным набором полей: так его пишет панель настроек. */
  const TRIGGER = {
    targetProcessId: 'Process_SupplierSupply_v1',
    instancePrefix: 'inst-supp-',
    startElementId: 'Task_Approve',
    firstElementId: 'Task_First',
    payloadKeys: 'orderNum,volume',
  };

  /** Каноническая запись триггера (порядок атрибутов — `TRIGGER_FIELDS`). */
  const TRIGGER_TAG =
    '<trg:processTrigger targetProcessId="Process_SupplierSupply_v1"' +
    ' instancePrefix="inst-supp-" startElementId="Task_Approve"' +
    ' firstElementId="Task_First" payloadKeys="orderNum,volume" />';

  /** Узел с чужим расширением: контейнер уже есть, его нельзя пересоздавать. */
  const XML_WITH_EXTENSIONS =
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"' +
    ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_Camunda">' +
    '<bpmn:process id="Process_Camunda" isExecutable="true">' +
    '<bpmn:userTask id="Task_Camunda"><bpmn:extensionElements>' +
    '<camunda:formData><camunda:formField id="orderNum" /></camunda:formData>' +
    '</bpmn:extensionElements></bpmn:userTask>' +
    '</bpmn:process></bpmn:definitions>';

  it('пишет триггер в `extensionElements` узла, создавая контейнер и namespace', () => {
    const xml = setElementTrigger(SIMPLE_BPMN, 'Task_Approve', TRIGGER);

    expect(isValidXml(xml)).toBe(true);
    expect(xml).toContain('xmlns:trg="http://erp.mes/schema/bpmn/trigger"');
    expect(xml).toContain('<bpmn:extensionElements>');
    expect(xml).toContain(TRIGGER_TAG);

    // Триггер стоит внутри своего узла и читается теми же полями.
    expect(xml.indexOf('processTrigger')).toBeGreaterThan(
      xml.indexOf('id="Task_Approve"')
    );
    expect(xml.indexOf('processTrigger')).toBeLessThan(xml.indexOf('</bpmn:userTask>'));
    expect(getElementTrigger(xml, 'Task_Approve')).toEqual(TRIGGER);
    expect(getTriggerAssignments(xml)).toEqual({ Task_Approve: TRIGGER });
  });

  it('разворачивает самозакрывающийся узел (шлюз) в парный тег', () => {
    const gateway = { ...TRIGGER, startElementId: 'Gateway_1' };
    const xml = setElementTrigger(SIMPLE_BPMN, 'Gateway_1', gateway);

    expect(isValidXml(xml)).toBe(true);
    expect(xml).toContain('<bpmn:exclusiveGateway id="Gateway_1">');
    expect(xml).toContain(
      '<trg:processTrigger targetProcessId="Process_SupplierSupply_v1"' +
        ' instancePrefix="inst-supp-" startElementId="Gateway_1"' +
        ' firstElementId="Task_First" payloadKeys="orderNum,volume" />'
    );
    expect(getElementTrigger(xml, 'Gateway_1')).toEqual(gateway);
  });

  it('дописывает триггер в существующий контейнер, сохраняя чужие расширения', () => {
    const xml = setElementTrigger(XML_WITH_EXTENSIONS, 'Task_Camunda', {
      targetProcessId: 'Process_MilkCustomer_v1',
    });

    expect(xml).toContain('<camunda:formField id="orderNum" />');
    expect(xml).toContain(
      '<trg:processTrigger targetProcessId="Process_MilkCustomer_v1" />'
    );
    // Контейнер ровно один: новый не создаётся рядом с существующим.
    expect(xml.match(/<bpmn:extensionElements>/g)).toHaveLength(1);
  });

  it('меняет и снимает триггер', () => {
    const assigned = setElementTrigger(SIMPLE_BPMN, 'Task_Approve', TRIGGER);
    const changed = setElementTrigger(assigned, 'Task_Approve', {
      ...TRIGGER,
      targetProcessId: 'Process_MilkCustomer_v1',
    });

    expect(changed).not.toContain('Process_SupplierSupply_v1');
    expect(changed.split('processTrigger')).toHaveLength(2); // ровно один тег
    expect(getElementTrigger(changed, 'Task_Approve').targetProcessId).toBe(
      'Process_MilkCustomer_v1'
    );

    const cleared = setElementTrigger(changed, 'Task_Approve', null);

    expect(cleared).not.toContain('processTrigger');
    expect(getElementTrigger(cleared, 'Task_Approve')).toBeNull();
  });

  it('идемпотентен: повторная запись и снятие «пустого» триггера схему не меняют', () => {
    const once = setElementTrigger(SIMPLE_BPMN, 'Task_Approve', TRIGGER);

    expect(setElementTrigger(once, 'Task_Approve', TRIGGER)).toBe(once);
    expect(setElementTrigger(SIMPLE_BPMN, 'Task_Approve', null)).toBe(SIMPLE_BPMN);

    // `payloadKeys` — упорядоченный список: «грязная» запись канонизируется
    // (trim, дедупликация), а тот же канон повторной записи не требует.
    const unordered = setElementTrigger(SIMPLE_BPMN, 'Task_Approve', {
      targetProcessId: 'Process_SupplierSupply_v1',
      payloadKeys: ' volume , orderNum ,, volume ',
    });

    expect(unordered).toContain('payloadKeys="volume,orderNum"');
    expect(
      setElementTrigger(unordered, 'Task_Approve', {
        targetProcessId: 'Process_SupplierSupply_v1',
        payloadKeys: 'volume,orderNum',
      })
    ).toBe(unordered);
  });

  it('собирает все триггеры схемы в порядке появления', () => {
    const xml = setElementTrigger(
      setElementTrigger(SIMPLE_BPMN, 'Task_Approve', { targetProcessId: 'Process_B' }),
      'Gateway_1',
      { targetProcessId: 'Process_C' }
    );

    expect(listTriggers(xml).map((item) => item.elementId)).toEqual([
      'Task_Approve',
      'Gateway_1',
    ]);
    expect(getTriggerAssignments(xml)).toEqual({
      Task_Approve: normalizeTrigger({ targetProcessId: 'Process_B' }),
      Gateway_1: normalizeTrigger({ targetProcessId: 'Process_C' }),
    });
  });

  it('читает триггер, записанный вручную (без контейнера, другой порядок атрибутов)', () => {
    const manual =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"' +
      ' xmlns:trg="http://erp.mes/schema/bpmn/trigger" id="Definitions_Manual">' +
      '<bpmn:process id="Process_Manual" isExecutable="true">' +
      '<bpmn:serviceTask id="Task_Manual">' +
      '<trg:processTrigger payloadKeys="volume,orderNum" targetProcessId="Process_Target" />' +
      '</bpmn:serviceTask></bpmn:process></bpmn:definitions>';

    expect(getElementTrigger(manual, 'Task_Manual')).toEqual(
      normalizeTrigger({
        targetProcessId: 'Process_Target',
        payloadKeys: 'volume,orderNum',
      })
    );
    expect(getElementTrigger(manual, 'Task_Missing')).toBeNull();
  });

  it('валидирует поля триггера теми же правилами, что и остальные идентификаторы', () => {
    expect(isValidInstancePrefix('inst-supp-')).toBe(true);
    expect(isValidInstancePrefix('')).toBe(true);
    expect(isValidInstancePrefix('inst supp')).toBe(false);
    expect(isValidInstancePrefix(null)).toBe(false);

    expect(isValidPayloadKeys('orderNum,volume')).toBe(true);
    expect(isValidPayloadKeys('')).toBe(true);
    expect(isValidPayloadKeys(['orderNum', 'volume'])).toBe(true);
    expect(isValidPayloadKeys('orderNum,1volume')).toBe(false);
    expect(isValidPayloadKeys(42)).toBe(false);

    expect(normalizePayloadKeys(' orderNum, volume ,, orderNum ')).toBe('orderNum,volume');
    expect(normalizePayloadKeys(['volume', '', 'orderNum', 'volume'])).toBe(
      'volume,orderNum'
    );

    expect(isValidTrigger({ targetProcessId: 'Process_B' })).toBe(true);
    expect(isValidTrigger({})).toBe(false);
    expect(isValidTrigger(null)).toBe(false);

    expect(isTriggerHostType('bpmn:userTask')).toBe(true);
    expect(isTriggerHostType('exclusiveGateway')).toBe(true);
    expect(isTriggerHostType('bpmn:sequenceFlow')).toBe(false);
  });

  it('приводит триггер к канону и отбрасывает неизвестные поля', () => {
    expect(
      normalizeTrigger({ targetProcessId: ' Process_B ', payloadKeys: ['orderNum'] })
    ).toEqual({
      targetProcessId: 'Process_B',
      instancePrefix: '',
      startElementId: '',
      firstElementId: '',
      payloadKeys: 'orderNum',
    });
    expect(normalizeTrigger({ targetProcessId: 'Process_B', camunda: 'x' })).not.toHaveProperty(
      'camunda'
    );
  });

  it('отклоняет недопустимый триггер, неизвестный узел и пустую схему', () => {
    expect(() => setElementTrigger(SIMPLE_BPMN, 'Task_Approve', {})).toThrow(
      /Недопустимый целевой процесс триггера/
    );
    expect(() => setElementTrigger(SIMPLE_BPMN, 'Task_Approve', 'Process_B')).toThrow(
      /Триггер запуска — это объект/
    );
    expect(() =>
      setElementTrigger(SIMPLE_BPMN, 'Task_Approve', {
        targetProcessId: 'Process_B',
        instancePrefix: 'inst supp',
      })
    ).toThrow(/Недопустимый префикс экземпляра/);
    expect(() =>
      setElementTrigger(SIMPLE_BPMN, 'Task_Approve', {
        targetProcessId: 'Process_B',
        firstElementId: '1 Task',
      })
    ).toThrow(/Недопустимый первый узел целевого процесса/);
    expect(() =>
      setElementTrigger(SIMPLE_BPMN, 'Task_Approve', {
        targetProcessId: 'Process_B',
        payloadKeys: '1wrong',
      })
    ).toThrow(/Недопустимый список ключей payload/);
    expect(() => setElementTrigger(SIMPLE_BPMN, 'Task_Missing', TRIGGER)).toThrow(
      /не найден/
    );
    expect(() => setElementTrigger('', 'Task_Approve', TRIGGER)).toThrow(
      /Пустая BPMN-схема/
    );
    expect(() => setElementTrigger(null, 'Task_Approve', TRIGGER)).toThrow(
      /Пустая BPMN-схема/
    );
  });

  it('отказывается ставить триггер на последовательный поток, но умеет его снять', () => {
    // На `sequenceFlow` триггер никогда не сработает: движок активирует узел
    // токеном, а связь — нет.
    expect(() => setElementTrigger(SIMPLE_BPMN, 'Flow_1', TRIGGER)).toThrow(
      /только узлам потока/
    );
    expect(() => setElementTrigger(SIMPLE_BPMN, 'Flow_1', null)).not.toThrow();
  });

  it('без DOM чтение триггеров возвращает пустой список (как `listFlowElements`)', () => {
    const originalDomParser = global.DOMParser;
    delete global.DOMParser;

    try {
      expect(listTriggers(SIMPLE_BPMN)).toEqual([]);
      expect(getTriggerAssignments(SIMPLE_BPMN)).toEqual({});
      expect(getElementTrigger(SIMPLE_BPMN, 'Task_Approve')).toBeNull();
    } finally {
      global.DOMParser = originalDomParser;
    }
  });
});

describe('bpmnXml: validateEngineSchema', () => {
  /**
   * Минимальная схема, которую движок компилирует: старт → шаг → конец.
   * Связи описаны только `sequenceFlow` — `<bpmn:incoming>`/`outgoing` движок
   * не читает (он собирает связи сам, обходом детей процесса).
   */
  const ENGINE_VALID_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Valid" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Старт" />
    <bpmn:userTask id="Task_Step" name="Шаг" />
    <bpmn:endEvent id="EndEvent_1" name="Конец" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Step" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Step" targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;

  /** Коды проблем отчёта. */
  const codes = (problems) => problems.map((problem) => problem.code);

  it('схему из списка поддерживаемых узлов движок принимает', () => {
    expect(ENGINE_FLOW_NODE_TYPES).toContain('userTask');
    expect(validateEngineSchema(ENGINE_VALID_BPMN)).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('демо-схемы SDK совместимы с движком', () => {
    // Демо-схемы — точка отсчёта правок редактора и запуск процесса в демо.
    expect(validateEngineSchema(DEFAULT_CUSTOMER_BPMN_XML)).toEqual({
      ok: true,
      problems: [],
    });
    expect(validateEngineSchema(DEFAULT_SUPPLIER_BPMN_XML)).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('узел типа, которого движок не знает, объясняется отдельной проблемой', () => {
    // Реальный случай: шаг, добавленный в палитре редактора, — базовый
    // `<bpmn:task>`. Парсер движка его пропускает, связи через узел становятся
    // висячими, и определение не компилируется целиком.
    const xml = ENGINE_VALID_BPMN.replace('<bpmn:userTask', '<bpmn:task');
    const { ok, problems } = validateEngineSchema(xml);

    expect(ok).toBe(false);
    expect(codes(problems)).toEqual([SCHEMA_PROBLEM.UNSUPPORTED_NODE]);

    const [problem] = problems;
    expect(problem.elementId).toBe('Task_Step');
    expect(problem.message).toContain('bpmn:task');
    expect(problem.message).toContain('userTask');
    expect(problem.hint).toContain('User task');
  });

  it('подпроцесс тоже считается неподдерживаемым узлом', () => {
    const xml = ENGINE_VALID_BPMN.replace('<bpmn:userTask', '<bpmn:subProcess');

    expect(codes(validateEngineSchema(xml).problems)).toEqual([
      SCHEMA_PROBLEM.UNSUPPORTED_NODE,
    ]);
  });

  it('связь в удалённый узел объясняется по номеру связи', () => {
    const xml = ENGINE_VALID_BPMN.replace(
      'targetRef="Task_Step"',
      'targetRef="Task_Removed"'
    );
    const { ok, problems } = validateEngineSchema(xml);

    expect(ok).toBe(false);

    const problem = problems.find(
      (item) => item.code === SCHEMA_PROBLEM.FLOW_TARGET_NOT_FOUND
    );

    expect(problem).toBeTruthy();
    expect(problem.flowId).toBe('Flow_1');
    expect(problem.message).toContain('Task_Removed');
  });

  it('связь узла с самим собой — ошибка', () => {
    const xml = ENGINE_VALID_BPMN.replace(
      'targetRef="EndEvent_1"',
      'targetRef="Task_Step"'
    );

    expect(codes(validateEngineSchema(xml).problems)).toContain(
      SCHEMA_PROBLEM.FLOW_SELF_LOOP
    );
  });

  it('оторванный от маршрута узел — ошибка', () => {
    const xml = ENGINE_VALID_BPMN.replace(
      '<bpmn:endEvent id="EndEvent_1" name="Конец" />',
      '<bpmn:userTask id="Task_Lonely" name="Одинокий" />\n' +
        '    <bpmn:endEvent id="EndEvent_1" name="Конец" />'
    );
    const orphans = validateEngineSchema(xml).problems.filter(
      (item) => item.code === SCHEMA_PROBLEM.ORPHAN_NODE
    );

    // Ни входящей, ни исходящей связи — две записи по одному узлу.
    expect(orphans.map((item) => item.elementId)).toEqual([
      'Task_Lonely',
      'Task_Lonely',
    ]);
  });

  it('без стартового и без конечного события движок не компилирует', () => {
    const withoutStart = ENGINE_VALID_BPMN.replace(
      '<bpmn:startEvent id="StartEvent_1" name="Старт" />',
      ''
    );
    const withoutEnd = ENGINE_VALID_BPMN.replace(
      '<bpmn:endEvent id="EndEvent_1" name="Конец" />',
      ''
    );

    expect(codes(validateEngineSchema(withoutStart).problems)).toContain(
      SCHEMA_PROBLEM.NO_START_EVENT
    );
    expect(codes(validateEngineSchema(withoutEnd).problems)).toContain(
      SCHEMA_PROBLEM.NO_END_EVENT
    );
  });

  it('неразбираемый XML и схема без процесса дают по одной проблеме', () => {
    expect(codes(validateEngineSchema('<bpmn:definitions>').problems)).toEqual([
      SCHEMA_PROBLEM.INVALID_XML,
    ]);
    expect(
      codes(
        validateEngineSchema(
          '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" />'
        ).problems
      )
    ).toEqual([SCHEMA_PROBLEM.NO_PROCESS]);
  });

  it('служебные узлы процесса (аннотация, дорожки) ошибкой не считаются', () => {

    const xml = ENGINE_VALID_BPMN.replace(
      '<bpmn:endEvent id="EndEvent_1" name="Конец" />',
      '<bpmn:textAnnotation id="Text_1"><bpmn:text>подсказка</bpmn:text></bpmn:textAnnotation>\n' +
        '    <bpmn:endEvent id="EndEvent_1" name="Конец" />'
    );

    expect(validateEngineSchema(xml)).toEqual({ ok: true, problems: [] });
  });
});




/* ------------------------------------------------------------------ *
 * Кнопки участников (`act:userAction`)
 * ------------------------------------------------------------------ */

/** Кнопка «отправить заказ» для тестов записи. */
const ACTION = {
  id: 'sendToSupplier',
  label: 'Отправить заказ Поставщику',
  role: 'MANAGER',
  icon: 'Send',
  event: 'SendToSupplier',
  elementId: 'EndEvent_1',
  counterpartEvent: '',
  counterpartElementId: '',
  startsProcess: '',
};

describe('bpmnXml: кнопки участников (act:userAction)', () => {
  it('пишет кнопку в `extensionElements` узла, создавая контейнер и namespace', () => {
    const xml = setElementActions(SIMPLE_BPMN, 'Task_Approve', [ACTION]);

    // Объявление namespace обязательно: без него `bpmn-js` не прочитает тег.
    expect(xml).toContain('xmlns:act="http://erp.mes/schema/bpmn/action"');
    expect(xml).toContain(
      '<' +
        ACTION_TAG_NAME +
        ' id="sendToSupplier" label="Отправить заказ Поставщику" role="MANAGER" ' +
        'icon="Send" event="SendToSupplier" elementId="EndEvent_1" />'
    );
    // Контейнер появился внутри узла, а не рядом с ним.
    expect(xml).toContain('<bpmn:extensionElements>');
    expect(getElementActions(xml, 'Task_Approve')).toEqual([ACTION]);
  });

  it('разворачивает самозакрывающийся узел в парный тег', () => {
    const selfClosing =
      '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">' +
      '<bpmn:process id="P"><bpmn:userTask id="Task_1" /></bpmn:process></bpmn:definitions>';

    const xml = setElementActions(selfClosing, 'Task_1', [ACTION]);

    expect(xml).toContain('<bpmn:userTask id="Task_1">');
    expect(xml).toContain('</bpmn:userTask>');
    expect(getElementActions(xml, 'Task_1')).toEqual([ACTION]);
  });

  it('дописывает вторую кнопку рядом с триггером и чужими расширениями', () => {
    // Чужие расширения объявляются своим namespace: без `xmlns:` схема
    // перестаёт быть корректной, и её не прочитает даже `DOMParser`.
    const withTrigger = setElementTrigger(
      SIMPLE_BPMN.replace(
        'id="Definitions_1"',
        'id="Definitions_1" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"'
      ),
      'Task_Approve',
      { targetProcessId: 'Process_Other' }
    ).replace(
      '</bpmn:extensionElements>',
      '<camunda:properties><camunda:property name="a" value="b" /></camunda:properties>\n      </bpmn:extensionElements>'
    );

    const second = { ...ACTION, id: 'approve', label: 'Согласовать', event: 'Approve' };
    const xml = setElementActions(withTrigger, 'Task_Approve', [ACTION, second]);

    // Чужие расширения и триггер на месте, кнопки — в порядке списка.
    expect(xml).toContain('trg:processTrigger');
    expect(xml).toContain('camunda:property');
    expect(getElementActions(xml, 'Task_Approve').map((action) => action.id)).toEqual([
      'sendToSupplier',
      'approve',
    ]);
    expect(getElementTrigger(xml, 'Task_Approve')).toEqual({
      targetProcessId: 'Process_Other',
      instancePrefix: '',
      startElementId: '',
      firstElementId: '',
      payloadKeys: '',
    });
  });

  it('заменяет список кнопок целиком и снимает его пустым списком', () => {
    const first = setElementActions(SIMPLE_BPMN, 'Task_Approve', [ACTION]);
    const second = { ...ACTION, id: 'other', label: 'Другая', event: 'Other' };

    const replaced = setElementActions(first, 'Task_Approve', [second]);
    expect(getElementActions(replaced, 'Task_Approve')).toEqual([second]);

    const cleared = setElementActions(replaced, 'Task_Approve', []);
    expect(cleared).not.toContain(ACTION_TAG_NAME);
    expect(getElementActions(cleared, 'Task_Approve')).toEqual([]);
    // Снятие кнопок не трогает остальную схему.
    expect(listFlowElements(cleared).map((element) => element.id)).toEqual(
      listFlowElements(SIMPLE_BPMN).map((element) => element.id)
    );
  });

  it('идемпотентен: повторная запись того же списка не размножает теги', () => {
    const once = setElementActions(SIMPLE_BPMN, 'Task_Approve', [ACTION]);
    const twice = setElementActions(once, 'Task_Approve', [ACTION]);

    expect(twice.match(/userAction/g)).toHaveLength(1);
    expect(getElementActions(twice, 'Task_Approve')).toEqual([ACTION]);
  });

  it('собирает кнопки схемы и карту по узлам', () => {
    expect(
      listActions(DEFAULT_CUSTOMER_BPMN_XML).map((item) => [item.elementId, item.action.id])
    ).toEqual([
      ['StartEvent_Customer', 'createOrder'],
      ['Task_CreatePurchaseOrder', 'sendToSupplier'],
      ['Task_ReceiveDocsAndIssuePass', 'issuePass'],
      ['Task_SecurityCheck', 'securityPass'],
      ['Task_QualityControl', 'qualityApprove'],
    ]);

    expect(Object.keys(getActionAssignments(DEFAULT_CUSTOMER_BPMN_XML))).toEqual([
      'StartEvent_Customer',
      'Task_CreatePurchaseOrder',
      'Task_ReceiveDocsAndIssuePass',
      'Task_SecurityCheck',
      'Task_QualityControl',
    ]);

    // Пара «событие + узел» в кнопке демо-схемы не записана: её выводит схема,
    // поэтому проверяется не только чтение, но и разрешение пары.
    const securityPass = getElementAction(
      DEFAULT_CUSTOMER_BPMN_XML,
      'Task_SecurityCheck',
      'securityPass'
    );
    expect(securityPass).toMatchObject({ event: '', elementId: '' });
    expect(
      resolveAction(DEFAULT_CUSTOMER_BPMN_XML, 'Task_SecurityCheck', securityPass)
    ).toEqual({ event: DEFAULT_ACTION_EVENT, elementId: 'Task_QualityControl' });

    expect(getElementAction(DEFAULT_CUSTOMER_BPMN_XML, 'Task_SecurityCheck', 'nope')).toBeNull();
    expect(
      getElementActions(DEFAULT_CUSTOMER_BPMN_XML, 'Task_WaitForSupplierShipment')
    ).toEqual([]);
  });

  it('читает кнопку запуска процесса со стартового события', () => {
    const declaration = getStartAction(DEFAULT_CUSTOMER_BPMN_XML);

    // В схеме у кнопки старта только роль: событие и узел первого шага схема
    // выводит сама (`CompleteBlock` и цель единственной исходящей связи).
    expect(declaration).toMatchObject({
      elementId: 'StartEvent_Customer',
      action: {
        id: 'createOrder',
        role: 'PRODUCTION',
        event: '',
        elementId: '',
      },
    });
    expect(
      resolveAction(DEFAULT_CUSTOMER_BPMN_XML, declaration.elementId, declaration.action)
    ).toEqual({
      event: DEFAULT_ACTION_EVENT,
      elementId: 'Task_CreatePurchaseOrder',
    });

    const supplierDeclaration = getStartAction(DEFAULT_SUPPLIER_BPMN_XML);

    expect(supplierDeclaration).toMatchObject({
      elementId: 'StartEvent_Supplier',
      action: {
        id: 'startSupplierProcess',
        event: '',
        elementId: '',
      },
    });
    expect(
      resolveAction(
        DEFAULT_SUPPLIER_BPMN_XML,
        supplierDeclaration.elementId,
        supplierDeclaration.action
      )
    ).toEqual({ event: DEFAULT_ACTION_EVENT, elementId: 'Task_SupplierCreateDocs' });

    // Схема без кнопок запуска процесса его не описывает.
    expect(getStartAction(SIMPLE_BPMN)).toBeNull();
    expect(getStartAction('')).toBeNull();
  });

  it('демо-схемы несут кнопки участников с кросс-процессными эффектами', () => {
    expect(listActions(DEFAULT_SUPPLIER_BPMN_XML).map((item) => item.action.id)).toEqual([
      'startSupplierProcess',
      'createDocs',
      'shipment',
    ]);

    // Отгрузка поставщика = свой шаг плюс сигнал в экземпляр заказчика. Своё
    // событие и узел в кнопке не записаны (их выводит схема: `CompleteBlock` и
    // `EndEvent_Supplier`), а сигнал второй стороне — данными, которые из связей
    // не выводятся.
    const shipment = getElementAction(
      DEFAULT_SUPPLIER_BPMN_XML,
      'Task_SupplierShipment',
      'shipment'
    );
    expect(shipment).toMatchObject({
      event: '',
      elementId: '',
      counterpartEvent: 'SupplierShippedSignal',
      counterpartElementId: 'Task_ReceiveDocsAndIssuePass',
    });
    expect(
      resolveAction(DEFAULT_SUPPLIER_BPMN_XML, 'Task_SupplierShipment', shipment)
    ).toEqual({ event: DEFAULT_ACTION_EVENT, elementId: 'EndEvent_Supplier' });

    // Передача заказа запускает процесс второй стороны.
    expect(
      getElementAction(DEFAULT_CUSTOMER_BPMN_XML, 'Task_CreatePurchaseOrder', 'sendToSupplier')
    ).toMatchObject({ startsProcess: 'Process_SupplierSupply_v1' });

    // Роли кнопок задач берутся у узлов, а у кнопки старта — у неё самой.
    expect(getElementRole(DEFAULT_CUSTOMER_BPMN_XML, 'Task_SecurityCheck')).toBe('SECURITY');
    expect(getElementRole(DEFAULT_CUSTOMER_BPMN_XML, 'StartEvent_Customer')).toBe('');
  });

  it('все кнопки демо-схем выводят узел из связей и не теряют его', () => {
    // Страховка от «сократили кнопку и потеряли адрес»: у каждой кнопки обеих
    // демо-схем пара «событие + узел» разрешается в реальный узел процесса.
    [DEFAULT_CUSTOMER_BPMN_XML, DEFAULT_SUPPLIER_BPMN_XML].forEach((xml) => {
      const nodeIds = listFlowElements(xml).map((element) => element.id);

      listActions(xml).forEach(({ elementId, action }) => {
        const resolved = resolveAction(xml, elementId, action);

        expect(resolved.event).toBe(DEFAULT_ACTION_EVENT);
        expect(nodeIds).toContain(resolved.elementId);
      });
    });
  });

  it('выводит цель единственной исходящей связи и не угадывает при развилке', () => {
    // `StartEvent_1` ведёт в `Task_Approve`, `Task_Approve` — в шлюз, а у самого
    // шлюза исходящих связей нет: вывести «следующий шаг» можно только для
    // первого, там ответ однозначен.
    expect(getOutgoingTargetIds(SIMPLE_BPMN, 'StartEvent_1')).toEqual(['Task_Approve']);
    expect(getOutgoingTargetIds(SIMPLE_BPMN, 'Task_Approve')).toEqual(['Gateway_1']);
    expect(getOutgoingTargetIds(SIMPLE_BPMN, 'Gateway_1')).toEqual([]);
    expect(getOutgoingTargetIds(SIMPLE_BPMN, '')).toEqual([]);

    expect(getNextElementId(SIMPLE_BPMN, 'StartEvent_1')).toBe('Task_Approve');
    expect(getNextElementId(SIMPLE_BPMN, 'Gateway_1')).toBe('');
    expect(getNextElementId('', 'StartEvent_1')).toBe('');

    // Развилка: две связи из одного узла — «следующий блок» не определён.
    const branching = SIMPLE_BPMN.replace(
      '<bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Approve" targetRef="Gateway_1" />',
      '<bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Approve" targetRef="Gateway_1" />' +
        '<bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Approve" targetRef="EndEvent_1" />'
    );

    expect(getOutgoingTargetIds(branching, 'Task_Approve')).toEqual([
      'Gateway_1',
      'EndEvent_1',
    ]);
    expect(getNextElementId(branching, 'Task_Approve')).toBe('');
  });

  it('разрешает пару «событие + узел»: записанное в схеме важнее умолчания', () => {
    const explicit = { ...ACTION, event: 'Approve', elementId: 'Task_Other' };

    expect(resolveActionEvent(explicit)).toBe('Approve');
    expect(resolveActionTarget(SIMPLE_BPMN, 'StartEvent_1', explicit)).toBe('Task_Other');
    expect(resolveAction(SIMPLE_BPMN, 'StartEvent_1', explicit)).toEqual({
      event: 'Approve',
      elementId: 'Task_Other',
    });

    const minimal = { id: 'approve', label: 'Согласовать' };

    expect(resolveActionEvent(minimal)).toBe(DEFAULT_ACTION_EVENT);
    expect(resolveActionEvent(null)).toBe(DEFAULT_ACTION_EVENT);
    expect(resolveActionTarget(SIMPLE_BPMN, 'StartEvent_1', minimal)).toBe('Task_Approve');
    expect(resolveAction(SIMPLE_BPMN, 'StartEvent_1', minimal)).toEqual({
      event: DEFAULT_ACTION_EVENT,
      elementId: 'Task_Approve',
    });

    // Развилка: узел не выводится, значит кнопка обязана назвать его сама.
    expect(resolveActionTarget(SIMPLE_BPMN, 'Gateway_1', minimal)).toBe('');
  });

  it('пишет короткую кнопку без события и узла', () => {
    const minimal = { id: 'approve', label: 'Согласовать' };
    const xml = setElementActions(SIMPLE_BPMN, 'Task_Approve', [minimal]);

    // Канон кнопки-«шага»: только ключ и надпись, пустые поля не пишутся.
    expect(xml).toContain('<' + ACTION_TAG_NAME + ' id="approve" label="Согласовать" />');
    expect(getElementActions(xml, 'Task_Approve')).toEqual([
      {
        id: 'approve',
        label: 'Согласовать',
        role: '',
        icon: '',
        event: '',
        elementId: '',
        counterpartEvent: '',
        counterpartElementId: '',
        startsProcess: '',
      },
    ]);
    expect(resolveAction(xml, 'Task_Approve', minimal)).toEqual({
      event: DEFAULT_ACTION_EVENT,
      elementId: 'Gateway_1',
    });

    // Обязательны ключ и надпись; недопустимый формат события и узла — ошибка,
    // потому что оба уходят в движок (subject NATS и `element_id`).
    expect(() => normalizeAction({ ...ACTION, event: '1 событие' })).toThrow(
      /событие кнопки/
    );
    expect(() => normalizeAction({ ...ACTION, elementId: '1 узел' })).toThrow(/узел кнопки/);
  });

  it('приводит кнопку к канону и отбрасывает неизвестные поля', () => {
    expect(
      normalizeAction({
        id: ' sendToSupplier ',
        label: ' Отправить ',
        event: ' SendToSupplier ',
        elementId: 'Task_Next',
        unknown: 'мусор',
      })
    ).toEqual({
      id: 'sendToSupplier',
      label: 'Отправить',
      role: '',
      icon: '',
      event: 'SendToSupplier',
      elementId: 'Task_Next',
      counterpartEvent: '',
      counterpartElementId: '',
      startsProcess: '',
    });

    expect(isValidAction(ACTION)).toBe(true);
    expect(isValidAction({ ...ACTION, label: '' })).toBe(false);
    expect(isValidAction({ ...ACTION, counterpartEvent: 'Signal' })).toBe(false);

    // Событие и узел необязательны: пустые поля — это умолчания схемы
    // (`CompleteBlock` и следующий блок по единственной исходящей связи).
    expect(isValidAction({ ...ACTION, event: '', elementId: '' })).toBe(true);
    expect(isValidAction({ id: 'approve', label: 'Согласовать' })).toBe(true);

    expect(ACTION_ICON_PATTERN.test('Truck')).toBe(true);
    expect(ACTION_ICON_PATTERN.test('truck-2')).toBe(false);
  });

  it('отклоняет недопустимую кнопку, неизвестный узел и пустую схему', () => {
    expect(() => setElementActions('', 'Task_Approve', [ACTION])).toThrow(/Пустая BPMN-схема/);
    expect(() => setElementActions(SIMPLE_BPMN, 'Task_Missing', [ACTION])).toThrow(/не найден/);
    expect(() =>
      setElementActions(SIMPLE_BPMN, 'Task_Approve', [{ ...ACTION, label: '' }])
    ).toThrow(/надписи/);
    expect(() =>
      setElementActions(SIMPLE_BPMN, 'Task_Approve', [{ ...ACTION, counterpartEvent: 'Signal' }])
    ).toThrow(/второй стороны задаются вместе/);
    expect(() => normalizeAction(null)).toThrow(/объект с полем id/);
  });

  it('отказывается ставить кнопку на последовательный поток, но умеет её снять', () => {
    expect(isActionHostType('bpmn:userTask')).toBe(true);
    expect(isActionHostType('bpmn:startEvent')).toBe(true);
    expect(isActionHostType('bpmn:SequenceFlow')).toBe(false);

    expect(() => setElementActions(SIMPLE_BPMN, 'Flow_1', [ACTION])).toThrow(
      /только узлам потока/
    );

    // «Починка» схемы: кнопка, записанная в связь вручную, снимается. Namespace
    // объявлен: без него XML неразбираем и читать в нём нечего.
    const patched = SIMPLE_BPMN.replace(
      'id="Definitions_1"',
      'id="Definitions_1" xmlns:act="http://erp.mes/schema/bpmn/action"'
    ).replace(
      '<bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Approve" />',
      '<bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_Approve">' +
        '<bpmn:extensionElements>' +
        '<act:userAction id="x" label="X" event="E" elementId="EndEvent_1" />' +
        '</bpmn:extensionElements></bpmn:sequenceFlow>'
    );

    expect(getElementActions(patched, 'Flow_1')).toHaveLength(1);
    expect(setElementActions(patched, 'Flow_1', [])).not.toContain(ACTION_TAG_NAME);
  });

  it('без DOM чтение кнопок возвращает пустой список (как `listFlowElements`)', () => {
    const domParser = global.DOMParser;

    global.DOMParser = undefined;
    try {
      expect(listActions(DEFAULT_CUSTOMER_BPMN_XML)).toEqual([]);
      expect(getElementActions(DEFAULT_CUSTOMER_BPMN_XML, 'Task_SecurityCheck')).toEqual([]);
      expect(getStartAction(DEFAULT_CUSTOMER_BPMN_XML)).toBeNull();
    } finally {
      global.DOMParser = domParser;
    }
  });
});

