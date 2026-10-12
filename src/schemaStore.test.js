/**
 * Тесты локального кэша BPMN-схем (`localStorage`).
 *
 * Хранилище — граница с внешним миром: оно бывает недоступным (приватный
 * режим), переполненным (квота) и забитым мусором от прежних версий. Поэтому
 * кроме обычного «сохранил → прочитал» проверяются отказы: функции обязаны
 * вернуть `null`/`false`, а не бросить исключение и не уронить приложение.
 */

import {
  SCHEMA_STORAGE_PREFIX,
  clearSchema,
  formatSavedAt,
  hasSavedSchema,
  loadSchema,
  normalizeOrg,
  saveSchema,
  schemaStorageKey,
} from './schemaStore';

/** Маркерные схемы: по ним видно, какая именно копия вернулась. */
const CUSTOMER_XML = '<bpmn:definitions id="CustomerEdited" />';
const SUPPLIER_XML = '<bpmn:definitions id="SupplierEdited" />';

/** Мини-хранилище в памяти с тем же контрактом, что у `localStorage`. */
const createMemoryStorage = () => {
  const data = new Map();

  return {
    data,
    getItem: jest.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: jest.fn((key, value) => {
      data.set(key, String(value));
    }),
    removeItem: jest.fn((key) => {
      data.delete(key);
    }),
  };
};

/** Хранилище, которое «ломается» на любом обращении (приватный режим браузера). */
const createFailingStorage = (error = new Error('storage is disabled')) => ({
  getItem: jest.fn(() => {
    throw error;
  }),
  setItem: jest.fn(() => {
    throw error;
  }),
  removeItem: jest.fn(() => {
    throw error;
  }),
});

describe('schemaStore: ключи и организации', () => {
  it('строит ключ по каноническому коду организации', () => {
    expect(SCHEMA_STORAGE_PREFIX).toBe('bpmn-schema:');
    expect(schemaStorageKey('CUSTOMER')).toBe('bpmn-schema:CUSTOMER');
    expect(schemaStorageKey(' supplier ')).toBe('bpmn-schema:SUPPLIER');
  });

  it('возвращает пустой ключ, если организация не задана', () => {
    ['', '   ', null, undefined, 42].forEach((org) => {
      expect(normalizeOrg(org)).toBe('');
      expect(schemaStorageKey(org)).toBe('');
    });
  });
});

