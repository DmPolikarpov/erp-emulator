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
- логика токенов: `parseTokenMessage`, `resolveTokenMap`, `applyTokenUpdate`,
  `collectActiveElementIds`, `tokenMarkerClasses`, `isDeployInstanceId`,
  `deployInstanceId`;
- логика XML: `listFlowElements`, `getProcessIds`, `getElementIds`, `isValidXml`,
  `isValidElementId`, `isElementIdAvailable`, `renameElementId`, `parseXml`, `getLocalName`;
- роль исполнителя узла (`bpmn:potentialOwner`): `getElementRole`, `getRoleAssignments`,
  `setElementRole`, `isValidRole`, `isActivityType`, `isActivityElement`,
  `POTENTIAL_OWNER_TYPE`, `POTENTIAL_OWNER_LOCAL_NAME`.

Состав API проверяется тестом [`src/vendor/bpmnSdkBundle.test.js`](../vendor/bpmnSdkBundle.test.js).

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

