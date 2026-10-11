/**
 * Роль исполнителя в схеме: проверка на реальном `bpmn-moddle`.
 *
 * Холст `bpmn-js` в jsdom не поднимается (нет SVG-геометрии: `getBBox`,
 * `createSVGTransform`), поэтому импорт/экспорт схемы проверяется на том же
 * парсере, который упакован внутрь `bpmn-js` в вендорном бандле
 * (`bpmn-moddle` 8.1.0 — транзитивная зависимость `bpmn-js@17.11.1`
 * из `BUILD_INFO.json`).
 *
 * Проверяется вся цепочка «редактор -> XML -> движок»:
 *  1. дефолтные схемы SDK разбираются без предупреждений о `potentialOwner`;
 *  2. роль из XML видна модели (`Activity#resources`) — то же, что читает
 *     `BpmnEditor` из `elementRegistry`;
 *  3. пересборка XML из модели роль не теряет (именно это делает `saveXML`);
 *  4. присвоение роли моделью (как в `BpmnEditor.handleChangeRole`) доезжает
 *     до XML и читается хелперами, которыми пользуется приложение;
 *  5. контрольный пример: роль на событии моддл не признаёт — поэтому SDK
 *     такие назначения запрещает.
 */

const BpmnModdle = require('bpmn-moddle');

const {
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_SUPPLIER_BPMN_XML,
} = require('../bpmn-sdk/defaults/milkProcess');
const {
  getElementRole,
  getRoleAssignments,
  setElementRole,
} = require('../bpmn-sdk/xml/bpmnXml');

/** Роли дефолтной схемы Заказчика: задачи -> роль. */
const CUSTOMER_ROLES = {
  Task_CreatePurchaseOrder: 'MANAGER',
  Task_WaitForSupplierShipment: 'MANAGER',
  Task_ReceiveDocsAndIssuePass: 'MANAGER',
  Task_SecurityCheck: 'SECURITY',
  Task_QualityControl: 'QUALITY',
};

/** Роли так, как их видит модель: `bpmn:Activity#resources[0].name`. */
function modelRoles(rootElement) {
  const roles = {};

  rootElement.rootElements[0].flowElements.forEach((element) => {
    const resources = element.get ? element.get('resources') : null;

    if (resources && resources.length > 0 && resources[0].name) {
      roles[element.id] = resources[0].name;
    }
  });

  return roles;
}

/** Тексты предупреждений разбора. */
const warningTexts = (warnings) => warnings.map((warning) => warning.message);

describe('bpmn-moddle: роль исполнителя в схеме', () => {
  const moddle = new BpmnModdle();

  it('разбирает дефолтные схемы моделью (как их увидит редактор)', async () => {
    const { rootElement, warnings } = await moddle.fromXML(DEFAULT_CUSTOMER_BPMN_XML);

    expect(warningTexts(warnings)).toEqual([]);
    expect(modelRoles(rootElement)).toEqual(CUSTOMER_ROLES);
    // Модель и текстовый читатель SDK видят одно и то же.
    expect(getRoleAssignments(DEFAULT_CUSTOMER_BPMN_XML)).toEqual(CUSTOMER_ROLES);
  });

  it('не теряет роли при пересборке XML из модели (`saveXML`)', async () => {
    const { rootElement } = await moddle.fromXML(DEFAULT_CUSTOMER_BPMN_XML);
    const { xml: saved } = await moddle.toXML(rootElement);

    expect(getRoleAssignments(saved)).toEqual(CUSTOMER_ROLES);
    expect(saved).toContain('<bpmn:potentialOwner name="QUALITY" />');
  });

  it('присвоение и снятие роли моделью доезжают до XML (`handleChangeRole`)', async () => {
    const { rootElement } = await moddle.fromXML(DEFAULT_CUSTOMER_BPMN_XML);
    const task = rootElement.rootElements[0].flowElements.find(
      (element) => element.id === 'Task_QualityControl'
    );

    // Ровно то, что делает `BpmnEditor.handleChangeRole`: ресурс, созданный
    // фабрикой моддла, кладётся в `resources` активности.
    task.resources = [moddle.create('bpmn:PotentialOwner', { name: 'SECURITY' })];

    const { xml: saved } = await moddle.toXML(rootElement);

    expect(getElementRole(saved, 'Task_QualityControl')).toBe('SECURITY');
    expect(getElementRole(saved, 'Task_SecurityCheck')).toBe('SECURITY');

    // Снятие роли (`resources: []`) тоже переживает сериализацию.
    task.resources = [];

    const { xml: cleared } = await moddle.toXML(rootElement);

    expect(getElementRole(cleared, 'Task_QualityControl')).toBe('');
    expect(getElementRole(cleared, 'Task_SecurityCheck')).toBe('SECURITY');
  });

  it('схема, собранная хелпером `setElementRole`, читается моделью без потерь', async () => {
    const xml = setElementRole(DEFAULT_SUPPLIER_BPMN_XML, 'Task_SupplierShipment', 'QUALITY');
    const { rootElement, warnings } = await moddle.fromXML(xml);

    expect(warningTexts(warnings)).toEqual([]);
    expect(modelRoles(rootElement)).toEqual({
      Task_SupplierCreateDocs: 'SUPPLIER_MANAGER',
      Task_SupplierShipment: 'QUALITY',
    });
  });

  it('роль на событии схема не принимает: моддл её не признаёт', async () => {
    // Контрольный пример «что было бы, если разрешить роль событию»:
    // `bpmn:potentialOwner` внутри `startEvent` — `unparsable content`,
    // при сохранении схемы роль исчезла бы. Поэтому `setElementRole` и
    // редактор разрешают роль только Activity-узлам.
    const xml = DEFAULT_CUSTOMER_BPMN_XML.replace(
      '<bpmn:outgoing>Flow_C1</bpmn:outgoing>',
      '<bpmn:outgoing>Flow_C1</bpmn:outgoing><bpmn:potentialOwner name="PRODUCTION" />'
    );
    const { warnings } = await moddle.fromXML(xml);

    expect(warningTexts(warnings).join('\n')).toMatch(
      /unparsable content <bpmn:potentialOwner>/
    );
    expect(getRoleAssignments(xml)).toEqual(CUSTOMER_ROLES);
  });
});
