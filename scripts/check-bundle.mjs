#!/usr/bin/env node

/**
 * Проверка production-сборки кабинета.
 *
 * Запуск:
 *   npm run build && npm run build:check   # или одной командой `npm run build:verify`
 *
 * Проверяется не «сборка прошла», а то, что в бандл попало демо целиком:
 *  - три процесса демо-схемы (завод, поставщик, клиент) — иначе кнопка
 *    «Молочный завод» создаст пустой проект;
 *  - роли, по которым входят в кабинет (в т.ч. руководители `EXECUTIVE`);
 *  - кнопки участников (`ACTION_ID`): демо идёт нажатиями, а не `curl`;
 *  - клиент серверных метрик M7 (ключ кэша, путь API, подпись плитки);
 *  - клиент схем проектов M6 (путь API, подпись версии в карточке);
 *  - сборка не старше исходников: CRA не пересобирает сам, и показать можно
 *    бандл недельной давности.
 *
 * Почему отдельный скрипт, а не Jest: Jest работает с исходниками в jsdom и
 * про минификацию ничего не знает. Ошибка «в исходниках есть, в бандле нет»
 * возможна только на уровне сборки (динамический `import`, `process.env`,
 * исключённый модуль), поэтому проверяется артефакт `build/`.
 *
 * @see package.json — скрипты `build:check` и `build:verify`
 * @see ../docs/demo-checklist.md — ручной чек-лист показа
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.dirname(SCRIPT_DIR);
const BUILD_DIR = path.join(APP_ROOT, 'build');
const SRC_DIR = path.join(APP_ROOT, 'src');

/** Результаты проверок: `{name, ok, detail}`. */
const results = [];

/** Регистрирует проверку. */
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
}

/**
 * Читает `build/asset-manifest.json` и возвращает путь к главному бандлу.
 *
 * CRA пишет карту ассетов на каждой сборке, поэтому имя с хешем не приходится
 * угадывать. Если карты нет (старая сборка), ищется `static/js/main.*.js`.
 *
 * @returns {{file: string, source: string}|null} абсолютный путь и откуда взят.
 */
function resolveMainBundle() {
  const manifestFile = path.join(BUILD_DIR, 'asset-manifest.json');

  if (fs.existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const entry = (manifest.files && manifest.files['main.js']) || '';
      if (entry) {
        return {
          file: path.join(BUILD_DIR, entry.replace(/^\//, '')),
          source: 'asset-manifest.json',
        };
      }
    } catch (error) {
      // Битая карта — не повод сдаваться: ниже есть поиск по каталогу.
    }
  }

  const jsDir = path.join(BUILD_DIR, 'static', 'js');
  if (!fs.existsSync(jsDir)) return null;

  const main = fs.readdirSync(jsDir).find((name) => /^main\.[0-9a-f]+\.js$/.test(name));
  return main ? { file: path.join(jsDir, main), source: 'поиск в static/js' } : null;
}

/**
 * Проверяет наличие строки в бандле, устойчиво к ASCII-экранированию.
 *
 * Минификатор может записать не-ASCII как `\uXXXX` (`output.asciiOnly`), тогда
 * кириллическая подпись в файле есть, а поиск по тексту её не находит.
 *
 * @param {string} code содержимое бандла.
 * @param {string} needle искомая строка.
 * @returns {boolean} `true`, если строка есть в любом виде.
 */
function contains(code, needle) {
  if (code.includes(needle)) return true;

  const escaped = Array.from(needle)
    .map((char) => {
      const point = char.charCodeAt(0);
      return point > 127 ? `\\u${point.toString(16).padStart(4, '0')}` : char;
    })
    .join('');

  return escaped !== needle && code.includes(escaped);
}

/**
 * Собирает время последнего изменения файлов каталога (рекурсивно).
 *
 * @param {string} dir каталог.
 * @param {number} [current] накопленный максимум.
 * @returns {number} время в миллисекундах (0, если файлов нет).
 */
function newestMtime(dir, current = 0) {
  if (!fs.existsSync(dir)) return current;

  let newest = current;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      newest = newestMtime(full, newest);
      continue;
    }

    const { mtimeMs } = fs.statSync(full);
    if (mtimeMs > newest) newest = mtimeMs;
  }

  return newest;
}

