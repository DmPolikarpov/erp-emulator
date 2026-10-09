#!/usr/bin/env node

/**
 * Проверка артефактов BPMN Client SDK.
 *
 * Запуск: `npm run sdk:verify`.
 *
 * Проверяется не «что-то собралось», а контракт артефактов, на который
 * опираются потребители:
 *  - UMD — самодостаточный: `bpmn-js` и CSS внутри, React снаружи
 *    (иначе в клиенте окажутся две копии React и хуки SDK сломаются);
 *  - ESM — с externals и вынесенным CSS для бандлеров;
 *  - `bpmn-sdk.css` — содержит и стили SDK, и базовые стили холста;
 *  - `src/vendor/bpmn-sdk` — побайтово совпадает с `dist` (потребитель
 *    клиента не должен работать со старым бандлом);
 *  - `BUILD_INFO.json` — сборка актуальна текущим исходникам.
 *
 * Функциональная проверка (импорт бандла и состав публичного API) живёт
 * в Jest-тесте `src/vendor/bpmnSdkBundle.test.js`: там есть jsdom.
 *
 * @see build.mjs
 * @see sync.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  APP_ROOT,
  DIST_DIR,
  VENDOR_DIR,
  ARTIFACTS,
  formatBytes,
  fileHash,
  readJson,
  readBuildInfo,
  computeSourceHash,
} = require('./lib/build-info.cjs');

/** Результаты проверок. */
const results = [];

/** Регистрирует проверку. */
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}

/** Читает файл сборки как UTF-8 ('' если файла нет). */
function readDist(name) {
  try {
    return fs.readFileSync(path.join(DIST_DIR, name), 'utf8');
  } catch (error) {
    return '';
  }
}

function checkArtifacts() {
  for (const name of Object.values(ARTIFACTS)) {
    const file = path.join(DIST_DIR, name);
    check(`dist/${name} существует`, fs.existsSync(file));
  }
}

function checkFreshness() {
  const info = readBuildInfo();
  const { hash, count } = computeSourceHash();

  check('BUILD_INFO.json читается', Boolean(info));
  check(
    `сборка актуальна исходникам (${count} файлов)`,
    Boolean(info) && info.sourceHash === hash,
    info ? `${String(info.sourceHash).slice(0, 12)}… vs ${hash.slice(0, 12)}…` : ''
  );
}

function checkVendor() {
  // Карта едет вместе с бандлом: CRA читает `sourceMappingURL` и без файла
  // предупреждает о неразобранной карте.
  for (const name of [ARTIFACTS.umd, ARTIFACTS.umdMap]) {
    const inDist = path.join(DIST_DIR, name);
    const inVendor = path.join(VENDOR_DIR, name);

    check(`src/vendor/bpmn-sdk/${name} существует`, fs.existsSync(inVendor));

    if (!fs.existsSync(inVendor) || !fs.existsSync(inDist)) continue;

    check(`клиент: ${name} побайтово совпадает с dist`, fileHash(inDist) === fileHash(inVendor));
  }

  const distInfo = readJson(path.join(DIST_DIR, ARTIFACTS.buildInfo));
  const vendorInfo = readJson(path.join(VENDOR_DIR, ARTIFACTS.buildInfo));

  check(
    'BUILD_INFO.json клиента совпадает с dist',
    Boolean(distInfo) && JSON.stringify(distInfo) === JSON.stringify(vendorInfo)
  );
}

function checkUmd() {
  const umd = readDist(ARTIFACTS.umd);
  check('UMD не пустой', umd.length > 300000, formatBytes(umd.length));

  check('UMD: обёртка module.exports', umd.includes('module.exports='));
  check('UMD: глобал BpmnSdk', umd.includes('.BpmnSdk='));
  check('UMD: ветка AMD', umd.includes('define.amd'));

  check('UMD: react подключён как external', umd.includes('require("react")'));
  check('UMD: глобал React как fallback', umd.includes('.React'));

  check(
    'UMD: React не упакован в бандл',
    !umd.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED') &&
      !umd.includes('Minified React error')
  );

  check('UMD: bpmn-js упакован внутрь', umd.includes('bpmn:SequenceFlow'));
  check('UMD: CSS SDK инлайн', umd.includes('.bpmn-sdk'));
  // `.djs-*` — селекторы `diagram-js.css`, `.bpmn-icon-*` — правила шрифта.
  check('UMD: CSS холста diagram-js инлайн', umd.includes('.djs-shape'));
  check(
    'UMD: шрифт bpmn-font инлайн',
    umd.includes('@font-face') && umd.includes('font-family') && umd.includes('.bpmn-icon-')
  );
}

