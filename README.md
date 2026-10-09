# ERP Simulator — тестовый клиент BPMN-оркестратора

Учебный клиент оркестратора: роли Заказчика и Поставщика, просмотр и
редактирование BPMN-схем, деплой схемы и отслеживание токенов процесса через
HTTP- и WebSocket-шлюзы (`bpmn-gateways`).

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

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

Порядок при правке SDK: `npm run sdk:refresh && npm run test:ci`. Если SDK
изменили, но не пересобрали, упадут и `sdk:sync`, и тест
`src/vendor/bpmnSdkBundle.test.js` — сравнивается `sourceHash` из
`BUILD_INFO.json`.

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
