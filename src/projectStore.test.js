/**
 * Тесты хранилища проектов: список, активный проект, миграция старого кэша.
 *
 * Проект заменил два кэша схем (`bpmn-schema:CUSTOMER` / `:SUPPLIER`): схема
 * теперь одна, и правка роли не может «разъехаться» между сторонами. Миграция
 * проверяется отдельно — иначе у пользователей с сохранённой схемой пропали бы
 * правки после обновления.
 */

import {
  ACTIVE_PROJECT_KEY,
  MEMORY_PROJECT_ID,
  PROJECT_STORAGE_KEY,
  createProject,
  deleteProject,
  ensureDefaultProject,
  formatProjectSavedAt,
  getActiveProjectId,
  getProject,
  listProjects,
  migratedProjectXml,
  setActiveProjectId,
  updateProject,
} from './projectStore';
import {
  DEFAULT_CUSTOMER_BPMN_XML,
  DEFAULT_PROJECT_BPMN_XML,
  DEFAULT_PROJECT_NAME,
  DEFAULT_SUPPLIER_BPMN_XML,
} from './vendor/bpmn-sdk';
import { saveSchema } from './schemaStore';

/** `localStorage`-совместимая заглушка. */
const createMemoryStorage = (initial = {}) => {
  const data = { ...initial };

  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
    key: (index) => Object.keys(data)[index] || null,
    get length() {
      return Object.keys(data).length;
    },
  };
};

const CUSTOMER_XML = DEFAULT_PROJECT_BPMN_XML.replace(
  'Закупка и приемка сырого молока',
  'Правка Заказчика'
);

describe('projectStore: список проектов', () => {
  it('создаёт проект и находит его по идентификатору', () => {
    const storage = createMemoryStorage();

    const project = createProject({ name: 'Закупка', xml: DEFAULT_PROJECT_BPMN_XML }, { storage });

    expect(project.id).toMatch(/^project-/);
    expect(project.name).toBe('Закупка');
    expect(project.createdAt).toBe(project.updatedAt);
    expect(getProject(project.id, { storage })).toEqual(project);
    expect(listProjects({ storage })).toHaveLength(1);
  });

  it('не создаёт проект без схемы и с занятым идентификатором', () => {
    const storage = createMemoryStorage();

    expect(createProject({ xml: '' }, { storage })).toBeNull();
    expect(createProject({ id: 'fixed', xml: DEFAULT_PROJECT_BPMN_XML }, { storage })).toBeTruthy();
    expect(createProject({ id: 'fixed', xml: DEFAULT_PROJECT_BPMN_XML }, { storage })).toBeNull();
  });

  it('обновляет схему и имя проекта', () => {
    const storage = createMemoryStorage();
    const project = createProject({ xml: DEFAULT_PROJECT_BPMN_XML }, { storage });

    const updated = updateProject(project.id, { xml: CUSTOMER_XML, name: 'Новое имя' }, { storage });

    expect(updated.name).toBe('Новое имя');
    expect(updated.xml).toBe(CUSTOMER_XML);
    expect(getProject(project.id, { storage }).xml).toBe(CUSTOMER_XML);
    expect(updateProject(project.id, { xml: '' }, { storage })).toBeNull();
    expect(updateProject('unknown', { name: 'x' }, { storage })).toBeNull();
  });

  it('удаляет проект и переключает активный', () => {
    const storage = createMemoryStorage();
    const first = createProject({ id: 'one', xml: DEFAULT_PROJECT_BPMN_XML }, { storage });
    const second = createProject({ id: 'two', xml: DEFAULT_PROJECT_BPMN_XML }, { storage });

    setActiveProjectId(first.id, { storage });
    expect(deleteProject(first.id, { storage })).toBe(true);

    expect(storage.getItem(PROJECT_STORAGE_KEY)).toContain(second.id);
    expect(storage.getItem(PROJECT_STORAGE_KEY)).not.toContain('one');
    expect(getActiveProjectId({ storage })).toBe(second.id);
    expect(deleteProject('unknown', { storage })).toBe(false);
  });

  it('битые записи считает отсутствием проекта', () => {
    const storage = createMemoryStorage({
      [PROJECT_STORAGE_KEY]: '{ не json',
    });

    expect(listProjects({ storage })).toEqual([]);

    storage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([{ id: 'no-xml' }, { id: 'ok', xml: DEFAULT_PROJECT_BPMN_XML }])
    );

    expect(listProjects({ storage }).map((project) => project.id)).toEqual(['ok']);
  });
});

