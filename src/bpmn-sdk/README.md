# `@erp/bpmn-client-sdk`

Клиентский SDK BPMN-оркестратора: компоненты просмотра/редактирования схем,
клиент HTTP-шлюза, WebSocket-подписка на токены процесса и чистая логика
подсветки.

Пакет живёт внутри клиента (`erp-simulator/src/bpmn-sdk`) и существует в двух
видах:

| Вид | Точка входа | Кто потребляет |
| --- | --- | --- |
| исходники | `index.js` | юнит-тесты SDK, отладка |
| собранный UMD | `dist/bpmn-sdk.umd.js` → `src/vendor/bpmn-sdk` | приложение (`App.jsx`), Jest, `<script>` |
| собранный ESM | `dist/bpmn-sdk.esm.js` + `dist/bpmn-sdk.css` | внешние бандлеры |

## Команды

```bash
npm run sdk:build     # сборка dist (UMD + ESM + CSS + карты)
npm run sdk:sync      # dist -> src/vendor/bpmn-sdk (артефакт клиента)
npm run sdk:verify    # контракт артефактов + актуальность сборки
npm run sdk:refresh    # build + sync + verify
npm run sdk:demo      # ассеты демо-страницы <script> (public/vendor)
```

`dist` в git не хранится (см. `.gitignore`); в репозитории лежит только
результат `sdk:sync` — `src/vendor/bpmn-sdk` (см. [`src/vendor/README.md`](../vendor/README.md)).

Внутренние скрипты сборки:

- [`webpack.config.js`](webpack.config.js) — две конфигурации webpack (`umd`, `esm`);
- [`tools/build.mjs`](tools/build.mjs) — запуск сборки через Node API
  (`webpack-cli` в проекте нет) и запись `BUILD_INFO.json`;
- [`tools/sync.mjs`](tools/sync.mjs) — копирование артефакта потребителям;
- [`tools/verify.mjs`](tools/verify.mjs) — проверки контракта артефактов;
- [`tools/lib/build-info.cjs`](tools/lib/build-info.cjs) — общие пути,
  версии инструментов и `sourceHash` (sha256 по исходникам).

Инструменты сборки используют только зависимости, уже установленные
`react-scripts` (webpack 5, babel-loader, css/style/mini-css loaders, terser) —
отдельных `devDependencies` пакет не требует.

## Публичное API

Экспорты барреля (`index.js`, `export *`):

- компоненты: `BpmnViewer`, `BpmnEditor`, `EnginePanel`;
- хуки: `useBpmnEngine`, `useProcessTokens`, `useTokenHighlight`;
- транспорт: `GatewayClient`, `StatusSocket`, `createUuid`, `normalizeGatewayUrl`;
- константы: `DEFAULT_GATEWAY_URL`, `DEFAULT_WS_URL`, `DEFAULT_CUSTOMER_BPMN_XML`,
  `DEFAULT_SUPPLIER_BPMN_XML`, `INSTANCE_PREFIX`, `ENGINE_EVENTS`, `ENGINE_ELEMENTS`,
  `SOCKET_EVENTS`, `SOCKET_STATUS`, `TOKEN_STATES`, `ERROR_KINDS`,
  `BPMN_TOKEN_BASE_CLASS`, `BPMN_TOKEN_CLASS`;
- демо-проект «Молочный завод» (`defaults/dairyPlant.js`):
  `DAIRY_PLANT_PROCESS_XML`, `DAIRY_PLANT_PROCESS_ID`, `DAIRY_PLANT_PARTICIPANT_NAME`,
  `DAIRY_SUPPLIER_PROCESS_XML`, `DAIRY_SUPPLIER_PROCESS_ID`,
  `DAIRY_SUPPLIER_PARTICIPANT_NAME`, `DAIRY_PLANT_PROJECT_XML`,
  `DAIRY_PLANT_PROJECT_NAME`, `DAIRY_PROJECT_ROW_OFFSET`, `DAIRY_SALES_ROLE`;
