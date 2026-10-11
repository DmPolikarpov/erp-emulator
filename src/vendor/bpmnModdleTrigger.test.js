/**
 * Кросс-процессный триггер (`trg:processTrigger`): проверка на реальном
 * `bpmn-moddle`.
 *
 * Холст `bpmn-js` в jsdom не поднимается (нет SVG-геометрии: `getBBox`,
 * `createSVGTransform`), поэтому запись/чтение расширения проверяется на том же
 * парсере, который упакован внутрь `bpmn-js` в вендорном бандле
 * (`bpmn-moddle` 8.1.0 — транзитивная зависимость `bpmn-js@17.11.1`
 * из `BUILD_INFO.json`).
 *
 * Проверяется вся цепочка «редактор -> XML -> движок»:
 *  1. триггер, записанный хелпером `setElementTrigger`, читается моделью без
 *     предупреждений — то же, что увидит `BpmnEditor` в `elementRegistry`;
 *  2. пересборка XML из модели триггер не теряет (именно это делает `saveXML`);
 *  3. присвоение и снятие триггера моделью (как в
 *     `BpmnEditor.handleChangeTrigger`) доезжают до XML и читаются хелперами,
 *     которыми пользуется приложение, не затирая роль исполнителя узла;
 *  4. без регистрации `TRIGGER_MODELE_EXTENSIONS` тип остаётся «безымянным»:
 *     модель узнаёт расширение по имени тега, а не как `trg:ProcessTrigger`,
 *     и создать его через `moddle.create` нельзя — редактор такой триггер не
 *     читает и не пишет (о ловушке с ролью — в `bpmnModdleRole.test.js`).
 */

const BpmnModdle = require('bpmn-moddle');

const {
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_SUPPLIER_BPMN_XML,
} = require('../bpmn-sdk/defaults/milkProcess');
const {
  getElementRole,
  getElementTrigger,
  getProcessIds,
  getTriggerAssignments,
  setElementTrigger,
} = require('../bpmn-sdk/xml/bpmnXml');
const {
  TRIGGER_FIELDS,
  TRIGGER_MODELE_EXTENSIONS,
  TRIGGER_TYPE,
} = require('../bpmn-sdk/xml/triggerModdle');

/** Триггер, который заказчик ставит на ожидание отгрузки поставщиком. */
const TRIGGER = {
  targetProcessId: 'Process_SupplierSupply_v1',
  instancePrefix: 'inst-supp-',
  startElementId: 'Task_WaitForSupplierShipment',
  firstElementId: 'Task_SupplierCreateDocs',
  payloadKeys: 'orderNum,volume',
};

/** Узел-владелец триггера в дефолтной схеме Заказчика. */
const TRIGGER_HOST = 'Task_WaitForSupplierShipment';

/** Узел-владелец триггера в модели. */
function modelHost(rootElement, elementId = TRIGGER_HOST) {
  return rootElement.rootElements[0].flowElements.find(
    (element) => element.id === elementId
  );
}

/** Элемент расширения узла так, как его видит модель (`extensionElements.values`). */
function modelTrigger(rootElement, elementId) {
  const node = modelHost(rootElement, elementId);
  const values = (node.extensionElements && node.extensionElements.values) || [];

  return values.find((value) => value.$type === TRIGGER_TYPE) || null;
}

/** Поля триггера модели: ровно `TRIGGER_FIELDS` плюс `$type`. */
function modelFields(trigger) {
  const fields = { $type: trigger.$type };

  TRIGGER_FIELDS.forEach((name) => {
    fields[name] = trigger.get(name);
  });

  return fields;
}

/** Тексты предупреждений разбора. */
const warningTexts = (warnings) => warnings.map((warning) => warning.message);

