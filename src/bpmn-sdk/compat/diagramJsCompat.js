/**
 * Совместимость SDK с `diagram-js`/`bpmn-js` там, где библиотеки мешают друг
 * другу.
 *
 * Сейчас здесь одна заплата — устаревший вызов `ContextPad#getPad`.
 *
 * `diagram-js` (>= 14.10) объявил метод устаревшим и на **каждый** вызов пишет
 * в консоль предупреждение со стеком:
 *
 *     console.warn(new Error('ContextPad#getPad is deprecated and will be
 *       removed in future library versions, cf. .../diagram-js/pull/888'));
 *
 * При этом сам `bpmn-js` продолжает звать этот метод: кнопка «Change element»
 * (гаечный ключ на контекстной панели узла) открывает меню замены через
 * `getReplaceMenuPosition` в
 * `bpmn-js/lib/features/context-pad/ContextPadProvider.js`. В консоли клиента
 * появляется строка, начинающаяся с `Error: ContextPad#getPad is deprecated
 * ...`, и выглядит это как ошибка редактора, хотя меню открывается штатно.
 *
 * Обновление библиотек проблему не решает: проверено на самых свежих версиях
 * (`bpmn-js` 18.31.0 + `diagram-js` 15.28.1) — там тот же вызов и то же
 * предупреждение. Поэтому предупреждение гасится на стороне SDK, но **без**
 * подмены поведения: обёртка вызывает оригинальный метод и лишь не пропускает
 * в консоль одно конкретное сообщение.
 */

/** Начало сообщения, которым `diagram-js` помечает устаревший `ContextPad#getPad`. */
export const CONTEXT_PAD_DEPRECATION = 'ContextPad#getPad is deprecated';

/** Пометка «метод уже обёрнут»: повторная установка не плодит обёртки. */
const PATCH_MARK = '__bpmnSdkContextPadPatched';

/**
 * Текст значения из аргументов `console.warn`.
 *
 * `diagram-js` передаёт предупреждение как объект `Error`, поэтому читаем
 * `message`; остальные значения приводим к строке: предупреждение могут
 * передать и текстом (например, если библиотеку проверили в другой версии).
 *
 * @param {*} value аргумент `console.warn`.
 * @returns {string} текст сообщения.
 */
function textOf(value) {
  if (value instanceof Error) return value.message;
  if (value && typeof value.message === 'string') return value.message;

  return String(value);
}

/**
 * Есть ли среди аргументов `console.warn` предупреждение об устаревшем
 * `ContextPad#getPad`.
 *
 * @param {Array} args аргументы вызова `console.warn`.
 * @returns {boolean} true, если это то самое предупреждение.
 */
function isContextPadDeprecation(args) {
  return args.some((value) => textOf(value).includes(CONTEXT_PAD_DEPRECATION));
}

/**
 * Гасит предупреждение `diagram-js` об устаревшем `ContextPad#getPad`.
 *
 * Обёртка ставится на сам объект (свойство экземпляра, а не прототип): у
 * каждой диаграммы своя контекстная панель, и заплата не должна достаться
 * следующему моделлеру, созданному на той же копии `diagram-js`.
 *
 * Фильтр `console.warn` живёт ровно на время вызова: предупреждение приходит
 * из `getPad` синхронно. Остальные предупреждения (в том числе от самого
 * `diagram-js`) проходят как есть, а `console.warn` гарантированно
 * восстанавливается, даже если оригинал бросит исключение.
 *
 * @param {Object|null|undefined} contextPad сервис `contextPad` диаграммы.
 * @returns {boolean} true, если обёртка поставлена.
 */
export function silenceContextPadDeprecation(contextPad) {
  if (!contextPad || typeof contextPad.getPad !== 'function') return false;
  if (contextPad[PATCH_MARK]) return false;

  const originalGetPad = contextPad.getPad;

  contextPad.getPad = function getPad(...args) {
    const consoleWarn = console.warn;

    console.warn = function warnWithoutContextPadDeprecation(...warnArgs) {
      if (isContextPadDeprecation(warnArgs)) return;

      consoleWarn.apply(console, warnArgs);
    };

    try {
      return originalGetPad.apply(this, args);
    } finally {
      console.warn = consoleWarn;
    }
  };

  Object.defineProperty(contextPad, PATCH_MARK, {
    value: true,
    enumerable: false,
    configurable: true,
  });

  return true;
}

/**
 * Ставит совместимость на готовую диаграмму `bpmn-js`.
 *
 * @param {Object} diagram моделлер (`bpmn-js/lib/Modeler`) или просмотрщик.
 * @returns {boolean} true, если обёртка поставлена; false — если контекстной
 *   панели у диаграммы нет (просмотрщики) или она уже пропатчена.
 */
export function installDiagramJsCompat(diagram) {
  if (!diagram || typeof diagram.get !== 'function') return false;

  let contextPad = null;

  try {
    // `strict = false`: у просмотрщика (`Viewer`/`NavigatedViewer`) модуль
    // контекстной панели не подключён, и `diagram.get('contextPad')` бросил бы
    // «No provider for contextPad!».
    contextPad = diagram.get('contextPad', false);
  } catch (e) {
    contextPad = null;
  }

  return silenceContextPadDeprecation(contextPad);
}
