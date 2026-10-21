/**
 * Тест демо-проекта «Молочный завод» (`defaults/dairyPlant.js`).
 *
 * Модуль — это строки BPMN, поэтому проверять его нужно так же, как документацию:
 *  - обе схемы разбираются как XML и проходят проверку движка
 *    (`validateEngineSchema`): типы узлов, шлюзы с `default`, достижимость конца;
 *  - каждая связь и каждый `<incoming>/<outgoing>` ссылаются на существующий
 *    узел: движок компилирует связи, а не графику, и висячая ссылка роняет
 *    определение целиком;
 *  - кнопки (`act:userAction`) ведут в существующие узлы своего процесса, а
 *    роли кнопок и исполнителей (`bpmn:potentialOwner`) объявлены каталогом:
 *    иначе роль не появится на входе в кабинет;
 *  - у каждого узла и связи есть DI: без фигуры bpmn-js нарисует пустой холст;
 *  - проект — кооперация двух процессов, второй пул сдвинут на
 *    `DAIRY_PROJECT_ROW_OFFSET` и не перекрывает первый.
 *
 * Запуск: `npm test -- dairyPlant`.
 */

import {
  DAIRY_PLANT_PARTICIPANT_NAME,
  DAIRY_PLANT_PROCESS_ID,
  DAIRY_PLANT_PROCESS_XML,
  DAIRY_PLANT_PROJECT_NAME,
  DAIRY_PLANT_PROJECT_XML,
  DAIRY_PROJECT_ROW_OFFSET,
  DAIRY_SUPPLIER_PARTICIPANT_NAME,
  DAIRY_SUPPLIER_PROCESS_ID,
  DAIRY_SUPPLIER_PROCESS_XML,
} from './dairyPlant';
import {
  getLocalName,
  getProcessIds,
  getProjectProcesses,
  getRoleCatalog,
  getStartAction,
  isValidAction,
  listActions,
  parseXml,
  validateEngineSchema,
  validateProjectSchema,
} from '../xml/bpmnXml';

/** Схемы процессов проекта: ожидаемые роли каталога и подписи пулов. */
const PROCESSES = [
  {
    label: 'завод',
    id: DAIRY_PLANT_PROCESS_ID,
    xml: DAIRY_PLANT_PROCESS_XML,
    participant: DAIRY_PLANT_PARTICIPANT_NAME,
    roles: 9,
  },
  {
    label: 'поставщик',
    id: DAIRY_SUPPLIER_PROCESS_ID,
    xml: DAIRY_SUPPLIER_PROCESS_XML,
    participant: DAIRY_SUPPLIER_PARTICIPANT_NAME,
    roles: 3,
  },
];

/** Дети элемента DOM (без текстовых узлов). */
function childrenOf(node) {
  return Array.from((node && node.children) || []).filter((child) => child.nodeType === 1);
}

/** Дети процесса с указанным локальным именем. */
function processChildren(xml, localName) {
  const doc = parseXml(xml);
  if (!doc) return [];

  const process = Array.from(doc.getElementsByTagName('*')).find(
    (node) => getLocalName(node) === 'process'
  );

  return childrenOf(process).filter((child) => getLocalName(child) === localName);
}

/** Идентификаторы узлов потока процесса (startEvent, userTask, шлюзы, endEvent). */
function flowNodeIds(xml) {
  const doc = parseXml(xml);
  if (!doc) return [];

  const process = Array.from(doc.getElementsByTagName('*')).find(
    (node) => getLocalName(node) === 'process'
  );

  return childrenOf(process)
    .filter((child) => getLocalName(child) !== 'sequenceFlow')
    .filter((child) => getLocalName(child) !== 'extensionElements')
    .filter((child) => getLocalName(child) !== 'laneSet')
    .filter((child) => getLocalName(child) !== 'documentation')
    .map((child) => child.getAttribute('id'))
    .filter(Boolean);
}

/** Связи процесса: `{id: {sourceRef, targetRef}}`. */
function flowIndex(xml) {
  const flows = {};

  processChildren(xml, 'sequenceFlow').forEach((flow) => {
    flows[flow.getAttribute('id')] = {
      sourceRef: flow.getAttribute('sourceRef') || '',
      targetRef: flow.getAttribute('targetRef') || '',
    };
  });

  return flows;
}

/** Элемент документа по `id` (первый найденный). */
function elementById(xml, id) {
  const doc = parseXml(xml);
  if (!doc) return null;

  return (
    Array.from(doc.getElementsByTagName('*')).find(
      (node) => node.getAttribute('id') === id
    ) || null
  );
}

