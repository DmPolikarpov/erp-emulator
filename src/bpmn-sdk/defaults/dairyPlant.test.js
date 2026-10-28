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
 *  - проект — кооперация трёх процессов: завод, поставщик и клиент. Каждый
 *    следующий пул сдвинут на `DAIRY_PROJECT_ROW_OFFSET`, поэтому пулы не
 *    перекрываются, а контуры кабинета (`CUSTOMER`, `SUPPLIER`, `CLIENT`) идут
 *    в порядке дорожек.
 *
 * Запуск: `npm test -- dairyPlant`.
 */

import {
  DAIRY_CLIENT_PARTICIPANT_NAME,
  DAIRY_CLIENT_PROCESS_ID,
  DAIRY_CLIENT_PROCESS_XML,
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
  getElementTrigger,
  getLocalName,
  getProcessIds,
  getProjectProcesses,
  getRoleCatalog,
  getStartAction,
  isValidAction,
  listActions,
  parseActionVariables,
  parseXml,
  resolveAction,
  validateEngineSchema,
  validateProjectSchema,
} from '../xml/bpmnXml';
import { extractProcessXml } from '../xml/projectXml';

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
  {
    label: 'клиент',
    id: DAIRY_CLIENT_PROCESS_ID,
    xml: DAIRY_CLIENT_PROCESS_XML,
    participant: DAIRY_CLIENT_PARTICIPANT_NAME,
    roles: 2,
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

/** Текст `conditionExpression` связи (пробелы обрезаны). */
function conditionTextOf(xml, flowId) {
  const flow = elementById(xml, flowId);
  if (!flow) return '';

  const condition = childrenOf(flow).find(
    (child) => getLocalName(child) === 'conditionExpression'
  );

  return condition ? (condition.textContent || '').trim() : '';
}

/**
 * Условие связи в грамматике 7.2.
 *
 * Сравнение строк — `==`/`!=`, чисел — `>`, `>=`, `<`, `<=`; отсутствующая
 * переменная читается как пустая строка (так её видит EL движка).
 *
 * @returns {boolean|null} `null` — условия нет; иначе выполнено ли оно.
 */
function conditionHolds(text, variables) {
  const expression = String(text || '').trim();

  if (expression === '') return null;

  const hit =
    /^\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s*\}$/.exec(
      expression
    );

  // Демо-схема других форм не использует: если появится — тест должен упасть,
  // а не «угадать» ветку.
  if (!hit) throw new Error('Условие вне грамматики 7.2: ' + expression);

  const actual = variables[hit[1]] === undefined ? '' : variables[hit[1]];
  const expected =
    hit[3] !== undefined ? hit[3] : hit[4] !== undefined ? hit[4] : hit[5];

  if (hit[2] === '==') return actual === expected;
  if (hit[2] === '!=') return actual !== expected;

  const left = Number(actual);
  const right = Number(expected);

  // Нечисловое сравнение движок глушит в `false` (`transition.rs`).
  if (Number.isNaN(left) || Number.isNaN(right)) return false;

  if (hit[2] === '>') return left > right;
  if (hit[2] === '>=') return left >= right;
  if (hit[2] === '<') return left < right;
  return left <= right;
}

/**
 * Маршрут движка по шлюзу (7.1): связи в порядке объявления, default — после
 * всех; связь без условия выигрывает сразу.
 *
 * @param {Array<{id: string, targetRef: string, conditionText: string}>} flows
 *   исходящие связи шлюза в порядке `<process>`.
 * @param {string} defaultFlowId связь из `<bpmn:exclusiveGateway default="...">`.
 * @param {Object<string, string>} variables переменные кнопки.
 * @returns {string} узел, на который встанет токен (`''` — не выбран).
 */
