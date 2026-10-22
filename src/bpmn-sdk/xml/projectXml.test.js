/**
 * Тесты проекта: сборка нескольких процессов в одну схему, нарезка для движка и
 * обратная замена процесса.
 *
 * Движок читает только первый `bpmn:process` (`bpm_engine_bpmn/src/parser.rs`),
 * поэтому главная проверка здесь — «нарезка процесса остаётся совместимой со
 * схемой движка», а проект целиком живёт только в редакторе и просмотрщике.
 */

import {
  PROJECT_COLLABORATION_ID,
  buildProjectXml,
  extractProcessXml,
  replaceProcessXml,
} from './projectXml';
import {
  getActionRoles,
  getElementOwners,
  getElementRole,
  getProjectProcesses,
  getProcessIds,
  getRoleCatalog,
  setElementRole,
  validateEngineSchema,
  validateProjectSchema,
} from './bpmnXml';
import {
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_PROJECT_BPMN_XML,
  DEFAULT_SUPPLIER_BPMN_XML,
} from '../defaults/milkProcess';
import {
  DAIRY_PLANT_PROCESS_ID,
  DAIRY_PLANT_PROCESS_XML,
  DAIRY_SUPPLIER_PROCESS_ID,
  DAIRY_SUPPLIER_PROCESS_XML,
} from '../defaults/dairyPlant';

const customerId = () => getProcessIds(DEFAULT_CUSTOMER_BPMN_XML)[0];
const supplierId = () => getProcessIds(DEFAULT_SUPPLIER_BPMN_XML)[0];

describe('projectXml: сборка проекта', () => {
  it('собирает кооперацию, оба процесса и один холст', () => {
    expect(DEFAULT_PROJECT_BPMN_XML).toContain(
      'bpmn:collaboration id="' + PROJECT_COLLABORATION_ID + '"'
    );
    expect(DEFAULT_PROJECT_BPMN_XML).toContain('processRef="' + customerId() + '"');
    expect(DEFAULT_PROJECT_BPMN_XML).toContain('processRef="' + supplierId() + '"');
    expect(DEFAULT_PROJECT_BPMN_XML).toContain('name="Молочный Завод"');
    expect(DEFAULT_PROJECT_BPMN_XML).toContain('name="ООО «Альпийские Луга»"');

    const diagrams = DEFAULT_PROJECT_BPMN_XML.match(/<bpmndi:BPMNDiagram\b/g) || [];
    expect(diagrams).toHaveLength(1);
    expect(DEFAULT_PROJECT_BPMN_XML).toContain('bpmnElement="' + PROJECT_COLLABORATION_ID + '"');
  });

  it('разносит дорожки по вертикали', () => {
    // У обеих демо-схем фигуры начинаются с y≈78: без сдвига они легли бы
    // друг на друга, и вторая дорожка была бы не видна.
    const supplierShape = new RegExp(
      '<bpmndi:BPMNShape id="StartEvent_Supplier_di"[\\s\\S]*?<dc:Bounds x="([\\d.]+)" y="([\\d.]+)"'
    ).exec(DEFAULT_PROJECT_BPMN_XML);

    expect(supplierShape).not.toBeNull();
    expect(Number(supplierShape[2])).toBeGreaterThan(200);
  });

  it('сохраняет каталог ролей каждого процесса', () => {
    const catalog = getRoleCatalog(DEFAULT_PROJECT_BPMN_XML);
    const titles = catalog.map((role) => role.title);

    expect(catalog).toHaveLength(7);
    expect(titles).toContain('Мастер производства');
    expect(titles).toContain('Менеджер Поставщика');

    const executive = catalog.find((role) => role.code === 'EXECUTIVE');
    expect(executive.kind).toBe('EXECUTIVE');
    expect(executive.processId).toBe(customerId());
  });

  it('называет организации по участникам кооперации', () => {
    const processes = getProjectProcesses(DEFAULT_PROJECT_BPMN_XML);

    expect(processes).toEqual([
      expect.objectContaining({ id: customerId(), participantName: 'Молочный Завод' }),
      expect.objectContaining({ id: supplierId(), participantName: 'ООО «Альпийские Луга»' }),
    ]);
  });

  it('отказывается собирать проект без процессов', () => {
    expect(() => buildProjectXml([])).toThrow(/без процессов/);
    expect(() => buildProjectXml([{ xml: '<bpmn:definitions />' }])).toThrow(/bpmn:process/);
  });
});

