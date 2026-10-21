/**
 * Moddle-описание каталога бизнес-ролей `role:catalog`.
 *
 * Роль в этой модели — **только титул** («Мастер производства», «Охрана КПП»):
 * конкретного человека у роли нет, и его имя совпадает с названием роли. В
 * каталоге хранится пара «машинный код + человеческое название», чтобы кабинет
 * мог показать «Мастер производства», а схема продолжала адресовать шаг
 * коротким `PRODUCTION` (`bpmn:potentialOwner/@name`, `act:userAction/@role`).
 *
 * Зачем отдельное расширение, если код роли уже есть в узлах:
 *
 *  - схема должна быть самодостаточной: по одному XML видно и шаги, и список
 *    ролей с их названиями — ничего не нужно держать в коде клиента. Загрузили
 *    любой BPMN — получили список ролей для входа;
 *  - название роли нельзя положить в `bpmn:potentialOwner/@name`: движок
 *    адресует роль по этому атрибуту, и «Мастер производства» стал бы кодом
 *    роли (пробелы и регистр в коде роли — лишняя ловушка);
 *  - каталог живёт внутри своего `bpmn:process`: у Заказчика и Поставщика роли
 *    разные, а `bpmn:collaboration` (объединённый проект из нескольких
 *    процессов) не место для предметных данных.
 *
 * Как элемент выглядит в XML:
 *
 *   <bpmn:process id="Process_MilkCustomer_v1" ...>
 *     <bpmn:extensionElements>
 *       <role:catalog>
 *         <role:businessRole code="PRODUCTION" title="Мастер производства" />
 *         <role:businessRole code="EXECUTIVE" title="Руководитель Заказчика" kind="EXECUTIVE" />
 *       </role:catalog>
 *     </bpmn:extensionElements>
 *     ...
 *
 * Каталог лежит внутри `bpmn:extensionElements` — это штатная точка расширения
 * BPMN 2.0: собственный элемент прямым ребёнком `bpmn:process` `bpmn-moddle`
 * считает `unparsable content` и теряет его при `saveXML`. Привязка к процессу
 * при этом сохраняется: каталог — его потомок, поэтому `getRoleCatalog`
 * раскладывает роли по владельцу (`role:catalog` у каждого процесса свой).
 *
 * Поля роли:
 *
 *  - `code` — код роли, тот же, что в `bpmn:potentialOwner/@name` и
 *    `act:userAction/@role`. По нему шаг и кнопка находят свою роль;
 *  - `title` — название роли (титул). Это же имя видит участник в кабинете:
 *    отдельного ФИО у демо-роли нет;
 *  - `kind` — необязательный признак `EXECUTIVE` («руководитель»: видит схему,
 *    метрики и деплой). Пусто — роль считается исполнительской; если в схеме
 *    нет ни одной роли с `kind`, руководителем считается роль, которая владеет
 *    кнопкой старта процесса (см. `analyzeProject` в демо-клиенте);
 *  - `icon` — необязательное имя иконки (`Crown`, `Truck`); набор иконок —
 *    дело кабинета, поэтому незнакомое имя не ломает схему.
 *
 * Без регистрации в моделлере (`ROLE_MODELE_EXTENSIONS`) `bpmn-js` не знает
 * типы и теряет каталог при `saveXML` — та же ловушка, что у `trg:*` и `act:*`.
 */

/** Namespace каталога ролей (совпадает со схемой схем, но с суффиксом). */
export const ROLE_NAMESPACE = 'http://erp.mes/schema/bpmn/roles';

/** Префикс namespace-а ролей в XML-схеме. */
export const ROLE_NAMESPACE_PREFIX = 'role';

/** Имя типа moddle каталога (ключ для `moddle.create`). */
export const ROLE_CATALOG_TYPE = 'role:Catalog';

/** Локальное имя каталога в XML (`<role:catalog>`). */
export const ROLE_CATALOG_LOCAL_NAME = 'catalog';

/** Имя типа moddle роли (ключ для `moddle.create`). */
export const ROLE_TYPE = 'role:BusinessRole';

/** Локальное имя роли в XML (`<role:businessRole>`). */
export const ROLE_LOCAL_NAME = 'businessRole';

/** Полное имя тега каталога в XML. */
export const ROLE_CATALOG_TAG_NAME = ROLE_NAMESPACE_PREFIX + ':' + ROLE_CATALOG_LOCAL_NAME;

/** Полное имя тега роли в XML. */
export const ROLE_TAG_NAME = ROLE_NAMESPACE_PREFIX + ':' + ROLE_LOCAL_NAME;

/**
 * Признаки роли (`role:businessRole/@kind`).
 *
 * Значение — не «должность», а права в демо-кабинете: `EXECUTIVE` открывает
 * панель схемы (просмотр, редактор, деплой, метрики), остальные роли ведут
 * шаги процесса.
 */
export const ROLE_KIND = {
  /** Руководитель: схема, деплой и инфографика. */
  EXECUTIVE: 'EXECUTIVE',
  /** Исполнитель: только свои шаги. */
  PARTICIPANT: 'PARTICIPANT',
};

/** Поля роли в каноническом порядке (порядок атрибутов в XML). */
export const ROLE_FIELDS = ['code', 'title', 'kind', 'icon'];

/**
 * Дескриптор пакета для `moddleExtensions`.
 *
 * `tagAlias: 'lowerCase'` превращает `Catalog` в `<role:catalog>` и
 * `BusinessRole` в `<role:businessRole>` (ср. с `act:userAction` в
 * `actionModdle.js`). `id` объявлен явно у обоих типов: у `extensionElements`
 * базовый класс атрибут `id` не признаёт, и без объявления `bpmn-moddle` пишет
 * предупреждение `unknown attribute <id>`, а сам атрибут теряется при
 * `saveXML`.
 */
export const ROLE_DESCRIPTOR = {
  name: 'ErpMesRoles',
  uri: ROLE_NAMESPACE,
  prefix: ROLE_NAMESPACE_PREFIX,
  xml: { tagAlias: 'lowerCase' },
  types: [
    {
      name: 'Catalog',
      superClass: ['Element'],
      properties: [
        { name: 'id', type: 'String', isAttr: true },
        // Вложенные роли: `<role:catalog><role:businessRole ... /></role:catalog>`.
        { name: 'roles', type: 'BusinessRole', isMany: true },
      ],
    },
    {
      name: 'BusinessRole',
      superClass: ['Element'],
      properties: ROLE_FIELDS.map((name) => ({
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
 *   new Modeler({ container, moddleExtensions: ROLE_MODELE_EXTENSIONS });
 *   new BpmnModdle(ROLE_MODELE_EXTENSIONS);
 */
export const ROLE_MODELE_EXTENSIONS = { [ROLE_NAMESPACE_PREFIX]: ROLE_DESCRIPTOR };