function routeGateway(flows, defaultFlowId, variables) {
  let fallback = '';

  for (const flow of flows) {
    const holds = conditionHolds(flow.conditionText, variables);

    if (holds === null) {
      if (flow.id === defaultFlowId) {
        fallback = flow.targetRef;
        continue;
      }

      return flow.targetRef;
    }

    if (holds) return flow.targetRef;
  }

  return fallback;
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

        // `elementId` кнопки необязателен: пусто — цель выводится из единственной
        // исходящей связи узла (`resolveAction`), так записаны кнопки M3.
        const target = resolveAction(xml, elementId, action);

        expect(nodes).toContain(target.elementId);
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

  it('связывает пулы сообщениями и триггером узла (M3)', () => {
    const sendPo = listActions(DAIRY_PLANT_PROCESS_XML).find(
      ({ action }) => action.id === 'sendToSupplier'
    );
    const shipMilk = listActions(DAIRY_SUPPLIER_PROCESS_XML).find(
      ({ action }) => action.id === 'shipMilk'
    );

    // Экземпляр поставщика создаёт движок по триггеру throw-события, а не клиент.
    expect(sendPo.action.startsProcess || '').toBe('');
    expect(getElementTrigger(DAIRY_PLANT_PROCESS_XML, 'Event_SendPO')).toMatchObject({
      targetProcessId: DAIRY_SUPPLIER_PROCESS_ID,
      instancePrefix: 'inst-supp-',
      firstElementId: 'Task_ConfirmPO',
      payloadKeys: 'orderNum',
    });

    // Сообщения объявлены на корне схем: иначе `messageRef` не разрешается и
    // имена отправки/ожидания расходятся.
    expect(DAIRY_PLANT_PROCESS_XML).toContain(
      '<bpmn:message id="Message_PurchaseOrder" name="PurchaseOrder" />'
    );
    expect(DAIRY_SUPPLIER_PROCESS_XML).toContain('name="PurchaseOrderConfirmed"');
    expect(DAIRY_SUPPLIER_PROCESS_XML).toContain('name="MilkShipped"');

    // Отгрузка больше не сигналит напрямую (`counterpartEvent`): пару
    // «отправка → ожидание» держит сообщение MilkShipped, а экземпляр завода
    // движок находит по `orderNum`.
    expect(shipMilk.action.counterpartEvent || '').toBe('');
    expect(DAIRY_SUPPLIER_PROCESS_XML).toContain('messageRef="Message_MilkShipped"');
    expect(flowNodeIds(DAIRY_PLANT_PROCESS_XML)).toContain('Event_MilkShipped');
  });

  /**
   * Обратный путь сообщений (M5): завод отвечает клиенту, а не только ждёт ответа
   * поставщика. Без этих двух throw-событий процесс клиента останавливался на
   * `Event_OrderConfirmed` и до приёмки не доходил.
   */
  it('отвечает клиенту подтверждением и отгрузкой (M5)', () => {
    // MF2 — сразу после обработки заказа: клиент узнаёт о подтверждении до
    // проверки остатков, иначе ждал бы его, пока завод закупает сырьё.
    expect(getLocalName(elementById(DAIRY_PLANT_PROCESS_XML, 'Event_ConfirmOrder'))).toBe(
      'intermediateThrowEvent'
    );
    expect(flowIndex(DAIRY_PLANT_PROCESS_XML)).toMatchObject({
      SF3: { sourceRef: 'Task_ProcessOrder', targetRef: 'Event_ConfirmOrder' },
      SF3_Message: { sourceRef: 'Event_ConfirmOrder', targetRef: 'Task_CheckStock' },
    });

    // MF6 — после отгрузки: ветки «со склада» и «после производства» сходятся на
    // `Task_Ship`, поэтому сообщение уходит в обеих.
    expect(getLocalName(elementById(DAIRY_PLANT_PROCESS_XML, 'Event_ShipGoods'))).toBe(
      'intermediateThrowEvent'
    );
    expect(flowIndex(DAIRY_PLANT_PROCESS_XML)).toMatchObject({
      SF20_Ship: { sourceRef: 'Task_Ship', targetRef: 'Event_ShipGoods' },
      SF20_Message: { sourceRef: 'Event_ShipGoods', targetRef: 'End_Main' },
    });

    // `messageRef` разрешается в объявления на корне схемы: имена отправки и
    // ожидания на стороне клиента должны совпадать буквально.
    expect(DAIRY_PLANT_PROCESS_XML).toContain(
      '<bpmn:message id="Message_OrderConfirmed" name="OrderConfirmed" />'
    );
    expect(DAIRY_PLANT_PROCESS_XML).toContain(
      '<bpmn:message id="Message_GoodsShipped" name="GoodsShipped" />'
    );
    expect(DAIRY_PLANT_PROCESS_XML).toContain('messageRef="Message_OrderConfirmed"');
    expect(DAIRY_PLANT_PROCESS_XML).toContain('messageRef="Message_GoodsShipped"');
    expect(DAIRY_CLIENT_PROCESS_XML).toContain('messageRef="Message_OrderConfirmed"');
    expect(DAIRY_CLIENT_PROCESS_XML).toContain('messageRef="Message_GoodsShipped"');
  });
});