describe('projectXml: нарезка процесса для движка', () => {
  it('оставляет в нарезке ровно один процесс и его DI', () => {
    const slice = extractProcessXml(DEFAULT_PROJECT_BPMN_XML, supplierId());

    expect(getProcessIds(slice)).toEqual([supplierId()]);
    expect(slice).not.toContain('<bpmn:collaboration');
    expect(slice).not.toContain('<bpmn:participant');
    expect(slice).toContain('Task_SupplierShipment');
    expect(slice).not.toContain('Task_QualityControl');
    expect(slice).toContain('<bpmndi:BPMNDiagram');
  });

  it('нарезка проходит проверку движка', () => {
    [customerId(), supplierId()].forEach((processId) => {
      const report = validateEngineSchema(extractProcessXml(DEFAULT_PROJECT_BPMN_XML, processId));
      expect(report.problems).toEqual([]);
    });
  });

  it('сохраняет роли и каталог своего процесса', () => {
    const slice = extractProcessXml(DEFAULT_PROJECT_BPMN_XML, customerId());
    const codes = getRoleCatalog(slice).map((role) => role.code);

    expect(getElementRole(slice, 'Task_QualityControl')).toBe('QUALITY');
    expect(codes).toContain('PRODUCTION');
    expect(codes).not.toContain('SUPPLIER_MANAGER');
  });

  it('оставляет одно-процессную схему как есть', () => {
    expect(extractProcessXml(DEFAULT_CUSTOMER_BPMN_XML, customerId())).toBe(
      DEFAULT_CUSTOMER_BPMN_XML
    );
    expect(extractProcessXml(DEFAULT_CUSTOMER_BPMN_XML)).toBe(DEFAULT_CUSTOMER_BPMN_XML);
  });

  it('возвращает пустую строку для незнакомого процесса', () => {
    expect(extractProcessXml(DEFAULT_PROJECT_BPMN_XML, 'Process_Unknown')).toBe('');
    expect(extractProcessXml('', customerId())).toBe('');
  });
});

describe('projectXml: замена процесса', () => {
  it('заменяет только свой процесс', () => {
    const edited = setElementRole(DEFAULT_CUSTOMER_BPMN_XML, 'Task_QualityControl', 'MANAGER');
    const project = replaceProcessXml(DEFAULT_PROJECT_BPMN_XML, customerId(), edited);

    const customerSlice = extractProcessXml(project, customerId());
    const supplierSlice = extractProcessXml(project, supplierId());

    expect(getElementRole(customerSlice, 'Task_QualityControl')).toBe('MANAGER');
    expect(getElementRole(supplierSlice, 'Task_SupplierShipment')).toBe('SUPPLIER_MANAGER');
    expect(project.match(/<bpmndi:BPMNPlane\b/g)).toHaveLength(1);
  });

  it('держит дорожку заменённого процесса на месте', () => {
    const edited = setElementRole(DEFAULT_SUPPLIER_BPMN_XML, 'Task_SupplierShipment', 'MANAGER');
    const project = replaceProcessXml(DEFAULT_PROJECT_BPMN_XML, supplierId(), edited);

    // Поставщик в проекте лежит ниже Заказчика: DI демо-схемы (y≈78) должен
    // переехать на его дорожку, иначе блок встал бы поверх чужого процесса.
    const slice = extractProcessXml(project, supplierId());
    expect(getElementRole(slice, 'Task_SupplierShipment')).toBe('MANAGER');
    expect(project.match(/<bpmndi:BPMNPlane\b/g)).toHaveLength(1);

    const shape = new RegExp(
      '<bpmndi:BPMNShape id="StartEvent_Supplier_di"[\\s\\S]*?<dc:Bounds x="([\\d.]+)" y="([\\d.]+)"'
    ).exec(project);

    expect(shape).not.toBeNull();
    expect(Number(shape[2])).toBeGreaterThan(200);
    expect(validateProjectSchema(project).problems).toEqual([]);
  });

  it('не трогает проект, если процесса нет в новой схеме', () => {
    expect(
      replaceProcessXml(DEFAULT_PROJECT_BPMN_XML, 'Process_Unknown', DEFAULT_CUSTOMER_BPMN_XML)
    ).toBe(DEFAULT_PROJECT_BPMN_XML);
  });
});