describe('bpmn-moddle: кросс-процессный триггер (trg:processTrigger)', () => {
  const moddle = new BpmnModdle(TRIGGER_MODELE_EXTENSIONS);

  it('читает триггер, записанный хелпером `setElementTrigger`, без предупреждений', async () => {
    const xml = setElementTrigger(DEFAULT_CUSTOMER_BPMN_XML, TRIGGER_HOST, TRIGGER);
    const { rootElement, warnings } = await moddle.fromXML(xml);

    expect(warningTexts(warnings)).toEqual([]);
    expect(modelFields(modelTrigger(rootElement, TRIGGER_HOST))).toEqual({
      $type: TRIGGER_TYPE,
      ...TRIGGER,
    });

    // Модель и текстовый читатель SDK видят одно и то же.
    expect(getElementTrigger(xml, TRIGGER_HOST)).toEqual(TRIGGER);
    expect(getTriggerAssignments(xml)).toEqual({ [TRIGGER_HOST]: TRIGGER });
    // Целевой процесс есть в схеме Поставщика — ссылка не «в воздух».
    expect(getProcessIds(DEFAULT_SUPPLIER_BPMN_XML)).toContain(TRIGGER.targetProcessId);
  });

  it('не теряет триггер при пересборке XML из модели (`saveXML`)', async () => {
    const xml = setElementTrigger(DEFAULT_CUSTOMER_BPMN_XML, TRIGGER_HOST, TRIGGER);
    const { rootElement } = await moddle.fromXML(xml);
    const { xml: saved } = await moddle.toXML(rootElement, { format: true });

    expect(saved).toContain('<trg:processTrigger ');
    expect(getElementTrigger(saved, TRIGGER_HOST)).toEqual(TRIGGER);
  });

  it('присвоение и снятие триггера моделью доезжают до XML (`handleChangeTrigger`)', async () => {
    const { rootElement } = await moddle.fromXML(DEFAULT_CUSTOMER_BPMN_XML);
    const task = rootElement.rootElements[0].flowElements.find(
      (element) => element.id === TRIGGER_HOST
    );

    // Ровно то, что делает `BpmnEditor.handleChangeTrigger`: расширения узла
    // пересобираются новым объектом `bpmn:ExtensionElements`.
    task.extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [moddle.create(TRIGGER_TYPE, TRIGGER)],
    });

    const { xml: assigned } = await moddle.toXML(rootElement);

    expect(getElementTrigger(assigned, TRIGGER_HOST)).toEqual(TRIGGER);
    // Роль исполнителя — не расширение, триггер её не затирает.
    expect(getElementRole(assigned, TRIGGER_HOST)).toBe('MANAGER');

    // Снятие (`null` в панели) — удаление контейнера целиком.
    task.extensionElements = undefined;

    const { xml: cleared } = await moddle.toXML(rootElement);

    expect(getElementTrigger(cleared, TRIGGER_HOST)).toBeNull();
    expect(cleared).not.toContain('processTrigger');
    expect(getElementRole(cleared, TRIGGER_HOST)).toBe('MANAGER');
  });

  it('без регистрации расширения модель не признаёт тип (ловушка «тихого» расширения)', async () => {
    // Контрольный пример «что было бы, если не зарегистрировать дескриптор».
    // Ловушка именно тихая: `bpmn-moddle` предупреждений не выдаёт и элемент
    // сохраняет, но его `$type` — имя тега из XML (`trg:processTrigger`), а не
    // тип moddle (`trg:ProcessTrigger`), поэтому тип «не находится».
    const xml = setElementTrigger(DEFAULT_CUSTOMER_BPMN_XML, TRIGGER_HOST, TRIGGER);
    const plain = new BpmnModdle();
    const { rootElement, warnings } = await plain.fromXML(xml);
    const values = modelHost(rootElement).extensionElements.values;

    expect(warningTexts(warnings)).toEqual([]);
    expect(values.map((value) => value.$type)).toEqual(['trg:processTrigger']);
    expect(values[0].$instanceOf(TRIGGER_TYPE)).toBe(false);
    // Это и есть следствие: `triggerOfBusinessObject` из `BpmnEditor` видит
    // `null` — панель настроек триггер не показывает.
    expect(modelTrigger(rootElement, TRIGGER_HOST)).toBeNull();

    // Запись через модель невозможна: то же исключение ловит
    // `BpmnEditor.handleChangeTrigger` и возвращает `false` (откат полей).
    expect(() => plain.create(TRIGGER_TYPE)).toThrow(/unknown type/);

    // Текстовый читатель SDK триггер видит независимо от моделлера: движок
    // читает XML, а не модель редактора.
    expect(getElementTrigger(xml, TRIGGER_HOST)).toEqual(TRIGGER);
  });

  it('не пишет пустые необязательные поля: модель читает их как `undefined`', async () => {
    const xml = setElementTrigger(DEFAULT_CUSTOMER_BPMN_XML, TRIGGER_HOST, {
      targetProcessId: TRIGGER.targetProcessId,
    });

    expect(xml).toContain(
      '<trg:processTrigger targetProcessId="' + TRIGGER.targetProcessId + '" />'
    );

    const { rootElement, warnings } = await moddle.fromXML(xml);
    const fields = modelFields(modelTrigger(rootElement, TRIGGER_HOST));

    expect(warningTexts(warnings)).toEqual([]);
    expect(fields.$type).toBe(TRIGGER_TYPE);
    expect(fields.targetProcessId).toBe(TRIGGER.targetProcessId);
    expect(TRIGGER_FIELDS.slice(1).map((name) => fields[name])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // Текстовый читатель отдаёт все поля строкой: пустые — `''`.
    expect(getElementTrigger(xml, TRIGGER_HOST)).toEqual({
      targetProcessId: TRIGGER.targetProcessId,
      instancePrefix: '',
      startElementId: '',
      firstElementId: '',
      payloadKeys: '',
    });
  });
});
