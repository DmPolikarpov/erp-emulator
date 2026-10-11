/**
 * Moddle-описание кросс-процессного триггера `trg:processTrigger`.
 *
 * Триггер объявляется на узле схемы и означает: «активация этого узла
 * запускает экземпляр другого процесса». Это расширение BPMN 2.0 (в самой
 * спецификации кросс-процессного запуска нет), поэтому оно живёт в отдельном
 * namespace и требует регистрации в моделлере:
 *
 *   new Modeler({ container, moddleExtensions: TRIGGER_MODELE_EXTENSIONS });
 *
 * Без регистрации `bpmn-js` не знает тип: элемент читается как безымянное
 * расширение (его `$type` — имя тега `trg:processTrigger`, а не
 * `trg:ProcessTrigger`), `moddle.create('trg:ProcessTrigger')` бросает
 * `unknown type`, то есть ни прочитать, ни записать триггер через модель
 * нельзя — та же ловушка, что и у `camunda:*`. Именно поэтому описание
 * зарегистрировано и в редакторе (`BpmnEditor`), и в тестах
 * (`bpmnModdleTrigger.test.js`).
 *
 * Как элемент выглядит в XML (атрибуты без префикса — так их пишет
 * `moddle-xml`, потому что namespace свойства совпадает с namespace элемента):
 *
 *   <bpmn:extensionElements>
 *     <trg:processTrigger targetProcessId="Process_SupplierSupply_v1"
 *                         instancePrefix="inst-supp-"
 *                         startElementId="Task_WaitForSupplierShipment"
 *                         firstElementId="Task_SupplierCreateDocs"
 *                         payloadKeys="orderNum,volume" />
 *   </bpmn:extensionElements>
 *
 * `xml.tagAlias: 'lowerCase'` в дескрипторе — это и есть правило, по которому
 * тип `ProcessTrigger` читается/пишется как `trg:processTrigger` (ср. с
 * `camunda:in` в `camunda-bpmn-moddle`).
 */

/** Namespace триггера (совпадает с `targetNamespace`-ом схем, но с суффиксом). */
export const TRIGGER_NAMESPACE = 'http://erp.mes/schema/bpmn/trigger';

/** Префикс namespace-а триггера в XML-схеме. */
export const TRIGGER_NAMESPACE_PREFIX = 'trg';

/** Имя типа moddle (ключ для `moddle.create`). */
export const TRIGGER_TYPE = 'trg:ProcessTrigger';

/**
 * Локальное имя элемента в XML.
 *
 * В XML имя начинается со строчной буквы (`<trg:processTrigger ...>`), а
 * `trg:ProcessTrigger` — имя типа moddle, поэтому константа задана явно, а не
 * выводится из `TRIGGER_TYPE`.
 */
export const TRIGGER_LOCAL_NAME = 'processTrigger';

/**
 * Поля триггера в каноническом порядке (порядок атрибутов в XML и порядок
 * полей в панели настроек).
 *
 * Семантика:
 *  - `targetProcessId` — `bpmn:process/@id` целевого процесса, экземпляр
 *    которого запускается. Обязательное поле: без него триггер бессмысленен;
 *  - `instancePrefix` — префикс идентификатора нового экземпляра
 *    (`inst-supp-`): по нему заказчик отличает чужие экземпляры в списке и
 *    сопоставляет их со стороной обмена (`INSTANCE_PREFIX` из `constants.js`);
 *  - `startElementId` — узел **текущего** процесса, активация которого
 *    запускает целевой процесс. Обычно совпадает с узлом-владельцем триггера;
 *    поле позволяет вынести описание пары «источник → цель» в пресет и
 *    проверить, что триггер стоит на ожидаемом узле;
 *  - `firstElementId` — узел **целевого** процесса, который первым станет
 *    `ACTIVE` в новом экземпляре (точка входа в чужой маршрут). Пусто —
 *    движок входит штатным маршрутом от `startEvent` целевого процесса;
 *  - `payloadKeys` — список ключей payload текущего экземпляра, которые
 *    передаются новому экземпляру (через запятую). Передаётся только то, что
 *    перечислено: контекст целиком между сторонами не «переливается».
 */
export const TRIGGER_FIELDS = [
  'targetProcessId',
  'instancePrefix',
  'startElementId',
  'firstElementId',
  'payloadKeys',
];

/**
 * Пустой триггер: «триггера нет».
 *
 * Это значение по умолчанию для черновика формы настроек и «нулевое» значение
 * для сравнения с прочитанным из XML триггером (`getElementTrigger`). Объект
 * заморожен: он используется как общий синглтон состояния React, и случайная
 * запись в поле мутировала бы черновик.
 */
export const EMPTY_TRIGGER = Object.freeze(
  TRIGGER_FIELDS.reduce((trigger, name) => ({ ...trigger, [name]: '' }), {})
);

/** Дескриптор пакета для `moddleExtensions`. */
export const TRIGGER_DESCRIPTOR = {
  name: 'ErpMesTrigger',
  uri: TRIGGER_NAMESPACE,
  prefix: TRIGGER_NAMESPACE_PREFIX,
  // `ProcessTrigger` <-> `<trg:processTrigger>`.
  xml: { tagAlias: 'lowerCase' },
  types: [
    {
      name: 'ProcessTrigger',
      superClass: ['Element'],
      properties: TRIGGER_FIELDS.map((name) => ({
        name,
        type: 'String',
        isAttr: true,
      })),
    },
  ],
};

/**
 * Готовый набор расширений для `Modeler`/`BpmnModdle`.
 *
 *   new Modeler({ container, moddleExtensions: TRIGGER_MODELE_EXTENSIONS });
 *   new BpmnModdle(TRIGGER_MODELE_EXTENSIONS);
 */
export const TRIGGER_MODELE_EXTENSIONS = { [TRIGGER_NAMESPACE_PREFIX]: TRIGGER_DESCRIPTOR };
