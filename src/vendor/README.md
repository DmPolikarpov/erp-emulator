# `src/vendor` — сторонние артефакты, вкоммиченные в клиент

Каталог хранит готовые бандлы, которые CRA **не собирает из исходников**, но
которые нужны приложению как обычные модули `src` (иначе не пропускает
`ModuleScopePlugin`: файл вне `src` импортировать нельзя).

## `bpmn-sdk/` — BPMN Client SDK

```
bpmn-sdk/
  index.js              точка входа, которую импортирует приложение (в репозитории)
  bpmn-sdk.umd.js       ГЕНЕРИРУЕТСЯ: `npm run sdk:sync`
  bpmn-sdk.umd.js.map   ГЕНЕРИРУЕТСЯ: `npm run sdk:sync`
  BUILD_INFO.json       ГЕНЕРИРУЕТСЯ: `npm run sdk:sync`
```

Содержимое:

- **UMD-бандл** SDK: внутри `bpmn-js`, `diagram-js` и `lucide-react`; CSS
  (включая базовые стили холста и шрифт `bpmn-font`) инлайнён в JS, поэтому
  бандл самодостаточен и работает в Jest без ESM-танцев.
- **Внешняя зависимость** только одна — React: в CRA/Jest это
  `require('react')`, в браузере — глобал `React`. Вторая копия React ломает
  хуки SDK, поэтому React объявлен external (`src/bpmn-sdk/webpack.config.js`).
- **Карта исходников** едет рядом с бандлом: webpack CRA читает
  `sourceMappingURL`, и без файла предупреждает о неразобранной карте; с ним
  карта клиентской сборки ведёт в исходники SDK.
- `BUILD_INFO.json` фиксирует версии инструментов, размеры и sha256
  артефактов, а также `sourceHash` — отпечаток исходников SDK на момент
  сборки.

## Не редактировать вручную

`bpmn-sdk.umd.js` и `BUILD_INFO.json` перезаписываются целиком. Исходники SDK
и инструменты сборки лежат в [`src/bpmn-sdk`](../bpmn-sdk/README.md). Порядок
изменения кода SDK:

```bash
npm run sdk:refresh   # build -> sync -> verify
npm run test:ci
```

`npm run sdk:sync` откажется синхронизировать устаревшую сборку: он сравнивает
`sourceHash` из `BUILD_INFO.json` с текущими исходниками. Тот же инвариант
проверяет `src/vendor/bpmnSdkBundle.test.js`, поэтому «забыли пересобрать»
падает в тестах, а не выясняется на стенде.

| Команда | Что делает |
| --- | --- |
| `npm run sdk:build` | собирает `src/bpmn-sdk/dist` (UMD + ESM + CSS + карты) |
| `npm run sdk:sync` | копирует UMD и `BUILD_INFO.json` в `src/vendor/bpmn-sdk` |
| `npm run sdk:verify` | проверяет контракт артефактов и актуальность сборки |
| `npm run sdk:refresh` | `build` + `sync` + `verify` |
| `npm run sdk:demo` | дополнительно кладёт ассеты демо-страницы в `public/vendor` |
| `npm run sdk:demo:clean` | удаляет `public/vendor` |

Витрина для `<script>`-подключения — [`public/sdk-demo.html`](../../public/sdk-demo.html)
(требует `npm run sdk:demo`; каталог `public/vendor` в git не попадает, но
копируется в production-сборку CRA — чистите его, если он не нужен).
