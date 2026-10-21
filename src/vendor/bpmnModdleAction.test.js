/**
 * Кнопки участников (`act:userAction`): проверка на реальном `bpmn-moddle`.
 *
 * Холст `bpmn-js` в jsdom не поднимается (нет SVG-геометрии: `getBBox`,
 * `createSVGTransform`), поэтому запись/чтение расширения проверяется на том же
 * парсере, который упакован внутрь `bpmn-js` в вендорном бандле (`bpmn-moddle` —
 * транзитивная зависимость `bpmn-js`).
 *
 * Проверяется вся цепочка «редактор -> XML -> кабинет»:
 *  1. кнопка, записанная хелпером `setElementActions`, читается моделью без
 *     предупреждений — то же, что увидит `BpmnEditor` в `elementRegistry`;
 *  2. пересборка XML из модели кнопки не теряет (именно это делает `saveXML`);
 *  3. присвоение и снятие списка кнопок моделью (как в
 *     `BpmnEditor.handleChangeActions`) доезжают до XML и читаются хелперами,
 *     которыми пользуется приложение, не затирая роль исполнителя узла;
 *  4. `id` кнопки тип наследует от базового `Element`, поэтому его сохранение
 *     проверяется отдельно: по `id` кабинет сопоставляет кнопку из схемы с
 *     вычисляемым payload;
 *  5. без регистрации `ACTION_MODELE_EXTENSIONS` тип остаётся «безымянным»:
 *     модель узнаёт расширение по имени тега, а не как `act:UserAction`, и
 *     создать его через `moddle.create` нельзя — редактор такую кнопку не
 *     прочитает и не запишет.
 */

const BpmnModdle = require('bpmn-moddle');

const { DEFAULT_CUSTOMER_BPMN_XML } = require('../bpmn-sdk/defaults/milkProcess');
const {
  getElementActions,
  getElementRole,
  setElementActions,
} = require('../bpmn-sdk/xml/bpmnXml');
const {
  ACTION_FIELDS,
  ACTION_MODELE_EXTENSIONS,
  ACTION_TYPE,
} = require('../bpmn-sdk/xml/actionModdle');
const { ROLE_MODELE_EXTENSIONS } = require('../bpmn-sdk/xml/rolesModdle');

/**
 * Расширения моделлера как у редактора: кроме кнопок он знает и каталог ролей
 * (`role:catalog`), который теперь есть в демо-схемах.
 */
const MODELE_EXTENSIONS = { ...ACTION_MODELE_EXTENSIONS, ...ROLE_MODELE_EXTENSIONS };

/** Кнопка со всеми заполненными полями: так видно, что читается каждое. */
const ACTION = {
  id: 'issuePass',
  label: 'Выписать пропуск на КПП',
  role: 'MANAGER',
  icon: 'KeyRound',
  event: 'IssuePass',
  elementId: 'Task_SecurityCheck',
  counterpartEvent: 'DocsReceived',
  counterpartElementId: 'Task_WaitForSupplierShipment',
  startsProcess: 'Process_SupplierSupply_v1',
};

/** Узел-хост кнопок в дефолтной схеме Заказчика. */
const ACTION_HOST = 'Task_ReceiveDocsAndIssuePass';

/** Узел-владелец расширений в модели. */
function modelHost(rootElement, elementId = ACTION_HOST) {
  return rootElement.rootElements[0].flowElements.find(
    (element) => element.id === elementId
  );
}

/** Кнопки узла так, как их видит модель (`extensionElements.values`). */
function modelActions(rootElement, elementId) {
  const node = modelHost(rootElement, elementId);
  const values = (node.extensionElements && node.extensionElements.values) || [];

  return values.filter((value) => value && value.$type === ACTION_TYPE);
}

/** Поля кнопки модели: ровно `ACTION_FIELDS` плюс `$type`. */
function modelFields(action) {
  const fields = { $type: action.$type };

  ACTION_FIELDS.forEach((name) => {
    fields[name] = action.get(name);
  });

  return fields;
}

/** Тексты предупреждений разбора. */
const warningTexts = (warnings) => warnings.map((warning) => warning.message);