- логика токенов: `parseTokenMessage`, `resolveTokenMap`, `applyTokenUpdate`,
  `collectActiveElementIds`, `tokenMarkerClasses`, `isDeployInstanceId`,
  `deployInstanceId`;
- логика XML: `listFlowElements`, `getProcessIds`, `getElementIds`, `isValidXml`,
  `isValidElementId`, `isElementIdAvailable`, `renameElementId`, `parseXml`, `getLocalName`;
- совместимость схемы с движком: `validateEngineSchema`, `ENGINE_FLOW_NODE_TYPES`,
  `SCHEMA_PROBLEM`;
- роль исполнителя узла (`bpmn:potentialOwner`): `getElementRole`, `getRoleAssignments`,
  `setElementRole`, `isValidRole`, `isActivityType`, `isActivityElement`,
  `POTENTIAL_OWNER_TYPE`, `POTENTIAL_OWNER_LOCAL_NAME`;
- триггер запуска второго процесса (`trg:processTrigger`): `getElementTrigger`,
  `getTriggerAssignments`, `listTriggers`, `setElementTrigger`, `isValidTrigger`,
  `isValidInstancePrefix`, `isValidPayloadKeys`, `isTriggerHostType`,
  `TRIGGER_NAMESPACE`, `TRIGGER_TYPE`, `TRIGGER_FIELDS`, `EMPTY_TRIGGER`,
  `TRIGGER_MODELE_EXTENSIONS`;
- кнопки участника узла (`act:userAction`): `listActions`, `getElementActions`,
  `getElementAction`, `getActionAssignments`, `getStartAction`, `setElementActions`,
  `normalizeAction`, `isValidAction`, `isActionHostType`, `ACTION_FIELDS`,
  `EMPTY_ACTION`, `ACTION_TYPE`, `ACTION_NAMESPACE`, `ACTION_MODELE_EXTENSIONS`,
  `ACTION_TAG_NAME`, `ACTION_ICON_PATTERN`;
- адрес кнопки, выводимый из схемы: `resolveAction`, `resolveActionEvent`,
  `resolveActionTarget`, `getNextElementId`, `getOutgoingTargetIds`,
  `DEFAULT_ACTION_EVENT`.

Состав API проверяется тестом [`src/vendor/bpmnSdkBundle.test.js`](../vendor/bpmnSdkBundle.test.js).

### Демо-проекты

В SDK два готовых проекта: их используют витрина и кабинет клиента.

| Проект | Модуль | Состав | Как открыть |
| --- | --- | --- | --- |
| «Закупка и приёмка молока» | `defaults/milkProcess.js` | заказчик + поставщик, `DEFAULT_PROJECT_BPMN_XML` | создаётся при первом запуске клиента |
| «Молочный завод» | `defaults/dairyPlant.js` | завод (9 ролей) + поставщик сырья (3 роли), `DAIRY_PLANT_PROJECT_XML` | кнопка «Молочный завод» в списке проектов |

Схемы «Молочного завода» проверяет [`defaults/dairyPlant.test.js`](defaults/dairyPlant.test.js):
оба процесса проходят `validateEngineSchema`, связи и DI на месте, кнопки ведут в
существующие узлы, роли объявлены каталогами, а пулы проекта не перекрываются
(второй сдвинут на `DAIRY_PROJECT_ROW_OFFSET`).

Что в проекте пока рисуется, а не исполняется движком (шлюзы без условий,
`serviceTask` вместо воркеров, межпроцессные сообщения через кнопки, роли как
маршрутизация UI), и в каком порядке это закрывается — в
[`../../docs/dairy-plant-roadmap.md`](../../docs/dairy-plant-roadmap.md).

### Роль исполнителя узла

Роль хранится в самой схеме — в `bpmn:potentialOwner` (`Activity#resources` из
BPMN 2.0; тип уже описан в `bpmn-moddle`, поэтому `moddleExtensions` не нужен):