/**
 * Маршрут, который посчитает движок M1 (дизайн 7.1–7.2): переменные кнопки
 * подставляются в условия связей шлюза, и «Да»/«Нет» должны вести туда же,
 * куда ведёт `elementId` кнопки. Это и есть совместимость legacy-кнопок с
 * графом: у каждой кнопки ровно один узел.
 */
describe('dairyPlant: маршрут кнопок через шлюзы', () => {
  const xml = DAIRY_PLANT_PROCESS_XML;
  const flows = flowIndex(xml);
  const actions = listActions(xml);

  /** Исходящие связи шлюза в порядке `<process>`. */
  function outgoingOf(gatewayId) {
    return Object.keys(flows)
      .filter((flowId) => flows[flowId].sourceRef === gatewayId)
      .map((flowId) => ({
        id: flowId,
        targetRef: flows[flowId].targetRef,
        conditionText: conditionTextOf(xml, flowId),
      }));
  }

  it('у каждого шлюза один default без условия и условия на остальных', () => {
    const gateways = processChildren(xml, 'exclusiveGateway');

    expect(gateways).toHaveLength(5);

    gateways.forEach((gateway) => {
      const gatewayId = gateway.getAttribute('id');
      const defaultFlowId = gateway.getAttribute('default') || '';
      const outgoing = outgoingOf(gatewayId);
      const defaultFlow = outgoing.find((flow) => flow.id === defaultFlowId);

      expect(defaultFlow).toBeTruthy();
      expect(defaultFlow.conditionText).toBe('');
      expect(outgoing.length).toBeGreaterThan(1);
      outgoing
        .filter((flow) => flow.id !== defaultFlowId)
        .forEach((flow) => expect(flow.conditionText).not.toBe(''));
    });
  });

  it('переменные кнопки-решения ведут в её же elementId', () => {
    processChildren(xml, 'exclusiveGateway').forEach((gateway) => {
      const gatewayId = gateway.getAttribute('id');
      const defaultFlowId = gateway.getAttribute('default') || '';
      const incoming = Object.keys(flows).filter(
        (flowId) => flows[flowId].targetRef === gatewayId
      );

      expect(incoming).toHaveLength(1);

      const hostId = flows[incoming[0]].sourceRef;
      const decisions = actions.filter((entry) => entry.elementId === hostId);

      expect(decisions.length).toBeGreaterThanOrEqual(2);

      decisions.forEach(({ action }) => {
        expect(action.variables).not.toBe('');

        const variables = parseActionVariables(action.variables);
        const target = routeGateway(outgoingOf(gatewayId), defaultFlowId, variables);

        // Ошибка читается как «кнопка X ведёт в Y, а граф — в Z».
        expect([action.id, target]).toEqual([action.id, action.elementId]);
      });
    });
  });

  it('без переменной кнопка уезжает в негативную ветку (fail-closed)', () => {
    // Старый клиент или ручное событие: решения нет — безопаснее остановить
    // линию или вернуть партию, чем молча отгрузить (приложение A).
    const gateway = processChildren(xml, 'exclusiveGateway').find(
      (node) => node.getAttribute('id') === 'Gateway_Stock'
    );

    expect(
      routeGateway(outgoingOf('Gateway_Stock'), gateway.getAttribute('default'), {})
    ).toBe('Task_CreatePO');
  });
});

describe('dairyPlant: внешние задачи ERP', () => {
  const ERP_TASKS = ['Task_ERP_HandleDeviation', 'Task_ERP_CriticalAlert'];

  it('объявлены serviceTask с темой erp и ретраями', () => {
    ERP_TASKS.forEach((taskId) => {
      const task = elementById(DAIRY_PLANT_PROCESS_XML, taskId);

      expect(task).not.toBeNull();
      expect(getLocalName(task)).toBe('serviceTask');
      // Без `camunda:topic` движок ушёл бы в `mes.out.v1.cmd.default`.
      expect(task.getAttribute('camunda:topic')).toBe('erp');
      expect(Number(task.getAttribute('camunda:retries'))).toBe(2);
    });
  });

  it('не несут кнопок: шаг закрывает воркер, а не человек', () => {
    const hosts = listActions(DAIRY_PLANT_PROCESS_XML).map(({ elementId }) => elementId);

    ERP_TASKS.forEach((taskId) => expect(hosts).not.toContain(taskId));
  });
});

