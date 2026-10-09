'use strict';

/**
 * Сборка BPMN Client SDK (`@erp/bpmn-client-sdk`).
 *
 * Одна сборка даёт три артефакта в `src/bpmn-sdk/dist`:
 *
 *  1. `bpmn-sdk.umd.js` — самодостаточный UMD-бандл:
 *     - `bpmn-js` и `lucide-react` упакованы внутрь, CSS инлайнится
 *       `style-loader`-ом, поэтому для подключения нужен только React;
 *     - `react`/`react-dom` — externals: в CJS/Jest это `require('react')`,
 *       в браузере — глобалы `React`/`ReactDOM`. Вторая копия React
 *       ломает хуки SDK («Invalid hook call»), поэтому React обязан
 *       остаться external;
 *     - в таком виде бандл потребляют клиент (`src/vendor/bpmn-sdk`),
 *       `<script>`-страницы и Jest (CJS-формат парсится без ESM-танцев).
 *  2. `bpmn-sdk.esm.js` — ESM-сборка для бандлеров: externals
 *     `react`, `react-dom`, `bpmn-js`, `lucide-react`.
 *  3. `bpmn-sdk.css` — CSS, вынесенный из ESM-сборки, включая базовые
 *     стили холста `diagram-js`/`bpmn-js` и встроенный шрифт `bpmn-font`.
 *
 * Запуск: `npm run sdk:build` (см. `tools/build.mjs`). `webpack-cli` в
 * проекте нет, поэтому конфиг используется только через Node API webpack.
 *
 * @see tools/build.mjs
 * @see tools/sync.mjs
 */

const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

/** Корень пакета SDK (`erp-simulator/src/bpmn-sdk`). */
const PACKAGE_ROOT = __dirname;
/** Корень CRA-приложения (`erp-simulator`) — источник `node_modules`. */
const APP_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
/** Каталог сборки. */
const DIST_DIR = path.join(PACKAGE_ROOT, 'dist');
/** Точка входа — публичный API SDK. */
const ENTRY = path.join(PACKAGE_ROOT, 'index.js');

/** Цель сборки: совпадает с `browserslist.production` клиента. */
const BROWSER_TARGETS = ['>0.2%', 'not dead', 'not op_mini all'];

/**
 * Внешние зависимости UMD-сборки.
 *
 * `root` — имя глобала для `<script>`-подключения,
 * `commonjs`/`commonjs2` — имя пакета для `require` (CRA, Jest).
 */
const UMD_EXTERNALS = {
  react: { root: 'React', commonjs: 'react', commonjs2: 'react', amd: 'react' },
  'react-dom': {
    root: 'ReactDOM',
    commonjs: 'react-dom',
    commonjs2: 'react-dom',
    amd: 'react-dom',
  },
};

/** Внешние зависимости ESM-сборки: их резолвит потребитель бандла. */
const ESM_EXTERNALS = {
  react: 'react',
  'react-dom': 'react-dom',
  'react/jsx-runtime': 'react/jsx-runtime',
  'bpmn-js': 'bpmn-js',
  'bpmn-js/lib/Modeler': 'bpmn-js/lib/Modeler',
  'bpmn-js/lib/NavigatedViewer': 'bpmn-js/lib/NavigatedViewer',
  'lucide-react': 'lucide-react',
};


/**
 * Транспиляция исходников SDK.
 *
 * `runtime: 'classic'` выбран осознанно: automatic-runtime тянет
 * `react/jsx-runtime` и требует ещё один глобал при `<script>`-подключении,
 * а все компоненты SDK и так импортируют `React`.
 */
const babelRule = {
  test: /\.(js|jsx)$/i,
  include: PACKAGE_ROOT,
  exclude: /node_modules/,
  use: {
    loader: require.resolve('babel-loader'),
    options: {
      babelrc: false,
      configFile: false,
      cacheDirectory: false,
      presets: [
        [
          require.resolve('@babel/preset-env'),
          {
            targets: { browsers: BROWSER_TARGETS },
            modules: false,
            bugfixes: true,
            useBuiltIns: false,
          },
        ],
        [require.resolve('@babel/preset-react'), { runtime: 'classic', development: false }],
      ],
    },
  },
};

