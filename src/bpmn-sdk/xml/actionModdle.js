/**
 * Moddle-описание кнопок участников `act:userAction`.
 *
 * Кнопка объявляется на узле схемы и означает: «пока этот шаг ведёт участник,
 * в его кабинете есть кнопка с такой надписью, которая отправляет такое событие
 * и ставит токен на такой узел». Это расширение BPMN 2.0 (в спецификации
 * кнопок кабинета нет), поэтому оно живёт в отдельном namespace и требует
 * регистрации в моделлере:
 *
 *   new Modeler({ container, moddleExtensions: ACTION_MODELE_EXTENSIONS });
 *
 * Без регистрации `bpmn-js` не знает тип: элемент читается как безымянное
 * расширение (его `$type` — имя тега `act:userAction`, а не
 * `act:UserAction`), `moddle.create('act:UserAction')` бросает
 * `unknown type`, то есть ни прочитать, ни записать кнопку через модель
 * нельзя — та же ловушка, что и у `trg:processTrigger` и `camunda:*`.
 *
 * Как элемент выглядит в XML (атрибуты без префикса — так их пишет
 * `moddle-xml`, потому что namespace свойства совпадает с namespace элемента):
 *
 *   <bpmn:extensionElements>
 *     <act:userAction id="sendToSupplier" label="Сформировать и отправить заказ Поставщику"
 *                     role="MANAGER" icon="Send" event="SendToSupplier"
 *                     elementId="Task_WaitForSupplierShipment"
 *                     startsProcess="Process_SupplierSupply_v1" />
 *   </bpmn:extensionElements>
 *
 * Пара «событие + узел» необязательна: её выводит схема. Кнопка «выполнить шаг»
 * записывается коротко и читается как «нажатие завершает блок и переводит токен
 * на следующий узел» (`CompleteBlock` и цель единственной исходящей связи):
 *
 *   <act:userAction id="approve" label="Согласовать" />
 *
 * `xml.tagAlias: 'lowerCase'` в дескрипторе — это и есть правило, по которому
 * тип `UserAction` читается/пишется как `act:userAction` (ср. с
 * `trg:processTrigger` в `triggerModdle.js`).
 */

/** Namespace кнопок участников (совпадает со схемой схем, но с суффиксом). */
export const ACTION_NAMESPACE = 'http://erp.mes/schema/bpmn/action';

/** Префикс namespace-а кнопок в XML-схеме. */
export const ACTION_NAMESPACE_PREFIX = 'act';

/** Имя типа moddle (ключ для `moddle.create`). */
export const ACTION_TYPE = 'act:UserAction';

/**
 * Локальное имя элемента в XML.
 *
 * В XML имя начинается со строчной буквы (`<act:userAction ...>`), а
 * `act:UserAction` — имя типа moddle, поэтому константа задана явно, а не
 * выводится из `ACTION_TYPE`.
 */
export const ACTION_LOCAL_NAME = 'userAction';

/**
 * Поля кнопки в каноническом порядке (порядок атрибутов в XML и порядок полей
 * в инспекторе узла).
 *
 * Семантика:
 *  - `id` — ключ кнопки (`sendToSupplier`). По нему клиент сопоставляет
 *    кнопку из схемы с вычисляемым payload (номера ТТН/УПД, метки времени) и
 *    с ветками интерфейса: всё остальное — надпись, событие, узлы — берётся
 *    из схемы;
 *  - `label` — надпись на кнопке в кабинете участника;
 *  - `role` — роль участника. Пусто — роль берётся у узла-хоста
 *    (`bpmn:potentialOwner`). Заполняется там, где роль узла задать нельзя:
 *    `resourceRole` по спецификации BPMN 2.0 есть только у Activity, поэтому у
 *    кнопки запуска процесса на стартовом событии роль указана здесь;
 *  - `icon` — имя иконки (`Send`, `Truck`; см. `ACTION_ICON_PATTERN`), по
 *    которому клиент выбирает картинку. Незнакомая иконка — картинка по
 *    умолчанию, схему это не ломает;
 *  - `event` — имя события, которое клиент отправляет в оркестратор при
 *    нажатии (`SendToSupplier`). Пусто — «шаг выполнен»: подставляется
 *    `DEFAULT_ACTION_EVENT` (`CompleteBlock`), потому что движок имя события не
 *    разбирает (оно уходит в subject NATS), а токен двигает `elementId`;
 *  - `elementId` — узел, который становится `ACTIVE` после нажатия
 *    (`element_id` события). Пусто — следующий блок по единственной исходящей
 *    связи узла-хоста (`getNextElementId`): кнопка «выполнить шаг» его обычно и
 *    имеет в виду;
 *  - `counterpartEvent` — необязательное событие в экземпляр **второй
 *    стороны** по тому же заказу (кросс-процессный сигнал: «поставщик
 *    отгрузил»). Пусто — второго события нет;
 *  - `counterpartElementId` — узел второй стороны, который активирует
 *    `counterpartEvent` (задаётся вместе с ним);
 *  - `startsProcess` — `bpmn:process/@id` процесса второй стороны, экземпляр
 *    которого запускается нажатием (кнопка «отправить заказ Поставщику»).
 *    Пусто — нажатие не запускает новый процесс.
 */
export const ACTION_FIELDS = [
  'id',
  'label',
  'role',
  'icon',
  'event',
  'elementId',
  'counterpartEvent',
  'counterpartElementId',
  'startsProcess',
];

/**
 * Пустая кнопка: «кнопки нет».
 *
 * Это значение по умолчанию для черновика формы настроек и «нулевое» значение
 * для сравнения с прочитанной из XML кнопкой (`getElementActions`). Объект
 * заморожен: он используется как общий синглтон состояния React, и случайная
 * запись в поле мутировала бы черновик.
 */
export const EMPTY_ACTION = Object.freeze(
  ACTION_FIELDS.reduce((action, name) => ({ ...action, [name]: '' }), {})
);

/**
 * Дескриптор пакета для `moddleExtensions`.
 *
 * `id` объявлен здесь явно, хотя тип наследует `Element`: у `extensionElements`
 * базовый класс атрибут `id` не признаёт, и без объявления `bpmn-moddle` пишет
 * предупреждение `unknown attribute <id>`, а сам атрибут при `saveXML`
 * теряется — вместе с ним кабинет теряет сопоставление кнопки с действием.
 */
export const ACTION_DESCRIPTOR = {
  name: 'ErpMesAction',
  uri: ACTION_NAMESPACE,
  prefix: ACTION_NAMESPACE_PREFIX,
  // `UserAction` <-> `<act:userAction>`.
  xml: { tagAlias: 'lowerCase' },
  types: [
    {
      name: 'UserAction',
      superClass: ['Element'],
      properties: ACTION_FIELDS.map((name) => ({
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
 *   new Modeler({ container, moddleExtensions: ACTION_MODELE_EXTENSIONS });
 *   new BpmnModdle(ACTION_MODELE_EXTENSIONS);
 */
export const ACTION_MODELE_EXTENSIONS = { [ACTION_NAMESPACE_PREFIX]: ACTION_DESCRIPTOR };