describe('projectStore: активный проект', () => {
  it('запоминает и снимает выбор', () => {
    const storage = createMemoryStorage();

    expect(getActiveProjectId({ storage })).toBe('');
    expect(setActiveProjectId('project-1', { storage })).toBe(true);
    expect(storage.getItem(ACTIVE_PROJECT_KEY)).toBe('project-1');
    expect(setActiveProjectId('', { storage })).toBe(true);
    expect(getActiveProjectId({ storage })).toBe('');
  });

  it('при первом запуске создаёт демо-проект и делает его активным', () => {
    const storage = createMemoryStorage();

    const project = ensureDefaultProject({ storage });

    expect(project.id).not.toBe(MEMORY_PROJECT_ID);
    expect(project.name).toBe(DEFAULT_PROJECT_NAME);
    expect(project.xml).toBe(DEFAULT_PROJECT_BPMN_XML);
    expect(getActiveProjectId({ storage })).toBe(project.id);

    // Повторный запуск не плодит проекты, а открывает тот же.
    expect(ensureDefaultProject({ storage }).id).toBe(project.id);
    expect(listProjects({ storage })).toHaveLength(1);
  });

  it('открывает активный проект, даже если он не первый', () => {
    const storage = createMemoryStorage();
    createProject({ id: 'first', xml: DEFAULT_PROJECT_BPMN_XML }, { storage });
    createProject({ id: 'second', xml: CUSTOMER_XML }, { storage });
    setActiveProjectId('second', { storage });

    expect(ensureDefaultProject({ storage }).id).toBe('second');
  });
});

describe('projectStore: миграция старого кэша схем', () => {
  it('собирает проект из bpmn-schema:CUSTOMER и :SUPPLIER', () => {
    const storage = createMemoryStorage();
    const customerEdit = DEFAULT_CUSTOMER_BPMN_XML.replace(
      'Закупка и приемка сырого молока',
      'Сохранённая правка Заказчика'
    );
    const supplierEdit = DEFAULT_SUPPLIER_BPMN_XML.replace(
      'Внутренняя отгрузка поставщика',
      'Сохранённая правка Поставщика'
    );

    saveSchema('CUSTOMER', customerEdit, { storage });
    saveSchema('SUPPLIER', supplierEdit, { storage });

    const project = ensureDefaultProject({ storage });

    expect(project.xml).toContain('Сохранённая правка Заказчика');
    expect(project.xml).toContain('Сохранённая правка Поставщика');
    expect(project.xml).toContain('Task_QualityControl');
  });

  it('без старого кэша мигрировать нечего', () => {
    expect(migratedProjectXml(createMemoryStorage())).toBe('');
  });

  it('не читает старый кэш, когда проект уже есть', () => {
    const storage = createMemoryStorage();
    createProject({ id: 'existing', xml: CUSTOMER_XML }, { storage });
    saveSchema('CUSTOMER', DEFAULT_SUPPLIER_BPMN_XML, { storage });

    expect(ensureDefaultProject({ storage }).id).toBe('existing');
  });
});

describe('projectStore: недоступное хранилище', () => {
  it('работает на проекте в памяти, не бросая исключений', () => {
    const project = ensureDefaultProject({ storage: null });

    expect(project.id).toBe(MEMORY_PROJECT_ID);
    expect(project.xml).toBe(DEFAULT_PROJECT_BPMN_XML);
    expect(listProjects({ storage: null })).toEqual([]);
    expect(getProject('any', { storage: null })).toBeNull();
    expect(createProject({ xml: DEFAULT_PROJECT_BPMN_XML }, { storage: null })).toBeNull();
    expect(setActiveProjectId('any', { storage: null })).toBe(false);
  });

  it('не падает, если хранилище бросает при чтении', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };

    expect(listProjects({ storage })).toEqual([]);
    expect(getActiveProjectId({ storage })).toBe('');
    expect(createProject({ xml: DEFAULT_PROJECT_BPMN_XML }, { storage })).toBeNull();
    expect(ensureDefaultProject({ storage }).id).toBe(MEMORY_PROJECT_ID);
  });
});

describe('projectStore: подпись сохранения', () => {
  it('форматирует метку и терпит мусор', () => {
    expect(formatProjectSavedAt('')).toBe('');
    expect(formatProjectSavedAt('не дата')).toBe('');
    expect(formatProjectSavedAt(new Date().toISOString())).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('по умолчанию работает с `localStorage` браузера', () => {
    window.localStorage.clear();

    const project = createProject({ xml: DEFAULT_PROJECT_BPMN_XML });

    expect(window.localStorage.getItem(PROJECT_STORAGE_KEY)).toContain(project.id);
    expect(listProjects().map((item) => item.id)).toEqual([project.id]);

    window.localStorage.clear();
  });
});