describe('bpmnXml: роли проекта', () => {
  it('раскладывает роли по процессам', () => {
    const owners = getElementOwners(DEFAULT_PROJECT_BPMN_XML);

    expect(owners.Task_QualityControl).toBe(customerId());
    expect(owners.Task_SupplierShipment).toBe(supplierId());
  });

  it('читает роли кнопок, у которых нет узла-владельца', () => {
    const roles = getActionRoles(DEFAULT_PROJECT_BPMN_XML);

    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ elementId: 'StartEvent_Customer', role: 'PRODUCTION' }),
      ])
    );
  });

  it('проверяет каждый процесс проекта отдельно', () => {
    const broken = DEFAULT_CUSTOMER_BPMN_XML.replace(
      /<bpmn:userTask id="Task_QualityControl"([\s\S]*?)<\/bpmn:userTask>/,
      '<bpmn:task id="Task_QualityControl"$1</bpmn:task>'
    );
    const project = buildProjectXml([{ xml: broken }, { xml: DEFAULT_SUPPLIER_BPMN_XML }]);

    const report = validateProjectSchema(project);

    expect(report.ok).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
    expect(report.problems[0].processId).toBe(customerId());
    expect(validateProjectSchema(DEFAULT_PROJECT_BPMN_XML)).toEqual(
      expect.objectContaining({ ok: true, problems: [] })
    );
  });
});

describe('projectXml: сообщения между процессами (M3)', () => {
  it('проект и нарезки сохраняют корневые bpmn:message', () => {
    const project = buildProjectXml([
      { xml: DAIRY_PLANT_PROCESS_XML, participantName: 'Завод' },
      { xml: DAIRY_SUPPLIER_PROCESS_XML, participantName: 'Поставщик' },
    ]);

    ['Message_PurchaseOrder', 'Message_PurchaseOrderConfirmed', 'Message_MilkShipped'].forEach(
      (id) => expect(project).toContain('<bpmn:message id="' + id + '"')
    );

    // Одно объявление на проект: два `<bpmn:message>` с тем же id сделали бы
    // документ невалидным, а `messageRef` — неоднозначным.
    expect(project.match(/bpmn:message id="Message_MilkShipped"/g)).toHaveLength(1);

    const plant = extractProcessXml(project, DAIRY_PLANT_PROCESS_ID);
    const supplier = extractProcessXml(project, DAIRY_SUPPLIER_PROCESS_ID);

    // Нарезка процесса — то, что уходит в движок: без объявлений и namespace
    // триггера события сообщений и `trg:processTrigger` там не разрешаются.
    expect(plant).toContain('xmlns:trg="http://erp.mes/schema/bpmn/trigger"');
    expect(plant).toContain('messageRef="Message_PurchaseOrder"');
    expect(plant).toContain('trg:processTrigger');
    expect(supplier).toContain('messageRef="Message_MilkShipped"');
    expect(supplier).not.toContain('trg:processTrigger');
  });
});