function checkEsm() {
  const esm = readDist(ARTIFACTS.esm);
  check('ESM не пустой', esm.length > 20000, formatBytes(esm.length));

  check('ESM: externals react', esm.includes('from "react"'));
  check('ESM: externals bpmn-js/lib/Modeler', esm.includes('from "bpmn-js/lib/Modeler"'));
  check('ESM: externals bpmn-js/lib/NavigatedViewer', esm.includes('from "bpmn-js/lib/NavigatedViewer"'));
  check('ESM: externals lucide-react', esm.includes('from "lucide-react"'));
  check('ESM: экспорт модуля', /export\s*\{/.test(esm));
  check('ESM: bpmn-js не упакован', !esm.includes('bpmn:SequenceFlow'));
  check(
    'ESM: React не упакован',
    !esm.includes('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')
  );
}

function checkCss() {
  const css = readDist(ARTIFACTS.css);
  check('CSS не пустой', css.length > 5000, formatBytes(css.length));
  check('CSS: стили SDK', css.includes('.bpmn-sdk'));
  check('CSS: стили холста diagram-js', css.includes('.djs-shape'));
  check(
    'CSS: шрифт bpmn-font',
    css.includes('@font-face') && css.includes('.bpmn-icon-') && css.includes('woff2')
  );
  // Legacy-форматы шрифта вырезаны намеренно: иначе CSS весит ~430 KB.
  check(
    'CSS: без legacy-форматов шрифта',
    !css.includes('vnd.ms-fontobject') && css.includes('data:font/woff2')
  );
}

/**
 * Проверяет демо-страницу `<script>`-подключения.
 *
 * Ассеты (`public/vendor`) генерируются по требованию, поэтому проверяются
 * не они, а сама страница: ссылки на артефакты и синтаксис inline-скрипта
 * (страница не покрыта тестами, а опечатка в ней обнаружилась бы только
 * глазами в браузере).
 */
function checkDemoPage() {
  const demoFile = path.join(APP_ROOT, 'public', 'sdk-demo.html');
  const html = fs.existsSync(demoFile) ? fs.readFileSync(demoFile, 'utf8') : '';

  check('public/sdk-demo.html существует', html.length > 0);

  if (!html) return;

  const assets = [
    '/vendor/bpmn-sdk/bpmn-sdk.umd.js',
    '/vendor/bpmn-sdk/BUILD_INFO.json',
    '/vendor/react/react.development.js',
    '/vendor/react/react-dom.development.js',
  ];

  for (const asset of assets) {
    check(`демо-страница ссылается на ${asset}`, html.includes(asset));
  }

  const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  check('демо-страница: inline-скрипт найден', script.length > 0);

  // Если ассеты уже сгенерированы (`npm run sdk:demo`), каждая ссылка
  // страницы обязана существовать: иначе в браузере будет 404 и заглушка.
  const demoAssets = path.join(APP_ROOT, 'public', 'vendor');

  if (fs.existsSync(demoAssets)) {
    const referenced = [...new Set(html.match(/\/vendor\/[A-Za-z0-9._/-]+/g) || [])];
    const missing = referenced.filter(
      (asset) => !fs.existsSync(path.join(APP_ROOT, 'public', asset))
    );

    check(
      `ассеты демо-страницы на месте (${referenced.length} ссылок)`,
      missing.length === 0,
      missing.join(', ')
    );
  }

  if (!script) return;

  let syntaxError = null;
  try {
    // Компиляция без исполнения (исполнять нечего: нужен браузер и бандл).
    Function(script); // eslint-disable-line no-new-func
  } catch (error) {
    syntaxError = error.message;
  }

  check('демо-страница: скрипт компилируется', !syntaxError, syntaxError || '');
}

function main() {
  checkArtifacts();
  checkFreshness();
  checkVendor();
  checkUmd();
  checkEsm();
  checkCss();
  checkDemoPage();

  console.log('\nПроверка артефактов BPMN Client SDK\n');

  for (const { name, ok, detail } of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  }

  console.log('\nРазмеры:');
  for (const name of Object.values(ARTIFACTS)) {
    const file = path.join(DIST_DIR, name);
    if (!fs.existsSync(file)) continue;

    const buffer = fs.readFileSync(file);
    console.log(
      `  ${name.padEnd(22)} ${formatBytes(buffer.length).padStart(9)}  ` +
        `gzip ${formatBytes(zlib.gzipSync(buffer).length).padStart(9)}`
    );
  }

  const failed = results.filter((result) => !result.ok);

  if (failed.length > 0) {
    console.error(`\nПровалено проверок: ${failed.length} из ${results.length}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nВсе проверки пройдены: ${results.length}.\n`);
}

main();