```xml
<bpmn:userTask id="Task_QualityControl" name="Контроль качества ОТК">
  <bpmn:potentialOwner name="QUALITY" />
</bpmn:userTask>
```

| Экспорт | Назначение |
| --- | --- |
| `getElementRole(xml, elementId)` | роль узла (`''`, если не назначена) |
| `getRoleAssignments(xml)` | карта `{element_id: роль}` по всей схеме |
| `setElementRole(xml, elementId, role)` | правка роли текстом (как `renameElementId`); `''` снимает роль |
| `isValidRole(role)` | проверка роли (грамматика как у `element_id`) |
| `isActivityType(type)` / `isActivityElement(node)` | узел — Activity, т.е. роль ему применима |

Правила, которые SDK соблюдает и проверяет тестами:

- роль записывается **только в Activity** (`*Task`, `subProcess`, `callActivity`,
  `transaction`): у событий и шлюзов нет `resourceRole`, `bpmn-moddle` не признаёт
  там `potentialOwner` (`unparsable content`) и теряет его при сохранении схемы.
  `setElementRole` бросает ошибку, `EnginePanel`/`BpmnEditor` блокируют поле;
- роль пишется без `id`: `renameElementId` переименовывает все `id` схемы, и роль
  уехала бы вместе с переименованным узлом;
- читается и «длинная» запись по спецификации
  (`resourceAssignmentExpression` → `formalExpression`/`expression`), пишется
  всегда короткая (`name`);
- правка идёт текстом, поэтому остальная схема (включая `bpmndi:BPMNShape`) не
  переформатируется.

Инспектор узлов (`EnginePanel`) отдаёт роль полем «Роль исполнителя»: набор ролей
приходит пропом `roleOptions`, изменение наружу — пропом `onChangeRole(id, role)`
(`BpmnEditor` прокидывает оба и пишет роль через `modeling.updateProperties`, то
есть правка попадает в `commandStack` и в `onChange`). Роль — разметка
маршрутизации в UI, а не авторизация: движок её не читает и не проверяет.

### Триггер запуска второго процесса

BPMN 2.0 не знает «запустить другой процесс», поэтому привязка живёт расширением
в собственном namespace `trg` (для `bpmn-js` тип объявляет
`TRIGGER_MODELE_EXTENSIONS` — `moddleExtensions` редактора):

