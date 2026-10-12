#!/usr/bin/env node

/**
 * Сборка артефактов BPMN Client SDK (`bpmn-sdk.umd.js`, `bpmn-sdk.esm.js`,
 * `bpmn-sdk.css`) в `src/bpmn-sdk/dist`.
 *
 * Запуск: `npm run sdk:build`.
 *
 * `webpack-cli` в проект не установлен, поэтому webpack вызывается через
 * Node API. После сборки рядом с артефактами пишется `BUILD_INFO.json`
 * (версии инструментов, размеры, sha256 артефактов и отпечаток исходников),
 * по которому `tools/sync.mjs` и `tools/verify.mjs` определяют устаревание.
 *
 * @see ../webpack.config.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const webpack = require('webpack');
const {
  DIST_DIR,
  ARTIFACTS,
  formatBytes,
  fileHash,
  writeBuildInfo,
  computeSourceHash,
} = require('./lib/build-info.cjs');
const webpackConfigs = require('../webpack.config.js');

/** Артефакты, размеры и хэши которых попадают в `BUILD_INFO.json`. */
const TRACKED_ARTIFACTS = [
  ARTIFACTS.umd,
  ARTIFACTS.umdMap,
  ARTIFACTS.esm,
  ARTIFACTS.esmMap,
  ARTIFACTS.css,
];

/** Удаляет каталог сборки: чужих файлов в артефактах быть не должно. */
function cleanDist() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

/** Описание собранных артефактов для `BUILD_INFO.json`. */
function describeArtifacts() {
  const artifacts = {};

  for (const name of TRACKED_ARTIFACTS) {
    const file = path.join(DIST_DIR, name);
    if (!fs.existsSync(file)) continue;

    const { size } = fs.statSync(file);
    artifacts[name] = { bytes: size, size: formatBytes(size), sha256: fileHash(file) };
  }

  return artifacts;
}

/** Прогоняет мульти-конфигурацию webpack и дожидается закрытия компилятора. */
function runWebpack() {
  return new Promise((resolve, reject) => {
    const compiler = webpack(webpackConfigs);

    compiler.run((runError, stats) => {
      if (runError) {
        reject(runError);
        return;
      }

      compiler.close((closeError) => (closeError ? reject(closeError) : resolve(stats)));
    });
  });
}

/** Печатает по каждой сборке список ассетов, предупреждения и ошибки. */
function printStats(stats) {
  const compilations = stats.stats ? stats.stats : [stats];

  for (const child of compilations) {
    const name = (child.compilation && child.compilation.name) || 'webpack';
    const json = child.toJson({
      all: false,
      assets: true,
      errors: true,
      warnings: true,
      timings: true,
    });

    console.log(`\n[${name}] ${json.time || 0} мс`);

    for (const asset of json.assets || []) {
      console.log(`  ${asset.name.padEnd(26)} ${formatBytes(asset.size)}`);
    }

    for (const warning of json.warnings || []) {
      console.warn(`  предупреждение: ${warning.message || warning}`);
    }

    for (const error of json.errors || []) {
      console.error(`  ошибка: ${error.message || error}`);
    }
  }
}

async function main() {
  const startedAt = Date.now();
  cleanDist();

  const stats = await runWebpack();
  printStats(stats);

  if (stats.hasErrors()) {
    console.error('\nСборка SDK завершилась ошибками: артефакты не считаются валидными.');
    process.exitCode = 1;
    return;
  }

  const info = writeBuildInfo({ artifacts: describeArtifacts() });
  const source = computeSourceHash();

  console.log(
    `\n${info.package}@${info.version} собран за ${Date.now() - startedAt} мс.`
  );
  console.log(`  каталог:   ${path.relative(process.cwd(), DIST_DIR)}`);
  console.log(`  исходники: ${source.count} файлов, sha256 ${info.sourceHash.slice(0, 12)}…`);
  console.log('  дальше:    npm run sdk:sync\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