/** Значения `bpmnElement` фигур (`BPMNShape`) и рёбер (`BPMNEdge`) схемы. */
function diIndex(xml) {
  const doc = parseXml(xml);
  const shapes = [];
  const edges = [];

  if (!doc) return { shapes, edges };

  Array.from(doc.getElementsByTagName('*')).forEach((node) => {
    const localName = getLocalName(node);

    if (localName === 'BPMNShape') shapes.push(node.getAttribute('bpmnElement') || '');
    if (localName === 'BPMNEdge') edges.push(node.getAttribute('bpmnElement') || '');
  });

  return { shapes, edges };
}

describe('dairyPlant: процессы', () => {
  PROCESSES.forEach(({ label, id, xml, roles }) => {
    describe(label, () => {
      it('разбирается как XML и проходит проверку движка', () => {
        const doc = parseXml(xml);

        expect(doc).not.toBeNull();
        expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
        expect(validateEngineSchema(xml)).toEqual({ ok: true, problems: [] });
        expect(getProcessIds(xml)).toEqual([id]);
        expect(getRoleCatalog(xml, id)).toHaveLength(roles);
      });

      it('не содержит связей и метаданных узлов без адресата', () => {
        const nodes = flowNodeIds(xml);
        const flows = flowIndex(xml);
        const outgoing = {};
        const incoming = {};

        nodes.forEach((nodeId) => outgoing[nodeId] = []);
        nodes.forEach((nodeId) => incoming[nodeId] = []);

        Object.keys(flows).forEach((flowId) => {
          const { sourceRef, targetRef } = flows[flowId];

          expect(nodes).toContain(sourceRef);
          expect(nodes).toContain(targetRef);

          if (outgoing[sourceRef]) outgoing[sourceRef].push(flowId);
          if (incoming[targetRef]) incoming[targetRef].push(flowId);
        });

        // `<bpmn:incoming>/<bpmn:outgoing>` — это объявление связей у узла;
        // расхождение с `sequenceFlow` ломает чтение схемы и правки в редакторе.
        nodes.forEach((nodeId) => {
          const node = elementById(xml, nodeId);

          if (!node) return;

          childrenOf(node)
            .filter((child) => getLocalName(child) === 'incoming')
            .forEach((child) => {
              const flowId = (child.textContent || '').trim();
              expect(flows[flowId]).toBeDefined();
              expect(flows[flowId].targetRef).toBe(nodeId);
            });

          childrenOf(node)
            .filter((child) => getLocalName(child) === 'outgoing')
            .forEach((child) => {
              const flowId = (child.textContent || '').trim();
              expect(flows[flowId]).toBeDefined();
              expect(flows[flowId].sourceRef).toBe(nodeId);
            });

          // Объявлены ровно те связи, что сходятся на узле: лишних и забытых нет.
          expect(
            childrenOf(node)
              .filter((child) => getLocalName(child) === 'incoming')
              .map((child) => (child.textContent || '').trim())
              .sort()
          ).toEqual(incoming[nodeId].slice().sort());

          expect(
            childrenOf(node)
              .filter((child) => getLocalName(child) === 'outgoing')
              .map((child) => (child.textContent || '').trim())
              .sort()
          ).toEqual(outgoing[nodeId].slice().sort());
        });
      });
    });
  });
});


describe('dairyPlant: кнопки и роли', () => {
  it('каждая кнопка валидна и ведёт в узел своего процесса', () => {
    PROCESSES.forEach(({ xml }) => {
      const nodes = flowNodeIds(xml);
      const actions = listActions(xml);

      expect(actions.length).toBeGreaterThan(0);

      actions.forEach(({ elementId, action }) => {
        expect(nodes).toContain(elementId);
        expect(isValidAction(action)).toBe(true);
        expect(nodes).toContain(action.elementId);
      });
    });
  });

  it('кнопки и исполнители объявлены в каталоге ролей', () => {
    PROCESSES.forEach(({ id, xml }) => {
      const codes = getRoleCatalog(xml, id).map((role) => role.code);
      const owners = processChildren(xml, 'userTask')
        .map((task) => {
          const owner = childrenOf(task).find(
            (child) => getLocalName(child) === 'potentialOwner'
          );

          return owner ? owner.getAttribute('name') : '';
        })
        .filter(Boolean);
      const actionRoles = listActions(xml)
        .map(({ action }) => action.role)
        .filter(Boolean);

      expect(codes.length).toBeGreaterThan(0);
      owners.forEach((code) => expect(codes).toContain(code));
      actionRoles.forEach((code) => expect(codes).toContain(code));
    });
  });

  it('стартовые кнопки объявляют роль инициатора и первый шаг', () => {
    const plantStart = getStartAction(DAIRY_PLANT_PROCESS_XML);
    const supplierStart = getStartAction(DAIRY_SUPPLIER_PROCESS_XML);

    expect(plantStart.elementId).toBe('Start_Dairy');
    expect(plantStart.action).toMatchObject({
      id: 'createOrder',
      role: 'SALES',
      elementId: 'Task_ReceiveOrder',
    });

    expect(supplierStart.elementId).toBe('Start_Supplier');
    expect(supplierStart.action).toMatchObject({
      id: 'startSupplierProcess',
      role: 'SUPPLIER_MANAGER',
      elementId: 'Task_ConfirmPO',
    });
  });

  it('связывает пулы теми же полями, что и демо-закупка', () => {
    const sendPo = listActions(DAIRY_PLANT_PROCESS_XML).find(
      ({ action }) => action.id === 'sendToSupplier'
    );
    const shipMilk = listActions(DAIRY_SUPPLIER_PROCESS_XML).find(
      ({ action }) => action.id === 'shipMilk'
    );

    // Завод запускает процесс второй стороны (`startsProcess`).
    expect(sendPo.action.startsProcess).toBe(DAIRY_SUPPLIER_PROCESS_ID);

    // Поставщик сигналит в экземпляр завода (`counterpartEvent`): так в проекте
    // выражен `bpmn:messageFlow` из исходной схемы.
    expect(shipMilk.action.counterpartEvent).toBe('milkShipped');
    expect(shipMilk.action.counterpartElementId).toBe('Task_ReceiveMilk');
    expect(flowNodeIds(DAIRY_PLANT_PROCESS_XML)).toContain(
      shipMilk.action.counterpartElementId
    );
  });
});

