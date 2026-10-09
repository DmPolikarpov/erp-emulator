import {
  escapeRegExp,
  getElementIds,
  getLocalName,
  getProcessIds,
  isElementIdAvailable,
  isFlowElement,
  isFlowElementType,
  isIdAvailableAmong,
  isValidElementId,
  isValidXml,
  listFlowElements,
  parseXml,
  renameElementId,
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
