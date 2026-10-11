import {
  escapeRegExp,
  getElementIds,
  getElementRole,
  getLocalName,
  getProcessIds,
  getRoleAssignments,
  isElementIdAvailable,
  isFlowElement,
  isFlowElementType,
  isIdAvailableAmong,
  isValidElementId,
  isValidRole,
  isValidXml,
  listFlowElements,
  parseXml,
  renameElementId,
  setElementRole,
} from './bpmnXml';

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