describe('schemaStore: сохранение и чтение схем', () => {
  it('возвращает сохранённую схему организации', () => {
    const storage = createMemoryStorage();

    const record = saveSchema('CUSTOMER', CUSTOMER_XML, { storage });

    expect(record.org).toBe('CUSTOMER');
    expect(record.xml).toBe(CUSTOMER_XML);
    expect(loadSchema('CUSTOMER', { storage }).xml).toBe(CUSTOMER_XML);
  });

  it('держит схемы организаций раздельно', () => {
    const storage = createMemoryStorage();

    saveSchema('CUSTOMER', CUSTOMER_XML, { storage });
    saveSchema('SUPPLIER', SUPPLIER_XML, { storage });

    expect(loadSchema('CUSTOMER', { storage }).xml).toBe(CUSTOMER_XML);
    expect(loadSchema('SUPPLIER', { storage }).xml).toBe(SUPPLIER_XML);
    expect(storage.getItem).toHaveBeenCalledWith('bpmn-schema:CUSTOMER');
  });

  it('приводит организацию к каноническому виду и при записи', () => {
    const storage = createMemoryStorage();

    saveSchema('customer', CUSTOMER_XML, { storage });

    expect(loadSchema('CUSTOMER', { storage }).org).toBe('CUSTOMER');
  });

  it('проставляет время сохранения и показывает его как HH:MM:SS', () => {
    const storage = createMemoryStorage();

    const record = saveSchema('CUSTOMER', CUSTOMER_XML, { storage });

    expect(Number.isNaN(new Date(record.savedAt).getTime())).toBe(false);
    expect(formatSavedAt(record.savedAt)).toBe(
      new Date(record.savedAt).toLocaleTimeString('ru-RU')
    );
    expect(formatSavedAt(record.savedAt)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('считает отсутствующей схему, которой нет в хранилище', () => {
    const storage = createMemoryStorage();

    expect(loadSchema('CUSTOMER', { storage })).toBeNull();
    expect(hasSavedSchema('CUSTOMER', { storage })).toBe(false);
  });

  it('не сохраняет пустой XML и не трогает хранилище', () => {
    const storage = createMemoryStorage();

    ['', '   ', null, undefined].forEach((xml) => {
      expect(saveSchema('CUSTOMER', xml, { storage })).toBeNull();
    });

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(loadSchema('CUSTOMER', { storage })).toBeNull();
  });

  it('забывает сохранённый XML по запросу', () => {
    const storage = createMemoryStorage();

    saveSchema('CUSTOMER', CUSTOMER_XML, { storage });
    expect(hasSavedSchema('CUSTOMER', { storage })).toBe(true);

    expect(clearSchema('CUSTOMER', { storage })).toBe(true);
    expect(loadSchema('CUSTOMER', { storage })).toBeNull();
    expect(hasSavedSchema('CUSTOMER', { storage })).toBe(false);

    // Повторная очистка — не ошибка: правки могли вообще не сохраняться.
    expect(clearSchema('CUSTOMER', { storage })).toBe(true);
  });
});

describe('schemaStore: битые и чужие данные', () => {
  it('игнорирует записи с нечитаемым JSON', () => {
    const storage = createMemoryStorage();
    storage.data.set('bpmn-schema:CUSTOMER', '{не json');

    expect(() => loadSchema('CUSTOMER', { storage })).not.toThrow();
    expect(loadSchema('CUSTOMER', { storage })).toBeNull();
  });

  it('игнорирует записи чужого формата', () => {
    const storage = createMemoryStorage();

    ['42', 'null', '{}', '{"xml":""}', '{"xml":42}'].forEach((raw) => {
      storage.data.set('bpmn-schema:CUSTOMER', raw);

      expect(loadSchema('CUSTOMER', { storage })).toBeNull();
    });
  });

  it('подставляет пустое время, если запись сохранена другим способом', () => {
    const storage = createMemoryStorage();
    storage.data.set('bpmn-schema:CUSTOMER', JSON.stringify({ xml: CUSTOMER_XML }));

    expect(loadSchema('CUSTOMER', { storage })).toEqual({
      org: 'CUSTOMER',
      xml: CUSTOMER_XML,
      savedAt: '',
    });
    expect(formatSavedAt('')).toBe('');
    expect(formatSavedAt('не дата')).toBe('');
  });
});

describe('schemaStore: недоступное хранилище', () => {
  it('не бросает исключение при отказах хранилища', () => {
    const storage = createFailingStorage();

    expect(() => saveSchema('CUSTOMER', CUSTOMER_XML, { storage })).not.toThrow();
    expect(saveSchema('CUSTOMER', CUSTOMER_XML, { storage })).toBeNull();

    expect(() => loadSchema('CUSTOMER', { storage })).not.toThrow();
    expect(loadSchema('CUSTOMER', { storage })).toBeNull();

    // Хранилища нет вовсе (`storage: null`) — «сохранить» тоже некуда.
    expect(loadSchema('CUSTOMER', { storage: null })).toBeNull();
    expect(saveSchema('CUSTOMER', CUSTOMER_XML, { storage: null })).toBeNull();
    expect(clearSchema('CUSTOMER', { storage: null })).toBe(false);
    expect(hasSavedSchema('CUSTOMER', { storage: null })).toBe(false);
  });

  it('возвращает `null`, если запись не влезла в квоту', () => {
    const storage = createMemoryStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(saveSchema('CUSTOMER', CUSTOMER_XML, { storage })).toBeNull();
  });

  it('игнорирует организации, для которых не удалось построить ключ', () => {
    const storage = createMemoryStorage();

    expect(saveSchema('', CUSTOMER_XML, { storage })).toBeNull();
    expect(loadSchema(undefined, { storage })).toBeNull();
    expect(clearSchema(null, { storage })).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('schemaStore: хранилище браузера по умолчанию', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('работает с `localStorage`, если хранилище не задано явно', () => {
    saveSchema('CUSTOMER', CUSTOMER_XML);

    expect(window.localStorage.getItem('bpmn-schema:CUSTOMER')).toContain('CustomerEdited');
    expect(loadSchema('CUSTOMER').xml).toBe(CUSTOMER_XML);
    expect(hasSavedSchema('customer')).toBe(true);

    clearSchema('customer');

    expect(window.localStorage.getItem('bpmn-schema:CUSTOMER')).toBeNull();
  });
});
