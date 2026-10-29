# ERP Simulator — тестовый клиент BPMN-оркестратора

Учебный клиент оркестратора: роли Заказчика, Поставщика и Клиента, просмотр и
редактирование BPMN-схем, деплой схемы, отслеживание токенов процесса через
HTTP- и WebSocket-шлюзы (`bpmn-gateways`) и метрики выполненных процессов в
кабинете руководителя.

Схема, которую правит руководитель, — это проект: одна BPMN-схема с процессами
сторон (`bpmn:collaboration`) и каталогами ролей (`role:catalog`). Две
кнопки панели схемы делают разное: **«Сохранить схему»** кладёт проект в
`localStorage` браузера ([`src/projectStore.js`](src/projectStore.js)) — правки
переживают перезагрузку страницы, **«Задеплоить BPMN в Оркестратор»** отправляет в
кластер нарезку процесса (`extractProcessXml`), потому что движок читает только
первый `bpmn:process`. Деплой обновляет и браузерную копию, локальное сохранение в
кластер не уходит. Кнопка «Демо-схема» возвращает процесс своего контура (остальные
остаются в проекте), роли для входа собираются из схемы
([`src/projectRoles.js`](src/projectRoles.js)).

Кнопка «Молочный завод» в списке проектов создаёт второй готовый проект SDK
([`src/bpmn-sdk/defaults/dairyPlant.js`](src/bpmn-sdk/defaults/dairyPlant.js)):
завод (9 ролей), поставщик сырья (3 роли) и клиент (2 роли) в одной кооперации:
клиент оформляет заказ, завод закупает сырьё, принимает его, варит и отгружает,
клиент принимает партию по УПД. Стороны обмениваются сообщениями BPMN (MF1/MF2/MF6),
поэтому ни одна кнопка не запускает чужой процесс напрямую. Дальше проект играется
как любой загруженный — вход по ролям схемы, кабинет по её кнопкам. Роли
проверяются и на сервере (M6): событие чужой роли шлюз отклоняет с `403`. Что в
этой схеме пока рисуется, а не исполняется движком (метрики в браузере), и в
каком порядке это закрывается — в
[`docs/dairy-plant-roadmap.md`](docs/dairy-plant-roadmap.md).