/**
 * Что обязано быть в бандле: группы проверок с пояснением «зачем».
 *
 * Строки взяты из источников (`src/bpmn-sdk/defaults/dairyPlant.js`,
 * `src/App.jsx`, `src/metricsApi.js`), а не придуманы: меняя демо, правьте и
 * этот список, иначе проверка начнёт врать.
 */
const MARKERS = [
  {
    group: 'демо-схема (3 процесса)',
    items: [
      { text: 'Process_Dairy', why: 'процесс завода' },
      { text: 'Process_Supplier', why: 'процесс поставщика' },
      { text: 'Process_Client', why: 'процесс клиента (M5)' },
      { text: 'Молочный завод', why: 'кнопка создания демо-проекта' },
    ],
  },
  {
    group: 'роли кабинетов',
    items: [
      { text: 'DIRECTOR', why: 'руководитель завода (EXECUTIVE)' },
      { text: 'SUPPLIER_DIRECTOR', why: 'руководитель поставщика' },
      { text: 'CLIENT_DIRECTOR', why: 'руководитель клиента' },
    ],
  },
  {
    group: 'кнопки участников (ACTION_ID)',
    items: [
      { text: 'createOrder', why: 'старт заказа' },
      { text: 'sendToSupplier', why: 'передача заказа' },
      { text: 'shipment', why: 'отгрузка поставщиком' },
      { text: 'qualityApprove', why: 'подтверждение ОТК' },
    ],
  },
  {
    group: 'серверные метрики (M7)',
    items: [
      { text: '/api/v1/metrics', why: 'путь API метрик' },
      { text: 'bpmn-process-metrics-cache', why: 'ключ кэша ответа сервера' },
      { text: 'Ожидание шага', why: 'плитка разреза движка' },
    ],
  },
  {
    group: 'схемы проектов на сервере (M6)',
    items: [
      { text: '/api/v1/projects', why: 'путь API проектов' },
      { text: 'на сервере', why: 'подпись версии в карточке проекта' },
    ],
  },
];

function checkBundle() {
  const bundle = resolveMainBundle();

  if (!bundle) {
    check(
      'бандл найден',
      false,
      'build/static/js/main.*.js отсутствует — соберите кабинет: `npm run build`'
    );
    return;
  }

  const file = bundle.file;

  if (!fs.existsSync(file)) {
    check(
      'бандл найден',
      false,
      `${path.relative(APP_ROOT, file)} нет (источник: ${bundle.source})`
    );
    return;
  }

  const code = fs.readFileSync(file, 'utf8');
  const megabytes = (Buffer.byteLength(code) / (1024 * 1024)).toFixed(2);

  check(
    'бандл найден',
    true,
    `${path.relative(APP_ROOT, file)} (${megabytes} МБ, ${bundle.source})`
  );

  for (const { group, items } of MARKERS) {
    const missing = items.filter((item) => !contains(code, item.text));

    check(
      `${group}: ${items.length} маркеров`,
      missing.length === 0,
      missing.map((item) => `${item.text} (${item.why})`).join(', ')
    );
  }

  // Сборка старше исходников — типичная ловушка перед показом: правку сделали,
  // `npm run build` не повторили, а в браузере старый код.
  const newestSource = newestMtime(SRC_DIR);
  const bundleMtime = fs.statSync(file).mtimeMs;

  check(
    'сборка не старше исходников',
    newestSource <= bundleMtime,
    newestSource > bundleMtime
      ? `исходники новее на ${Math.round((newestSource - bundleMtime) / 60000)} мин — нужен \`npm run build\``
      : ''
  );

  // Карта нужна только для отладки, но её отсутствие означает усечённую сборку.
  check(
    'source map на месте',
    fs.existsSync(`${file}.map`),
    `${path.relative(APP_ROOT, file)}.map`
  );
}

function main() {
  if (!fs.existsSync(BUILD_DIR)) {
    console.error(
      '\nКаталог build отсутствует: проверять нечего.\n' +
        'Соберите кабинет — `npm run build`, затем `npm run build:check`\n' +
        '(или одной командой: `npm run build:verify`).\n'
    );
    process.exitCode = 1;
    return;
  }

  checkBundle();

  console.log('\nПроверка production-сборки кабинета\n');

  for (const { name, ok, detail } of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
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