```xml
<bpmn:serviceTask id="Task_WaitForSupplierShipment" name="Ожидание отгрузки">
  <bpmn:extensionElements>
    <trg:processTrigger targetProcessId="Process_SupplierSupply_v1"
                        instancePrefix="inst-supp-"
                        startElementId="Task_WaitForSupplierShipment"
                        firstElementId="Task_SupplierCreateDocs"
                        payloadKeys="orderNum,volume" />
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

| Экспорт | Назначение |
| --- | --- |
| `getElementTrigger(xml, elementId)` | триггер узла (`null`, если не назначен) |
| `getTriggerAssignments(xml)` | карта `{element_id: триггер}` по всей схеме |
| `listTriggers(xml)` | `[{elementId, trigger}]` в порядке появления в схеме |
| `setElementTrigger(xml, elementId, trigger)` | правка триггера текстом; `null` (или пустой `targetProcessId`) снимает его |
| `isValidTrigger(trigger)` / `isValidInstancePrefix(value)` / `isValidPayloadKeys(value)` | проверки полей до записи (панель подсвечивает недопустимое поле) |
| `isTriggerHostType(type)` | узел может быть источником триггера (задача, событие, шлюз, подпроцесс) |
| `TRIGGER_FIELDS`, `EMPTY_TRIGGER`, `TRIGGER_TYPE`, `TRIGGER_NAMESPACE`, `TRIGGER_MODELE_EXTENSIONS` | состав полей, пустой триггер, тип моддла, namespace и расширения редактора |

Правила:

- **источник — только узел потока**: `sequenceFlow` движок токеном не активирует,
  `setElementTrigger` на нём бросает ошибку, `EnginePanel` блокирует поля;
- **`payloadKeys` — упорядоченный список без повторов**: «грязная» запись
  канонизируется (`' volume , orderNum ,, volume '` → `'volume,orderNum'`),
  поэтому повторное применение того же триггера схему не меняет;
- **namespace `xmlns:trg` объявляется в корне** вместе с первым триггером: без
  объявления схема некорректна и `bpmn-js` не прочитает элемент;
- **чужие расширения узла сохраняются**: тег дописывается в существующий
  `bpmn:extensionElements`, а контейнер создаётся только если его не было;
- **правка идёт текстом** (как `renameElementId` и `setElementRole`): остальная
  схема, включая `bpmndi:BPMNShape`, не переформатируется.

Инспектор узлов отдаёт триггер блоком «Запуск другого процесса при активации
узла»: подсказки поля «Запускаемый процесс» приходят пропом `triggerTargets`
(идентификаторы процессов второй стороны: `getProcessIds` от её схемы), правка
наружу — пропом `onChangeTrigger(id, trigger)` (`null` — снять).

> Движок триггер пока не читает: запуск второго процесса делает клиент отдельным
> `sendEvent`, а расширение фиксирует пару «источник → цель», точку входа и
> состав передаваемого payload.

### Кнопки участников узла

В схеме описаны и кнопки кабинета: что участник видит и что нажатие отправляет
движку. В BPMN 2.0 такого понятия нет, поэтому кнопка — расширение в собственном
namespace `act` (`ACTION_MODELE_EXTENSIONS` для редактора):

```xml
<bpmn:userTask id="Task_CreatePurchaseOrder" name="Сформировать заказ у поставщика">
  <bpmn:extensionElements>
    <act:userAction id="sendToSupplier" label="Сформировать и отправить заказ Поставщику"
                    icon="Send" event="SendToSupplier"
                    elementId="Task_WaitForSupplierShipment"
                    startsProcess="Process_SupplierSupply_v1" />
  </bpmn:extensionElements>
  <bpmn:potentialOwner name="MANAGER" />