Перед деплоем и перед стартом процесса схема проверяется на совместимость с
движком (`validateEngineSchema` из SDK): движок разбирает только
`startEvent`/`endEvent`/`serviceTask`/`userTask`/`exclusiveGateway`/
`parallelGateway`, а неизвестный узел (`bpmn:task` из палитры редактора,
подпроцесс) пропускает молча и отвечает ошибкой компиляции, о которой клиенту не
сообщает. Поэтому при такой схеме панель схемы показывает предупреждение с
причиной, деплой отменяется, а заказ не заводится — иначе в списке появился бы
«заказ-призрак» без экземпляра процесса и токенов
(см. [README SDK](src/bpmn-sdk/README.md#совместимость-схемы-с-движком)).

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Кнопки участников

Кнопки кабинета — не код, а блоки схемы (`act:userAction`): надпись, иконка,
роль участника и кросс-процессные эффекты (`startsProcess` — запуск процесса
второй стороны, `counterpartEvent` — сигнал в её экземпляр) объявляются в самих
узлах (см. [README SDK](src/bpmn-sdk/README.md#кнопки-участников-узла)). Событие
нажатия и узел, который станет активным, тоже живут в схеме, но их можно и не
писать: пустое `event` — это «шаг выполнен» (`CompleteBlock`), а пустой
`elementId` — следующий блок по единственной исходящей связи узла; пару доводит
`resolveAction`. Дальше `App.jsx`
находит кнопки по ключу (`createOrder`, `sendToSupplier`, `issuePass`,
`securityPass`, `qualityApprove`, `createDocs`, `shipment`) и показывает их тому,
чья роль записана у кнопки (`role`) или у её узла (`bpmn:potentialOwner`):
перераспределение шага между ролями и правка надписи делаются в инспекторе узлов
редактора и сразу видны в кабинете.

Вычисляемый payload (номера УПД/ТТН, метки времени, идентификатор нового
экземпляра) остаётся в коде: данными он не выражается. Если кнопку убрали или
переименовали в схеме, кабинет её просто не покажет; схема без `act:userAction`
— это схема без кнопок (кнопка «Демо-схема» возвращает демо-схему SDK, в которой
кнопки есть).

## Метрики процессов и инфографика

Кабинет руководителя показывает инфографику по процессам
([`src/MetricsPanel.jsx`](src/MetricsPanel.jsx)): по карточке на процесс —
сколько запусков завершено, среднее/минимальное/максимальное время выполнения и
столбики последних запусков. Цифры приходят **с сервера** (M7): движок считает их
по Postgres и отдаёт по `GET /api/v1/metrics`
([`src/metricsApi.js`](src/metricsApi.js)) — поэтому у второго клиента панель не
пуста, а F5 не меняет значения. Рядом с временем карточка показывает разрезы
движка: «Ожидание шага», `SLA` (`slaRuns / slaSteps`) и «Брак» — превышение SLA
видно без консоли. Подпись в шапке говорит, откуда цифры: `с сервера`,
`кэш сервера` или `этот браузер`.

| Что | Откуда | Когда |
| --- | --- | --- |
| Числа в панели | `metricsClient.load()` → `toPanelRuns()` | при открытии кабинета, по кнопке «Обновить» и после финиша запуска |
| Кэш ответа | `saveMetricsCache()` / `loadMetricsCache()`, ключ `bpmn-process-metrics-cache` | после каждого ответа API: панель рисуется сразу после F5 |
| Запасные метрики браузера | `beginRun`/`completeRun`/`loadRuns`, ключ `bpmn-process-metrics` | старт и финиш процесса, пока API не ответил ни разу |

Метрика браузера ([`src/metricsStore.js`](src/metricsStore.js)) осталась
запасным источником и мгновенным откликом: её видит только тот клиент, который
запускал процессы, а недоступное или переполненное хранилище метрику не ломает
(функции возвращают `null`/`false`/`[]`). Ответ сервера перекладывается в те же
записи запусков, поэтому инфографика рисуется одинаково из обоих источников.

Отдельного события «процесс завершён» движок не шлёт: токен просто встаёт на
`bpmn:endEvent` и остаётся `ACTIVE`. Поэтому финиш локальной метрики определяет
клиент по схеме контура — у конечного узла нет исходящих связей
(`getOutgoingTargetIds`), — а экземпляр, который этот клиент не начинал, локальной
метрики не получает (время выполнения оказалось бы выдуманным). Имя процесса
(`processName`) и конечный узел берутся из схемы, а не из кода: правка схемы сразу
меняет подпись карточки и условие финиша.

Проверки: [`src/metricsApi.test.js`](src/metricsApi.test.js) (строка запроса,
разбор ответа движка, кэш, отказы шлюза),
[`src/metricsStore.test.js`](src/metricsStore.test.js) (запись,
идемпотентность, отказы хранилища, агрегаты),
[`src/MetricsPanel.test.jsx`](src/MetricsPanel.test.jsx) (карточки, плитки и
серверные разрезы, столбики, подпись источника) и
[`src/App.test.js`](src/App.test.js) (метрика переживает смену пользователя,
панель берёт цифры сервера и кэш после F5). Подробности и место метрики в
системе — [«Метрики выполненных процессов»](../README.md#метрики-выполненных-процессов)
и [«Серверные метрики»](../README.md#серверные-метрики-m7).

## BPMN Client SDK

Работа с оркестратором вынесена в SDK — [`src/bpmn-sdk`](src/bpmn-sdk/README.md).
Приложение импортирует не исходники SDK, а собранный артефакт из
[`src/vendor/bpmn-sdk`](src/vendor/README.md): он самодостаточен
(`bpmn-js` и стили внутри, React — external) и одинаково работает в браузере,
Jest и через `<script>`.

| Команда | Назначение |
| --- | --- |
| `npm run sdk:refresh` | сборка артефактов + синхронизация с клиентом + проверки |
| `npm run sdk:build` | только сборка `src/bpmn-sdk/dist` (UMD + ESM + CSS + карты) |
| `npm run sdk:sync` | только копирование артефакта в `src/vendor/bpmn-sdk` |
| `npm run sdk:verify` | проверка контракта артефактов и актуальности сборки |
| `npm run sdk:demo` | ассеты демо-страницы `<script>` (в `public/vendor`) |
| `npm run sdk:demo:clean` | удалить ассеты демо-страницы |
| `npm run build:check` | проверка production-сборки: демо-схема, роли, кнопки и клиент метрик в бандле, сборка не старше исходников |
| `npm run build:verify` | `npm run build` + `npm run build:check` одной командой |

Порядок при правке SDK: `npm run sdk:refresh && npm run test:ci`. Если SDK
изменили, но не пересобрали, упадут и `sdk:sync`, и тест
`src/vendor/bpmnSdkBundle.test.js` — сравнивается `sourceHash` из
`BUILD_INFO.json`.

Консоль клиента SDK держит чистой: предупреждение `diagram-js` об устаревшем
`ContextPad#getPad` — оно появлялось при клике по кнопке «Change element»
(гаечный ключ на узле схемы) и начиналось с `Error:`, хотя меню замены
открывалось штатно — гасится в SDK
(см. [README SDK](src/bpmn-sdk/README.md#совместимость-с-diagram-js)).

Витрина `<script>`-подключения: `npm run sdk:demo && npm start` →
[http://localhost:3000/sdk-demo.html](http://localhost:3000/sdk-demo.html).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

Собранный бандл проверяется отдельно — `npm run build:check`
([`scripts/check-bundle.mjs`](scripts/check-bundle.mjs)): в нём должны быть три
процесса демо-схемы, роли кабинетов, кнопки участников и клиент серверных
метрик, а сам бандл быть не старше исходников. Одной командой —
`npm run build:verify`. Ручной сценарий показа — [docs/demo-checklist.md](docs/demo-checklist.md).

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