/**
 * Правила для CSS и ассетов.
 *
 * @param {string} styleHandler `style-loader` (инлайн) либо
 *   `MiniCssExtractPlugin.loader` (вынесенный файл).
 * @returns {Array<Object>} правила для `module.rules`.
 */
function styleRules(styleHandler) {
  return [
    {
      test: /\.css$/i,
      use: [
        styleHandler,
        {
          loader: require.resolve('css-loader'),
          // `sourceMap: false` — карты отдельных CSS-файлов не нужны:
          // UMD инлайнит CSS в JS, а вынесенный `bpmn-sdk.css` карту
          // получает от webpack. Заодно это убирает предупреждения
          // `Invalid mapping` при конкатенации CSS.
          options: { importLoaders: 1, sourceMap: false },
        },
      ],
    },
    // Шрифты и картинки (на случай `url()` в стилях) — внутрь бандла,
    // чтобы артефакт оставался одним файлом.
    { test: /\.(woff2?|eot|ttf|otf|svg|png|gif|jpe?g)$/i, type: 'asset/inline' },
  ];
}

/** Общие настройки резолва: зависимости берём из `node_modules` клиента. */
const commonResolve = {
  extensions: ['.js', '.jsx', '.json'],
  modules: [path.join(APP_ROOT, 'node_modules'), 'node_modules'],
  mainFields: ['module', 'browser', 'main'],
};

/** Настройки, общие для обеих сборок. */
const commonConfig = {
  mode: 'production',
  context: PACKAGE_ROOT,
  entry: ENTRY,
  devtool: 'source-map',
  target: ['web', 'es2018'],
  stats: 'errors-warnings',
  // bpmn-js весит больше дефолтного лимита ассета — размер контролируется
  // в `tools/verify.mjs`, а не предупреждениями webpack.
  performance: { hints: false },
  output: {
    path: DIST_DIR,
    // Не чистим каталог: вторая сборка дописывает свои файлы.
    clean: false,
    pathinfo: false,
  },
  optimization: {
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    splitChunks: false,
    runtimeChunk: false,
  },
};

/** UMD-сборка: самодостаточный бандл для `<script>`, CRA и Jest. */
function umdConfig() {
  return {
    ...commonConfig,
    name: 'umd',
    output: {
      ...commonConfig.output,
      filename: 'bpmn-sdk.umd.js',
      library: { name: 'BpmnSdk', type: 'umd' },
      // `this` (а не `self`) — традиционный корень UMD-обёртки: работает и в
      // классическом `<script>`, и в CommonJS-контексте Jest/CRA.
      globalObject: 'this',
      umdNamedDefine: true,
    },
    externals: UMD_EXTERNALS,
    resolve: commonResolve,
    module: { rules: [babelRule, ...styleRules(require.resolve('style-loader'))] },
    optimization: {
      ...commonConfig.optimization,
      minimize: true,
      minimizer: [
        new TerserPlugin({
          extractComments: false,
          terserOptions: { format: { comments: false } },
        }),
      ],
    },
  };
}

/** ESM-сборка: модуль + вынесенный CSS для бандлеров. */
function esmConfig() {
  return {
    ...commonConfig,
    name: 'esm',
    experiments: { outputModule: true },
    output: {
      ...commonConfig.output,
      filename: 'bpmn-sdk.esm.js',
      module: true,
      chunkFormat: 'module',
      library: { type: 'module' },
    },
    externalsType: 'module',
    externals: ESM_EXTERNALS,
    resolve: {
      ...commonResolve,
      conditionNames: ['import', 'module', 'browser', 'default'],
    },
    module: { rules: [babelRule, ...styleRules(MiniCssExtractPlugin.loader)] },
    plugins: [new MiniCssExtractPlugin({ filename: 'bpmn-sdk.css', ignoreOrder: true })],
    optimization: {
      ...commonConfig.optimization,
      // ESM отдаётся бандлерам как есть: минификацию и tree-shaking
      // выполняет потребитель.
      minimize: false,
    },
  };
}

module.exports = [umdConfig(), esmConfig()];