describe('dairyPlant: проект', () => {
  it('собирает кооперацию из трёх процессов', () => {
    expect(getProcessIds(DAIRY_PLANT_PROJECT_XML)).toEqual([
      DAIRY_PLANT_PROCESS_ID,
      DAIRY_SUPPLIER_PROCESS_ID,
      DAIRY_CLIENT_PROCESS_ID,
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
      {
        id: DAIRY_CLIENT_PROCESS_ID,
        name: expect.any(String),
        isExecutable: true,
        participantName: DAIRY_CLIENT_PARTICIPANT_NAME,
      },
    ]);

    // Имя проекта — подпись в списке проектов.
    expect(DAIRY_PLANT_PROJECT_NAME).toContain('Молочный завод');
    expect(DAIRY_PLANT_PROJECT_XML).toContain(
      'name="' + DAIRY_PLANT_PROJECT_NAME + '"'
    );
  });

  it('проходит проверку проекта: все процессы совместимы с движком', () => {
    const report = validateProjectSchema(DAIRY_PLANT_PROJECT_XML);

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.processes.map((process) => process.id)).toEqual([
      DAIRY_PLANT_PROCESS_ID,
      DAIRY_SUPPLIER_PROCESS_ID,
      DAIRY_CLIENT_PROCESS_ID,
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

    // Три пула — три контура кабинета, и порядок дорожек задаёт их порядок.
    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.element)).toEqual(
      PROCESSES.map(({ id }) => 'Participant_' + id)
    );

    frames.forEach((frame, index) => {
      expect(frame.y).toBe(index === 0 ? 0 : index * DAIRY_PROJECT_ROW_OFFSET - 20);
    });

    // Пулы стоят друг под другом: нижняя граница пула выше начала следующего.
    expect(frames[0].y + frames[0].height).toBeLessThan(frames[1].y);
    expect(frames[1].y + frames[1].height).toBeLessThan(frames[2].y);

    // Фигуры процессов сдвинуты вместе со своими пулами.
    const shapeYOf = (elementId) => {
      const shape = Array.from(project.getElementsByTagName('*'))
        .filter((node) => getLocalName(node) === 'BPMNShape')
        .find((node) => node.getAttribute('bpmnElement') === elementId);
      const bounds = childrenOf(shape).find((child) => getLocalName(child) === 'Bounds');

      return Number(bounds.getAttribute('y'));
    };

    expect(shapeYOf('Start_Supplier')).toBe(82 + DAIRY_PROJECT_ROW_OFFSET);
    expect(shapeYOf('Start_Client')).toBe(82 + 2 * DAIRY_PROJECT_ROW_OFFSET);
  });
});

/**
 * Третий пул проекта — клиент (`Part_Client`, M5).
 *
 * Процесс входит в `DAIRY_PLANT_PROJECT_XML` третьей дорожкой, поэтому кабинет
 * получает контур `CLIENT`. Схема проверяется теми же инвариантами, что завод и
 * поставщик: движок, связи, роли, кнопки, сообщения обмена и DI.
 */
