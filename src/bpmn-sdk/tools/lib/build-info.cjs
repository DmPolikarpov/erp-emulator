'use strict';

/**
 * Общие пути и утилиты сборки BPMN Client SDK.
 *
 * Модуль написан на CommonJS осознанно: его используют и скрипты сборки
 * (`tools/*.mjs` подключают его через `createRequire`), и Jest-тест клиента
 * (`src/vendor/bpmnSdkBundle.test.js`).
 *
 * Ключевая идея — «отпечаток исходников» (`sourceHash`): sha256 по всем
 * файлам, которые влияют на артефакт. Хэш пишется в `BUILD_INFO.json`
 * рядом с бандлом, поэтому и `npm run sdk:verify`, и Jest замечают
 * ситуацию «SDK поправили, а бандл не пересобрали/не синхронизировали».
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Корень пакета SDK: `erp-simulator/src/bpmn-sdk`. */
const SDK_ROOT = path.resolve(__dirname, '..', '..');

/** Корень CRA-приложения: `erp-simulator`. */
const APP_ROOT = path.resolve(SDK_ROOT, '..', '..');

/** Каталог сборки SDK (в git не попадает). */
const DIST_DIR = path.join(SDK_ROOT, 'dist');

/** Имена файлов сборки. */
const ARTIFACTS = {
  umd: 'bpmn-sdk.umd.js',
  umdMap: 'bpmn-sdk.umd.js.map',
  esm: 'bpmn-sdk.esm.js',
  esmMap: 'bpmn-sdk.esm.js.map',
  css: 'bpmn-sdk.css',
  buildInfo: 'BUILD_INFO.json',
};

/** Каталог, куда синхронизируется артефакт, который импортирует клиент. */
const VENDOR_DIR = path.join(APP_ROOT, 'src', 'vendor', 'bpmn-sdk');

/** Каталоги демо-страницы `<script>`-подключения (в git не попадают). */
const DEMO_ROOT_DIR = path.join(APP_ROOT, 'public', 'vendor');
const DEMO_BUNDLE_DIR = path.join(DEMO_ROOT_DIR, 'bpmn-sdk');
const DEMO_REACT_DIR = path.join(DEMO_ROOT_DIR, 'react');

/** UMD-сборки React для `<script>`-страницы (React 18 их ещё поставляет). */
const REACT_UMD_FILES = [
  ['react/umd/react.development.js', 'react.development.js'],
  ['react-dom/umd/react-dom.development.js', 'react-dom.development.js'],
];

/** Каталоги SDK, которые не влияют на артефакт. */
const HASH_SKIP_DIRS = new Set(['dist', 'node_modules', 'coverage', 'tools']);

/** Файлы SDK, которые не влияют на артефакт. */
const HASH_SKIP_FILES = [
  /\.test\.jsx?$/i,
  /\.map$/i,
  /^BUILD_INFO\.json$/i,
  /^README\.md$/i,
  /^\.gitignore$/i,
];

/** Пакеты, версии которых фиксируются в `BUILD_INFO.json` (диагностика). */
const TOOLCHAIN_PACKAGES = [
  'webpack',
  'babel-loader',
  'css-loader',
  'style-loader',
  'mini-css-extract-plugin',
  'terser-webpack-plugin',
  '@babel/core',
  '@babel/preset-env',
  '@babel/preset-react',
  'react',
  'react-dom',
  'bpmn-js',
  'lucide-react',
];

/** Читает JSON-файл; `null`, если файла нет или он битый. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return null;
  }
}

/** Версия установленного пакета либо `'unknown'`. */
function readPackageVersion(name) {
  const candidates = [];
  try {
    candidates.push(require.resolve(`${name}/package.json`, { paths: [APP_ROOT, SDK_ROOT] }));
  } catch (error) {
    // Пакет без экспорта `package.json` — проверим путь напрямую.
  }
  candidates.push(path.join(APP_ROOT, 'node_modules', ...name.split('/'), 'package.json'));

  for (const file of candidates) {
    const pkg = readJson(file);
    if (pkg && pkg.version) return pkg.version;
  }

  return 'unknown';
}

/** Человекочитаемый размер файла. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Список файлов каталога (рекурсивно, без служебных каталогов). */
function listSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (HASH_SKIP_DIRS.has(entry.name)) continue;
      listSourceFiles(full, acc);
      continue;
    }

    if (!entry.isFile()) continue;
    if (HASH_SKIP_FILES.some((pattern) => pattern.test(entry.name))) continue;

    acc.push(full);
  }

  return acc;
}

/**
 * Отпечаток исходников SDK.
 *
 * @returns {{ hash: string, files: string[], count: number }}
 *   `hash` — sha256 по парам «относительный путь + содержимое»,
 *   `files` — относительные пути (для диагностики).
 */
function computeSourceHash() {
  const files = listSourceFiles(SDK_ROOT).sort();
  const digest = crypto.createHash('sha256');

  for (const file of files) {
    const relative = path.relative(SDK_ROOT, file).split(path.sep).join('/');
    digest.update(relative);
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }

  return {
    hash: digest.digest('hex'),
    files: files.map((file) => path.relative(SDK_ROOT, file).split(path.sep).join('/')),
    count: files.length,
  };
}

/** sha256 файла. */
function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** `BUILD_INFO.json` из каталога сборки (или `null`, если сборки не было). */
function readBuildInfo(dir = DIST_DIR) {
  return readJson(path.join(dir, ARTIFACTS.buildInfo));
}

/**
 * Пишет `BUILD_INFO.json` в каталог сборки.
 *
 * @param {Object} [extra] дополнительные поля (например, размеры артефактов).
 * @returns {Object} записанная информация.
 */
function writeBuildInfo(extra = {}) {
  const { hash, count } = computeSourceHash();
  const sdkPackage = readJson(path.join(SDK_ROOT, 'package.json')) || {};
  const toolchain = {};
  for (const name of TOOLCHAIN_PACKAGES) toolchain[name] = readPackageVersion(name);

  const info = {
    package: sdkPackage.name,
    version: sdkPackage.version,
    builtAt: new Date().toISOString(),
    sourceHash: hash,
    sourceFileCount: count,
    toolchain,
    ...extra,
  };

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIST_DIR, ARTIFACTS.buildInfo),
    `${JSON.stringify(info, null, 2)}\n`,
    'utf8'
  );

  return info;
}

module.exports = {
  SDK_ROOT,
  APP_ROOT,
  DIST_DIR,
  ARTIFACTS,
  VENDOR_DIR,
  DEMO_ROOT_DIR,
  DEMO_BUNDLE_DIR,
  DEMO_REACT_DIR,
  REACT_UMD_FILES,
  TOOLCHAIN_PACKAGES,
  formatBytes,
  computeSourceHash,
  fileHash,
  readJson,
  readBuildInfo,
  writeBuildInfo,
  readPackageVersion,
};