</bpmn:userTask>
```

Пара «событие + узел» необязательна — её выводит схема, поэтому кнопка
«выполнить шаг» записывается коротко (так записаны все кнопки демо-схем SDK):

```xml
<act:userAction id="securityPass" label="Проверить пропуск и открыть ворота" icon="ShieldCheck" />
```

Читается это как «нажатие завершает блок и переводит токен на следующий узел»:
`event` берётся из `DEFAULT_ACTION_EVENT` (`CompleteBlock`), `elementId` — цель
единственной исходящей связи узла (`getNextElementId`). Значение, записанное в
XML явно, всегда важнее умолчания: старые схемы читаются как раньше.

| Поле | Смысл |
| --- | --- |
| `id` | ключ кнопки: по нему клиент сопоставляет её с действием кабинета |
| `label` | надпись на кнопке |
| `role` | роль участника; пусто — берётся у узла-хоста (`bpmn:potentialOwner`) |
| `icon` | имя иконки (`Send`, `Truck`); незнакомое имя — иконка по умолчанию |
| `event` | событие при нажатии (`event_name` запроса в шлюз). Пусто — `DEFAULT_ACTION_EVENT` (`CompleteBlock`): движок имя события не разбирает (оно уходит в subject NATS и в журнал), токен двигает `elementId` |
| `elementId` | узел, который станет `ACTIVE` (`element_id` события). Пусто — следующий блок по единственной исходящей связи узла-хоста (`getNextElementId`); в развилке связей несколько, и там узел указывают явно |
| `counterpartEvent`, `counterpartElementId` | необязательный сигнал в экземпляр второй стороны по тому же заказу |
| `startsProcess` | `bpmn:process/@id` процесса второй стороны, который запускает нажатие |
| `variables` | переменные процесса, которые выставляет нажатие: пары `ключ=значение` через `;` (`stockSufficient=true`). Клиент добавляет их в `output_data` события — по ним `conditionExpression` шлюза выбирает ветку (дизайн M1, 8.1). Пусто — нажатие переменных не пишет |

| Экспорт | Назначение |
| --- | --- |
| `listActions(xml)` | `[{elementId, action}]` в порядке появления в схеме |
| `getElementActions(xml, elementId)` | кнопки узла |
| `getElementAction(xml, elementId, id)` | одна кнопка по ключу (`null`, если её нет) |
| `getActionAssignments(xml)` | карта `{element_id: [кнопка, ...]}` |
| `getStartAction(xml)` | кнопка запуска процесса: первая кнопка на стартовом событии |
| `resolveAction(xml, elementId, action)` | пара `{event, elementId}` кнопки — аргументы `sendEvent`: пустые поля заменяются умолчаниями схемы |
| `resolveActionEvent(action)` / `resolveActionTarget(xml, elementId, action)` | то же по отдельности |
| `parseActionVariables(variables)` | строка `variables` → `{ключ: значение}`; пустая — `{}`, кривая — исключение (её же ловит валидатор) |
| `getNextElementId(xml, elementId)` / `getOutgoingTargetIds(xml, elementId)` | следующий блок по единственной исходящей связи (`''`, если связь неоднозначна) и все цели связей узла |
| `DEFAULT_ACTION_EVENT` | `CompleteBlock` — событие кнопки, не записанное в схеме |
| `setElementActions(xml, elementId, actions)` | правка списка кнопок текстом; `[]` снимает все |
| `normalizeAction` / `isValidAction` / `isActionHostType` | канон полей и проверки до записи (обязательны `id` и `label`) |
| `ACTION_FIELDS`, `EMPTY_ACTION`, `ACTION_TYPE`, `ACTION_NAMESPACE`, `ACTION_TAG_NAME`, `ACTION_ICON_PATTERN`, `ACTION_MODELE_EXTENSIONS` | состав полей, пустая кнопка, тип моддла, namespace, тег, грамматика иконки, расширения редактора |

Правила:

- **кнопка запуска процесса** — та, что объявлена на **стартовом событии**:
  `role` там нужна обязательно (у событий нет `resourceRole`), а `event` и
  `elementId` задают первый шаг — движок переводит токен двумя событиями
  (`StartProcess`, затем событие шага), см. `getStartAction`. Пару можно и не
  записывать: у стартового события связь одна, и `resolveAction` доводит её до
  первого блока (`CompleteBlock`) — но без самой кнопки старта процесс не описан,
  и `startProcess` вернёт ошибку;
- **хост — только узел потока** (задача, событие, шлюз, подпроцесс): на
  `sequenceFlow` шаг не активируется, `setElementActions` бросает ошибку;
- **обязательны только `id` и `label`**: пустые `event`/`elementId` допустимы и
  означают умолчания схемы (их подставляет `resolveAction`), а непустые
  проверяются по грамматике `element_id` — иначе опечатка в `elementId` увела бы
  токен в никуда;
- **список заменяется целиком**, поэтому «полуприменённого» состояния в схеме не
  бывает: `[]` снимает кнопки узла;
- **`id` объявлен в дескрипторе явно**, хотя тип наследует `Element`: у
  `extensionElements` базовый класс атрибут `id` не признаёт, и без объявления
  `bpmn-moddle` пишет `unknown attribute <id>`, а `saveXML` теряет ключ кнопки
  (проверяется в [`src/vendor/bpmnModdleAction.test.js`](../vendor/bpmnModdleAction.test.js));
- **namespace `xmlns:act` объявляется в корне** вместе с первой кнопкой, чужие
  расширения узла (`trg:processTrigger`, `camunda:*`) сохраняются;
- **правка идёт текстом** (как у роли и триггера): остальная схема, включая
  `bpmndi:BPMNShape`, не переформатируется.

Инспектор узлов отдаёт кнопки блоком «Кнопки участников на узле»: поля — по
`ACTION_FIELDS`, подсказки — роли пользователей, идентификаторы узлов схемы и
процессы второй стороны; правка наружу — пропом `onChangeActions(id, actions)`
(`[]` снимает все). Обязательны только ключ и надпись: «Добавить кнопку» сразу
пишет кнопку в схему, а в поле «Узел после нажатия» подсказывается блок, который
схема выведет по единственной исходящей связи (`getNextElementId`). Кабинет
([`App.jsx`](../App.jsx)) поимённо разбирает только шаги со своими ключами
(`ACTION_ID`): у них обработчики собирают payload, которого в схеме нет (номера
УПД/ТТН, метки времени). Кнопку с незнакомым ключом кабинет показывает общим
шагом, а пару «событие + узел» и роль для неё разрешает та же схема
(`resolveAction`, `bpmn:potentialOwner`) — правок кода новый блок не требует.

> Схема без `act:userAction` — схема без кнопок: кабинет покажет только ожидание.
> Демо-схемы SDK (`DEFAULT_CUSTOMER_BPMN_XML`, `DEFAULT_SUPPLIER_BPMN_XML`) кнопки
> несут, а кнопка «Демо-схема» в панели схемы возвращает их, если копия в
> браузере осталась от прежней версии.

### Подсветка токенов процесса

`BpmnViewer` помечает узлы схемой `{element_id: состояние}`
(`props.tokens`) и устаревшим пропом `activeElementId` (только `ACTIVE`).
CSS-классы собирает `resolveTokenMap`, а пару «базовый класс + состояние» —
`tokenMarkerClasses`:

```js
resolveTokenMap({ Task_1: 'ACTIVE' });
// { Task_1: ['bpmn-sdk-token', 'bpmn-sdk-token--active'] }