describe('bpmn-moddle: кнопки участников (act:userAction)', () => {
  const moddle = new BpmnModdle(MODELE_EXTENSIONS);

  it('читает кнопку, записанную хелпером `setElementActions`, без предупреждений', async () => {
    const xml = setElementActions(DEFAULT_CUSTOMER_BPMN_XML, ACTION_HOST, [ACTION]);
    const { rootElement, warnings } = await moddle.fromXML(xml);

    expect(warningTexts(warnings)).toEqual([]);
    expect(modelFields(modelActions(rootElement)[0])).toEqual({
      $type: ACTION_TYPE,
      ...ACTION,
    });
  });

  it('не теряет кнопки при пересборке XML из модели (`saveXML`)', async () => {
    const xml = setElementActions(DEFAULT_CUSTOMER_BPMN_XML, ACTION_HOST, [ACTION]);
    const { rootElement } = await moddle.fromXML(xml);
    const { xml: saved } = await moddle.toXML(rootElement, { format: true });

    expect(getElementActions(saved, ACTION_HOST)).toEqual([ACTION]);
  });

  it('присвоение и снятие списка кнопок моделью доезжают до XML', async () => {
    const { rootElement } = await moddle.fromXML(DEFAULT_CUSTOMER_BPMN_XML);
    const task = modelHost(rootElement);
    const second = { ...ACTION, id: 'approve', label: 'Согласовать', event: 'Approve' };

    // Ровно то, что делает `BpmnEditor.handleChangeActions`: расширения узла
    // пересобираются новым объектом `bpmn:ExtensionElements`.
    task.extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [ACTION, second].map((action) => moddle.create(ACTION_TYPE, action)),
    });

    const { xml: assigned } = await moddle.toXML(rootElement);

    expect(getElementActions(assigned, ACTION_HOST).map((action) => action.id)).toEqual([
      'issuePass',
      'approve',
    ]);
    // Роль исполнителя — не расширение, кнопки её не затирают.
    expect(getElementRole(assigned, ACTION_HOST)).toBe('MANAGER');

    // Снятие (пустой список в панели) — удаление контейнера целиком.
    const assignedTags = (assigned.match(/<act:userAction/g) || []).length;
    task.extensionElements = undefined;

    const { xml: cleared } = await moddle.toXML(rootElement);

    expect(getElementActions(cleared, ACTION_HOST)).toEqual([]);
    // У узла-хоста расширений больше нет: две его кнопки исчезли из схемы,
    // а кнопки остальных узлов (демо-схема) остались.
    expect((cleared.match(/<act:userAction/g) || []).length).toBe(assignedTags - 2);
    expect(getElementRole(cleared, ACTION_HOST)).toBe('MANAGER');
  });

  it('сохраняет `id` кнопки, который тип наследует от `Element`', async () => {
    // `id` не объявлен в дескрипторе (он есть у базового `Element`), поэтому
    // проверяется отдельно: без него кнопка из схемы не сопоставляется с
    // действием кабинета.
    const xml = setElementActions(DEFAULT_CUSTOMER_BPMN_XML, ACTION_HOST, [ACTION]);
    const { rootElement, warnings } = await moddle.fromXML(xml);
    const action = modelActions(rootElement)[0];

    expect(warningTexts(warnings)).toEqual([]);
    expect(action.id).toBe('issuePass');
    expect(action.get('id')).toBe('issuePass');

    const { xml: saved } = await moddle.toXML(rootElement);
    expect(saved).toContain('id="issuePass"');
  });

  it('не пишет пустые необязательные поля: модель читает их как `undefined`', async () => {
    const minimal = {
      id: 'issuePass',
      label: 'Выписать пропуск',
      event: 'IssuePass',
      elementId: 'Task_SecurityCheck',
    };
    const xml = setElementActions(DEFAULT_CUSTOMER_BPMN_XML, ACTION_HOST, [minimal]);

    expect(xml).toContain(
      '<act:userAction id="issuePass" label="Выписать пропуск" event="IssuePass" elementId="Task_SecurityCheck" />'
    );

    const { rootElement, warnings } = await moddle.fromXML(xml);
    const fields = modelFields(modelActions(rootElement)[0]);

    expect(warningTexts(warnings)).toEqual([]);
    expect(fields.$type).toBe(ACTION_TYPE);
    expect([
      fields.role,
      fields.icon,
      fields.counterpartEvent,
      fields.counterpartElementId,
      fields.startsProcess,
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);

    // Текстовый читатель отдаёт все поля строкой: пустые — `''`.
    expect(getElementActions(xml, ACTION_HOST)).toEqual([
      {
        id: 'issuePass',
        label: 'Выписать пропуск',
        role: '',
        icon: '',
        event: 'IssuePass',
        elementId: 'Task_SecurityCheck',
        counterpartEvent: '',
        counterpartElementId: '',
        startsProcess: '',
      },
    ]);
  });

  it('без регистрации расширения модель не признаёт тип (ловушка «тихого» расширения)', async () => {
    // Контрольный пример «что было бы, если не зарегистрировать дескриптор»:
    // `bpmn-moddle` предупреждений не выдаёт и элемент сохраняет, но его `$type`
    // — имя тега из XML (`act:userAction`), а не тип moddle (`act:UserAction`).
    const xml = setElementActions(DEFAULT_CUSTOMER_BPMN_XML, ACTION_HOST, [ACTION]);
    const plain = new BpmnModdle(ROLE_MODELE_EXTENSIONS);
    const { rootElement, warnings } = await plain.fromXML(xml);
    const values = modelHost(rootElement).extensionElements.values;

    expect(warningTexts(warnings)).toEqual([]);
    expect(values.map((value) => value.$type)).toContain('act:userAction');
    // Это и есть следствие: `actionsOfBusinessObject` из `BpmnEditor` видит `[]`
    // — панель настроек кнопок пуста, а запись через модель невозможна.
    expect(modelActions(rootElement)).toEqual([]);
    expect(() => plain.create(ACTION_TYPE)).toThrow(/unknown type/);

    // Текстовый читатель SDK кнопки видит независимо от моделлера: кабинет
    // читает XML, а не модель редактора.
    expect(getElementActions(xml, ACTION_HOST)).toEqual([ACTION]);
  });
});