describe('dairyPlant: проект', () => {
  it('собирает кооперацию из двух процессов', () => {
    expect(getProcessIds(DAIRY_PLANT_PROJECT_XML)).toEqual([
      DAIRY_PLANT_PROCESS_ID,
      DAIRY_SUPPLIER_PROCESS_ID,
    ]);

    const processes = getProjectProcesses(DAIRY_PLANT_PROJECT_XML);

    expect(processes).toEqual([
      {
        id: DAIRY_PLANT_PROCESS_ID,
        name: expect.any(String),
        isExecutable: true,
        participantName: DAIRY_PLANT_PARTICIPANT_NAME,
      },
      {
        id: DAIRY_SUPPLIER_PROCESS_ID,
        name: expect.any(String),
        isExecutable: true,
        participantName: DAIRY_SUPPLIER_PARTICIPANT_NAME,
      },
    ]);

    // Имя проекта — подпись в списке проектов.
    expect(DAIRY_PLANT_PROJECT_NAME).toContain('Молочный завод');
    expect(DAIRY_PLANT_PROJECT_XML).toContain(
      'name="' + DAIRY_PLANT_PROJECT_NAME + '"'
    );
  });

  it('проходит проверку проекта: оба процесса совместимы с движком', () => {
    const report = validateProjectSchema(DAIRY_PLANT_PROJECT_XML);

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.processes.map((process) => process.id)).toEqual([
      DAIRY_PLANT_PROCESS_ID,
      DAIRY_SUPPLIER_PROCESS_ID,
    ]);
  });

  it('рисует каждый узел и связь и не перекрывает пулы', () => {
    const project = parseXml(DAIRY_PLANT_PROJECT_XML);
    const { shapes, edges } = diIndex(DAIRY_PLANT_PROJECT_XML);

    // Без фигуры или ребра bpmn-js покажет узел «пустым»: связь не нарисуется.
    PROCESSES.forEach(({ xml }) => {
      flowNodeIds(xml).forEach((nodeId) => expect(shapes).toContain(nodeId));
      Object.keys(flowIndex(xml)).forEach((flowId) => expect(edges).toContain(flowId));
    });

    const frames = Array.from(project.getElementsByTagName('*'))
      .filter((node) => getLocalName(node) === 'BPMNShape')
      .filter((node) => /^Participant_/.test(node.getAttribute('bpmnElement') || ''))
      .map((node) => {
        const bounds = childrenOf(node).find(
          (child) => getLocalName(child) === 'Bounds'
        );

        return {
          element: node.getAttribute('bpmnElement'),
          y: Number(bounds.getAttribute('y')),
          height: Number(bounds.getAttribute('height')),
        };
      });

    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ element: 'Participant_' + DAIRY_PLANT_PROCESS_ID, y: 0 });
    expect(frames[1]).toMatchObject({
      element: 'Participant_' + DAIRY_SUPPLIER_PROCESS_ID,
      y: DAIRY_PROJECT_ROW_OFFSET - 20,
    });

    // Пулы стоят друг под другом: нижняя граница завода выше начала поставщика.
    expect(frames[0].y + frames[0].height).toBeLessThan(frames[1].y);

    // Фигуры второго процесса сдвинуты вместе с пулом.
    const start = Array.from(project.getElementsByTagName('*'))
      .filter((node) => getLocalName(node) === 'BPMNShape')
      .find((node) => node.getAttribute('bpmnElement') === 'Start_Supplier');
    const startBounds = childrenOf(start).find(
      (child) => getLocalName(child) === 'Bounds'
    );

    expect(Number(startBounds.getAttribute('y'))).toBe(82 + DAIRY_PROJECT_ROW_OFFSET);
  });
});