tokenMarkerClasses(TOKEN_STATES.COMPLETED);
// ['bpmn-sdk-token', 'bpmn-sdk-token--completed']
```

Классов именно два, потому что `canvas.addMarker` в diagram-js навешивает один
класс за вызов, а правила [`styles/bpmn-sdk.css`](styles/bpmn-sdk.css) написаны
парой: `.bpmn-sdk-token` объявляет переменные и применяет `fill`/`stroke`,
`.bpmn-sdk-token--active|--completed|--failed|--timed-out` выбирает цвет и
анимацию (пульсация — только у `ACTIVE`). Без базового класса заливка и обводка
не применяются: от подсветки оставалась одна анимация `ACTIVE`, а
`COMPLETED`/`FAILED`/`TIMED_OUT` не были видны совсем. Узел, которого нет в
схеме, подсветить нечем: `BpmnViewer` молча пропускает чужой `element_id`
(проверка через `elementRegistry` перед `canvas.addMarker`).

### Совместимость схемы с движком

Схему компилирует движок (`bpm-engine-bpmn`), и он разбирает **не весь** BPMN:
его парсер обходит прямых детей `<bpmn:process>` и знает только
`startEvent`, `endEvent`, `serviceTask`, `userTask`, `exclusiveGateway`,
`parallelGateway` и `sequenceFlow`. Всё остальное — включая базовый
`<bpmn:task>`, который создаёт кнопка «Task» в палитре редактора, — он
**молча пропускает** (без ошибки разбора). Связи, которые вели в такой узел или
из него, становятся «висячими», компилятор отвечает `SequenceFlowSourceNotFound`
/ `SequenceFlowTargetNotFound` и не компилирует определение целиком.

Заметить это из клиента нельзя: шлюз принимает событие в NATS и отвечает
`202 Accepted` независимо от результата компиляции, ошибка остаётся только в
логе движка. Поэтому `validateEngineSchema(xml)` повторяет правила компилятора
на клиенте и отдаёт отчёт:

```js
validateEngineSchema(xml);
// { ok: false, problems: [{
//     code: 'UnsupportedElement',            // коды совпадают с ErrorCode движка
//     message: 'Узел Activity_1nup3yq типа <bpmn:task> движок не разбирает: ...',
//     elementId: 'Activity_1nup3yq',
//     flowId: '',
//     hint: 'Замените узел на User task (или Service task): ...' }] }
```

Проверяются: разбор XML, наличие процесса, поддерживаемые типы узлов, «висячие»
ссылки связей, петли на себя, ровно один `startEvent` и хотя бы один `endEvent`,
соединённость узлов, достижимость до `endEvent`, форма шлюзов.

С M1 проверяется и **смысл** развилок — иначе опечатка в условии не падает, а
молча уводит токен в `default`:

| Код | Когда |
| --- | --- |
| `ConditionUnsupported` | текст `conditionExpression` вне грамматики движка: скобки, `not`, литерал слева, `=` вместо `==`, функции |
| `GatewayDefaultFlowWithCondition` | у связи с `default` есть `conditionExpression`: компилятор вернёт `Default` раньше разбора текста, то есть условие не действует |
| `GatewayFlowWithoutCondition` | у `exclusiveGateway` есть исходящая связь без условия и без `default`: она выигрывает у всех условий |
| `GatewayUnknownVariable` | условие читает переменную, которой не выставляет ни одна `act:userAction` процесса: ветка недостижима |
| `ActionVariableFormat` | `variables` кнопки не разложилась в пары `ключ=значение` |
| `TaskMultipleOutgoing` | у задачи больше одной исходящей связи: движок создаст по токену на каждую (неявный AND-split без слияния) |

Демо-схемы SDK (`DEFAULT_CUSTOMER_BPMN_XML`, `DEFAULT_SUPPLIER_BPMN_XML`) и
проект «Молочный завод» (`DAIRY_PLANT_PROJECT_XML`, пять шлюзов с условиями)
проходят проверку — это же условие зафиксировано тестом, чтобы правки демо не
сломали старт процесса.

### Совместимость с `diagram-js`

Вторая, уже библиотечная, а не движковая проблема — устаревший вызов
`ContextPad#getPad`, который делает сам `bpmn-js`. Кнопка «Change element»
(гаечный ключ на контекстной панели узла) открывает меню замены через этот
метод, а `diagram-js` (>= 14.10) объявил его устаревшим и на **каждый** вызов
пишет в консоль предупреждение со стеком:

```text
Error: ContextPad#getPad is deprecated and will be removed in future library
versions, cf. https://github.com/bpmn-io/diagram-js/pull/888
    at ContextPad.getPad (ContextPad.js:472:1)
    at getReplaceMenuPosition (ContextPadProvider.js:234:1)
```

Это не ошибка редактора: меню открывается штатно, до клиента доходит только
сообщение в консоли, но строка начинается с `Error:` и читается как поломка.
Обновление библиотек ничего не меняет — проверено на самых свежих версиях
(`bpmn-js` 18.31.0 + `diagram-js` 15.28.1): там тот же вызов в
`getReplaceMenuPosition` и то же предупреждение.

Поэтому SDK ставит заплату —
[`compat/diagramJsCompat.js`](compat/diagramJsCompat.js),
`installDiagramJsCompat(diagram)` вызывается при создании диаграммы в
`BpmnEditor` (у `BpmnViewer` контекстной панели нет — вызов безвреден).
Поведение не подменяется: обёртка вызывает оригинальный `getPad` и не
пропускает в консоль только это сообщение, остальные `console.warn` (в том
числе от `diagram-js`) остаются видны. Проверяется в
[`compat/diagramJsCompat.test.js`](compat/diagramJsCompat.test.js) и в
`src/vendor/bpmnSdkBundle.test.js` — там же контроль: на моделлере без заплаты
предупреждение есть.

## Как подключать

**Бандлер (ESM).** `react`, `react-dom` и `bpmn-js` — внешние зависимости,
стили вынесены:

```js
import { BpmnViewer } from '@erp/bpmn-client-sdk/dist/bpmn-sdk.esm.js';
import '@erp/bpmn-client-sdk/dist/bpmn-sdk.css';
```

**`<script>` (UMD).** Нужен только React — `bpmn-js` уже внутри:

```html
<script src="react.development.js"></script>
<script src="react-dom.development.js"></script>
<script src="bpmn-sdk.umd.js"></script>
<script>
  const { BpmnViewer, DEFAULT_CUSTOMER_BPMN_XML } = window.BpmnSdk;
</script>
```

Рабочая страница — [`public/sdk-demo.html`](../../public/sdk-demo.html)
(`npm run sdk:demo`).

**Jest/CRA.** UMD-артефакт лежит в `src/vendor/bpmn-sdk` и импортируется как
обычный модуль: `import { BpmnViewer } from './vendor/bpmn-sdk'`. CRA
пересобирает его вместе с приложением, поэтому React остаётся единственным
экземпляром; `bpmn-js` при этом не попадает в ESM-парсер Jest.

## Контракт зависимостей

- **React/ReactDOM — externals, всегда.** Бандл не содержит своей копии React:
  иначе хуки SDK падают с «Invalid hook call». В браузере используются
  глобалы `React`/`ReactDOM`, в CRA/Jest — `require('react')`.
- **`bpmn-js`, `diagram-js`, `lucide-react` — внутрь UMD** (самодостаточность)
  и externals в ESM. Версии для внешнего потребления — в `peerDependencies`
  (`bpmn-js ^17.11.1`, `lucide-react >=0.344.0`, `react/react-dom ^18.2.0`).
- **CSS** инлайнится в UMD (`style-loader`) и выносится в `bpmn-sdk.css` для
  ESM. Стили холста `diagram-js`/`bpmn-js` и правила иконок `bpmn-font`
  (`bpmn-codes.css`) подключаются из `index.js`, чтобы потребитель не забывал
  про них; шрифт берётся только в `woff2` — остальные форматы добавляли
  ~390 KB base64 (см. [`styles/bpmnFont.css`](styles/bpmnFont.css)). Там же
  лежит привязка глифов к семейству (`[class^="bpmn-icon-"]:before`): в
  `bpmn-codes.css` есть только `content`, и без этой привязки иконки палитры
  редактора рисуются квадратиками (проверяется в `tools/verify.mjs` и
  `src/vendor/bpmnSdkBundle.test.js`).

## Особенности и ограничения

- JSX компилируется в **classic** runtime (`@babel/preset-react`,
  `runtime: 'classic'`): automatic-runtime потянул бы `react/jsx-runtime` и
  потребовал ещё один глобал при `<script>`-подключении.
- `REACT_APP_GATEWAY_URL` / `REACT_APP_WS_URL` читаются в рантайме через
  `process.env`, если `process` доступен (Jest, SSR). В браузере переменной
  `process` нет, и SDK использует значения по умолчанию
  (`/api/v1/process/instances` — через CRA-прокси, `ws://localhost:8081/ws/status`).
- В `package.json` пакета сознательно **нет** `module`/`exports`: относительный
  импорт `./bpmn-sdk` в CRA иначе получил бы ESM-сборку с внешними `bpmn-js` и
  без CSS. Точки входа артефактов указаны в этом README и в `BUILD_INFO.json`.
- `dist` не коммитится, а `BUILD_INFO.json` хранит `sourceHash` исходников:
  `sdk:sync` и Jest-тест падают, если SDK изменили, но не пересобрали.
- Холст `bpmn-js` в jsdom не поднимается (нет SVG-геометрии: `getBBox`,
  `createSVGTransform`), поэтому «схема переживает импорт и экспорт» проверяется
  не через редактор, а на том же `bpmn-moddle`, который упакован в бандл —
  [`src/vendor/bpmnModdleRole.test.js`](../vendor/bpmnModdleRole.test.js).
- Предупреждение `diagram-js` об устаревшем `ContextPad#getPad` (кнопка
  «Change element» в редакторе) гасится на стороне SDK: апгрейд библиотек его
  не убирает, а в консоли клиента оно выглядит как ошибка — см.
  [«Совместимость с `diagram-js`»](#совместимость-с-diagram-js).

