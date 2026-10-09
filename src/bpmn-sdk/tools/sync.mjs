#!/usr/bin/env node

/**
 * Синхронизация артефактов BPMN Client SDK с потребителями.
 *
 *   npm run sdk:sync                 — артефакт клиента: `src/vendor/bpmn-sdk`
 *   npm run sdk:sync -- --demo       — плюс ассеты демо-страницы `public/vendor`
 *   npm run sdk:sync -- --clean-demo — удалить ассеты демо-страницы
 *   npm run sdk:sync -- --force      — синхронизировать даже устаревшую сборку
 *
 * Копирование, а не «сборка на месте»: артефакт собирается ровно один раз
 * (см. `tools/build.mjs`) и раздаётся потребителям как есть. Если исходники
 * SDK изменились после сборки (сравнивается `sourceHash` из
 * `BUILD_INFO.json`), синхронизация прерывается — иначе клиент и Jest
 * работают с устаревшим кодом SDK незаметно для разработчика.
 *
 * @see build.mjs
 * @see verify.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  APP_ROOT,
  DIST_DIR,
  ARTIFACTS,
  VENDOR_DIR,
  DEMO_ROOT_DIR,
  DEMO_BUNDLE_DIR,
  DEMO_REACT_DIR,
  REACT_UMD_FILES,
  formatBytes,
  readBuildInfo,
  computeSourceHash,
} = require('./lib/build-info.cjs');

/** Флаги командной строки. */
const flags = new Set(process.argv.slice(2));

/** Копирует файл, печатает результат и возвращает размер копии. */
function copy(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`нет файла для копирования: ${source}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  const { size } = fs.statSync(target);
  console.log(`  + ${path.relative(APP_ROOT, target)} (${formatBytes(size)})`);
  return size;
}

/**
 * Проверяет, что сборка актуальна исходникам SDK.
 *
 * @returns {Object} содержимое `BUILD_INFO.json`.
 */
function assertFresh() {
  const info = readBuildInfo();

  if (!info) {
    throw new Error('не найден BUILD_INFO.json: сначала выполните `npm run sdk:build`');
  }

  if (flags.has('--force')) {
    console.warn('  ! проверка актуальности сборки пропущена (--force)');
    return info;
  }

  const { hash } = computeSourceHash();

  if (info.sourceHash !== hash) {
    throw new Error(
      'сборка устарела: исходники SDK изменились после `npm run sdk:build` ' +
        `(BUILD_INFO ${String(info.sourceHash).slice(0, 12)}… != ${hash.slice(0, 12)}…). ` +
        'Выполните `npm run sdk:refresh`.'
    );
  }

  console.log(
    `Сборка актуальна: sha256 исходников ${info.sourceHash.slice(0, 12)}… ` +
      `(${info.builtAt}, webpack ${info.toolchain && info.toolchain.webpack})`
  );
  return info;
}

/** Копирует артефакты сборки в каталог, который импортирует клиент. */
function syncVendor() {
  console.log('\nАртефакт клиента (src/vendor/bpmn-sdk):');
  copy(path.join(DIST_DIR, ARTIFACTS.umd), path.join(VENDOR_DIR, ARTIFACTS.umd));
  // Карта кладётся рядом с бандлом: webpack CRA читает `sourceMappingURL`
  // и без файла сыпет предупреждением, а с ним карта клиента ведёт в
  // исходники SDK.
  copy(path.join(DIST_DIR, ARTIFACTS.umdMap), path.join(VENDOR_DIR, ARTIFACTS.umdMap));
  copy(
    path.join(DIST_DIR, ARTIFACTS.buildInfo),
    path.join(VENDOR_DIR, ARTIFACTS.buildInfo)
  );
}

/** Копирует ассеты демо-страницы `<script>`-подключения. */
function syncDemo() {
  console.log('\nДемо-страница <script>-подключения (public/vendor):');
  copy(path.join(DIST_DIR, ARTIFACTS.umd), path.join(DEMO_BUNDLE_DIR, ARTIFACTS.umd));
  copy(path.join(DIST_DIR, ARTIFACTS.umdMap), path.join(DEMO_BUNDLE_DIR, ARTIFACTS.umdMap));
  // Страница показывает содержимое сборки — BUILD_INFO.json нужен ей рядом.
  copy(
    path.join(DIST_DIR, ARTIFACTS.buildInfo),
    path.join(DEMO_BUNDLE_DIR, ARTIFACTS.buildInfo)
  );

  for (const [from, to] of REACT_UMD_FILES) {
    const source = path.join(APP_ROOT, 'node_modules', ...from.split('/'));

    if (!fs.existsSync(source)) {
      console.warn(`  ! пропущен ${from} (React UMD больше не поставляется)`);
      continue;
    }

    copy(source, path.join(DEMO_REACT_DIR, to));
  }
}

/** Удаляет ассеты демо-страницы (сама страница `public/sdk-demo.html` остаётся). */
function cleanDemo() {
  fs.rmSync(DEMO_ROOT_DIR, { recursive: true, force: true });
  console.log(`Очищено: ${path.relative(APP_ROOT, DEMO_ROOT_DIR)}`);
}

function main() {
  if (flags.has('--clean-demo')) {
    cleanDemo();
    return;
  }

  assertFresh();
  syncVendor();

  if (flags.has('--demo')) {
    syncDemo();
  }

  console.log('\nГотово. Артефакт подхватывается через `./vendor/bpmn-sdk`.\n');
}

try {
  main();
} catch (error) {
  console.error(`\nСинхронизация не выполнена: ${error.message}\n`);
  process.exitCode = 1;
}