describe('dairyPlant: клиент (третий пул, M5)', () => {
  const xml = DAIRY_CLIENT_PROCESS_XML;

  it('проходит проверку движка и объявляет роли каталогом', () => {
    expect(parseXml(xml).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(validateEngineSchema(xml)).toEqual({ ok: true, problems: [] });
    expect(getProcessIds(xml)).toEqual([DAIRY_CLIENT_PROCESS_ID]);

    const roles = getRoleCatalog(xml, DAIRY_CLIENT_PROCESS_ID);

    // `CLIENT` ведёт шаги, `CLIENT_DIRECTOR` — руководитель контура (EXECUTIVE).
    expect(roles.map((role) => role.code).sort()).toEqual(['CLIENT', 'CLIENT_DIRECTOR']);
    expect(roles.find((role) => role.code === 'CLIENT_DIRECTOR')).toMatchObject({
      title: 'Руководитель клиента',
      kind: 'EXECUTIVE',
    });
  });

  it('связи сходятся на существующих узлах и объявлены у узлов', () => {
    const nodes = flowNodeIds(xml);
    const flows = flowIndex(xml);

    // Маршрут линейный: заказ → подтверждение заводом → отгрузка → приёмка.
    expect(nodes).toEqual([
      'Start_Client',
      'Task_ConfirmOrder',
      'Event_SendOrder',
      'Event_OrderConfirmed',
      'Event_GoodsShipped',
      'Task_AcceptGoods',
      'End_Client',
    ]);

    Object.keys(flows).forEach((flowId) => {
      expect(nodes).toContain(flows[flowId].sourceRef);
      expect(nodes).toContain(flows[flowId].targetRef);
    });
  });

  it('два шага клиента ведут его же сотрудники', () => {
    const tasks = processChildren(xml, 'userTask');

    expect(tasks.map((task) => task.getAttribute('id'))).toEqual([
      'Task_ConfirmOrder',
      'Task_AcceptGoods',
    ]);

    tasks.forEach((task) => {
      const owner = childrenOf(task).find(
        (child) => getLocalName(child) === 'potentialOwner'
      );

      expect(owner.getAttribute('name')).toBe('CLIENT');
    });

    const start = getStartAction(xml);

    expect(start.elementId).toBe('Start_Client');
    expect(start.action).toMatchObject({
      id: 'placeClientOrder',
      role: 'CLIENT',
      elementId: 'Task_ConfirmOrder',
    });

    // Кнопки подтверждения и приёмки ведут в узлы этого же процесса.
    const nodes = flowNodeIds(xml);
    const actions = listActions(xml);

    expect(actions.map(({ action }) => action.id).sort()).toEqual([
      'acceptGoods',
      'confirmClientOrder',
      'placeClientOrder',
    ]);

    actions.forEach(({ elementId, action }) => {
      expect(nodes).toContain(elementId);
      expect(nodes).toContain(resolveAction(xml, elementId, action).elementId);
    });
  });

  it('обменивается с заводом сообщениями ClientOrder/OrderConfirmed/GoodsShipped', () => {
    const messages = childrenOf(parseXml(xml).documentElement)
      .filter((child) => getLocalName(child) === 'message')
      .map((message) => ({
        id: message.getAttribute('id'),
        name: message.getAttribute('name'),
      }));

    expect(messages).toEqual([
      { id: 'Message_ClientOrder', name: 'ClientOrder' },
      { id: 'Message_OrderConfirmed', name: 'OrderConfirmed' },
      { id: 'Message_GoodsShipped', name: 'GoodsShipped' },
    ]);

    // MF1 клиент отправляет throw-событием, MF2 и MF6 — ждёт catch-событиями.
    expect(getLocalName(elementById(xml, 'Event_SendOrder'))).toBe('intermediateThrowEvent');
    expect(getLocalName(elementById(xml, 'Event_OrderConfirmed'))).toBe(
      'intermediateCatchEvent'
    );
    expect(getLocalName(elementById(xml, 'Event_GoodsShipped'))).toBe(
      'intermediateCatchEvent'
    );

    expect(xml).toContain('messageRef="Message_ClientOrder"');
    expect(xml).toContain('messageRef="Message_OrderConfirmed"');
    expect(xml).toContain('messageRef="Message_GoodsShipped"');
  });

  /**
   * MF1 исполняет движок: кнопка подтверждения не запускает завод сама, а
   * throw-событие несёт `trg:processTrigger`. Иначе заказ клиента попадал бы в
   * «пустое» сообщение — без экземпляра, который его ждёт.
   */
  it('создаёт экземпляр завода триггером узла (M5)', () => {
    expect(getElementTrigger(xml, 'Event_SendOrder')).toMatchObject({
      targetProcessId: DAIRY_PLANT_PROCESS_ID,
      instancePrefix: 'inst-cust-',
      startElementId: 'Event_SendOrder',
      firstElementId: 'Task_ReceiveOrder',
      payloadKeys: 'orderNum',
    });

    // Первый шаг завода — приёмка заказа: триггер входит в тот же узел, который
    // объявлен кнопкой старта завода (`Start_Dairy`), поэтому ручной старт не
    // нужен, а кабинет завода видит активный шаг по токену.
    expect(getStartAction(DAIRY_PLANT_PROCESS_XML).action.elementId).toBe(
      getElementTrigger(xml, 'Event_SendOrder').firstElementId
    );

    // В движок уходит нарезка проекта, а не проект целиком: без namespace
    // триггера и объявления сообщения он не создаст экземпляр завода.
    const clientSlice = extractProcessXml(DAIRY_PLANT_PROJECT_XML, DAIRY_CLIENT_PROCESS_ID);

    expect(clientSlice).toContain('xmlns:trg="http://erp.mes/schema/bpmn/trigger"');
    expect(getElementTrigger(clientSlice, 'Event_SendOrder')).toMatchObject({
      targetProcessId: DAIRY_PLANT_PROCESS_ID,
      instancePrefix: 'inst-cust-',
    });
  });

  it('рисует каждый узел и каждую связь', () => {
    const { shapes, edges } = diIndex(xml);

    flowNodeIds(xml).forEach((nodeId) => expect(shapes).toContain(nodeId));
    Object.keys(flowIndex(xml)).forEach((flowId) => expect(edges).toContain(flowId));
  });
});
