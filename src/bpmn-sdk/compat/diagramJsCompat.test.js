import {
  CONTEXT_PAD_DEPRECATION,
  installDiagramJsCompat,
  silenceContextPadDeprecation,
} from './diagramJsCompat';

/**
 * Контекстная панель, повторяющая поведение `diagram-js` >= 14.10.
 *
 * Метод `getPad` работает (отдаёт `{ html }`), но на каждый вызов пишет в
 * консоль предупреждение со стеком — именно из-за него SDK ставит заплату.
 *
 * @returns {Object} псевдо-`contextPad` с массивом принятых целей.
 */
function createDiagramJsContextPad() {
  return {
    calls: [],
    getPad(target) {
      console.warn(
        new Error(`${CONTEXT_PAD_DEPRECATION} and will be removed in future library versions`)
      );
      this.calls.push(target);

      return { html: { target } };
    },
  };
}

describe('diagramJsCompat: silenceContextPadDeprecation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('не трогает объекты без метода `getPad`', () => {
    expect(silenceContextPadDeprecation(null)).toBe(false);
    expect(silenceContextPadDeprecation(undefined)).toBe(false);
    expect(silenceContextPadDeprecation({})).toBe(false);
    expect(silenceContextPadDeprecation({ getPad: 'нет' })).toBe(false);
  });

  it('вызывает оригинал и не плодит обёртки при повторной установке', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const contextPad = createDiagramJsContextPad();

    expect(silenceContextPadDeprecation(contextPad)).toBe(true);
    // Повторный вызов (например, при повторном монтировании редактора) ничего
    // не добавляет: обёртки не наслаиваются друг на друга.
    expect(silenceContextPadDeprecation(contextPad)).toBe(false);

    const pad = contextPad.getPad('Task_A');

    expect(pad).toEqual({ html: { target: 'Task_A' } });
    // `this` сохранён: метод по-прежнему видит свои поля.
    expect(contextPad.calls).toEqual(['Task_A']);
    // Предупреждение об устаревшем вызове до консоли не дошло.
    expect(warn).not.toHaveBeenCalled();
  });

  it('оставляет остальные предупреждения видимыми', () => {
    const contextPad = {
      getPad() {
        console.warn(new Error(`${CONTEXT_PAD_DEPRECATION} and will be removed`));
        console.warn('постороннее предупреждение');

        return { html: 'pad' };
      },
    };

    silenceContextPadDeprecation(contextPad);

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(contextPad.getPad('Task_A')).toEqual({ html: 'pad' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('постороннее предупреждение');
  });

  it('восстанавливает `console.warn`, в том числе после исключения', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const contextPad = {
      getPad() {
        throw new Error('падение внутри `getPad`');
      },
    };

    silenceContextPadDeprecation(contextPad);

    expect(() => contextPad.getPad('Task_A')).toThrow('падение внутри `getPad`');
    // Фильтр живёт только на время вызова: подменённый `console.warn` не
    // остаётся в глобальном объекте.
    expect(console.warn).toBe(warn);
  });

  it('патчит каждую панель отдельно', () => {
    const patched = createDiagramJsContextPad();
    const untouched = createDiagramJsContextPad();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    silenceContextPadDeprecation(patched);
    patched.getPad('Task_A');
    untouched.getPad('Task_B');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].message).toContain(CONTEXT_PAD_DEPRECATION);
  });
});

describe('diagramJsCompat: installDiagramJsCompat', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('отклоняет объекты, которые не являются диаграммой', () => {
    expect(installDiagramJsCompat(null)).toBe(false);
    expect(installDiagramJsCompat({})).toBe(false);
  });

  it('ставит заплату на контекстную панель диаграммы', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const contextPad = createDiagramJsContextPad();
    const diagram = { get: jest.fn(() => contextPad) };

    expect(installDiagramJsCompat(diagram)).toBe(true);

    // Панели у просмотрщиков нет, поэтому сервис запрашивается нестрого.
    expect(diagram.get).toHaveBeenCalledWith('contextPad', false);

    diagram.get('contextPad').getPad('Task_A');

    expect(warn).not.toHaveBeenCalled();
  });

  it('молча возвращает false, если контекстной панели нет', () => {
    // `strict = false` у просмотрщика: сервис просто не найден.
    expect(installDiagramJsCompat({ get: jest.fn(() => null) })).toBe(false);

    // Старая/сторонняя реализация `get`, которая бросает на отсутствующем
    // сервисе: заплата не должна ломать создание диаграммы.
    const throwing = {
      get: jest.fn(() => {
        throw new Error('No provider for contextPad!');
      }),
    };

    expect(() => installDiagramJsCompat(throwing)).not.toThrow();
    expect(installDiagramJsCompat(throwing)).toBe(false);
  });
});
