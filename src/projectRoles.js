/**
 * Роли проекта, выведенные из BPMN-схемы.
 *
 * Это замена захардкоженному `USERS`: раньше список ролей жил в коде, и новую
 * роль нельзя было получить иначе, как правкой `App.jsx`. Теперь схема — проект
 * из нескольких процессов (`bpmn:collaboration`) и каталогов `role:catalog`, и
 * кабинет собирает вход из неё:
 *
 *  - роль = титул («Мастер производства»); отдельного ФИО у роли нет, поэтому
 *    имя участника равно названию роли — так просил заказчик;
 *  - код роли остаётся машинным (`PRODUCTION`): по нему шаг находит исполнителя
 *    (`bpmn:potentialOwner/@name`, `act:userAction/@role`);
 *  - название берётся из каталога процесса, а если каталога нет — из самого
 *    кода (`potentialOwner name="Кладовщик"` → титул «Кладовщик»). Так можно
 *    загрузить любой BPMN и отыграть его, ничего не дописывая в код;
 *  - руководитель (`EXECUTIVE`) определяется каталогом; в схеме без каталога
 *    руководителем считается роль, владеющая кнопкой старта процесса.
 *
 * Кабинет трёх-контурный (Заказчик, Поставщик и Клиент) — это следствие логики
 * заказов в `App.jsx`, а не BPMN. Поэтому первые три процесса проекта получают
 * контуры `CUSTOMER`, `SUPPLIER` и `CLIENT`, а остальные в кабинет не попадают
 * (о чём сообщает `problems`). Клиентский контур появился в M5: завод работает
 * не только с поставщиком, но и с клиентом, который заказывает готовую
 * продукцию.
 */

import {
  getActionRoles,
  getElementOwners,
  getProjectProcesses,
  getRoleAssignments,
  getRoleCatalog,
  getStartAction,
} from './vendor/bpmn-sdk';
import { DEFAULT_PASSWORD, ROLE_ICONS, roleIcon } from './roleIcons';

/** Контуры кабинета в порядке процессов проекта. */
export const CONTOUR_ORDER = ['CUSTOMER', 'SUPPLIER', 'CLIENT'];

/** Подписи контуров в интерфейсе. */
export const CONTOUR_LABELS = {
  CUSTOMER: 'ЗАКАЗЧИК',
  SUPPLIER: 'ПОСТАВЩИК',
  CLIENT: 'КЛИЕНТ',
};

/** Сколько процессов кабинет умеет вести одновременно. */
export const MAX_PROJECT_PROCESSES = CONTOUR_ORDER.length;

/** Признак роли руководителя в каталоге схемы. */
export const EXECUTIVE_KIND = 'EXECUTIVE';

/** Имена иконок — стабильный порядок для выбора иконки по коду роли. */
const ICON_NAMES = Object.keys(ROLE_ICONS);

/**
 * Логин по коду роли: `PRODUCTION` → `production`.
 *
 * Логин нужен только форме входа. Карточки ролей входят без него, поэтому у
 * роли с кодом на кириллице логин остаётся самим кодом — вводить его руками
 * никто не обязан.
 *
 * @param {string} code код роли.
 * @returns {string} логин.
 */
export function loginOf(code) {
  const slug = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || String(code || '').trim().toLowerCase() || 'participant';
}

/**
 * Иконка по коду роли, когда каталог её не назвал.
 *
 * Выбор детерминированный: одна и та же схема всегда даёт одни и те же
 * картинки, а правка схемы не перетасовывает кабинет.
 *
 * @param {string} code код роли.
 * @returns {string} имя иконки (`ROLE_ICONS`).
 */
export function iconNameOf(code) {
  const text = String(code || '');
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 1000003;
  }

  return ICON_NAMES[hash % ICON_NAMES.length] || ICON_NAMES[0];
}

/** Назначения ролей по узлам: `potentialOwner` и роли кнопок. */
function listRoleAssignments(projectXml, owners, processById) {
  const assignments = [];

  const push = (elementId, code) => {
    const process = processById.get(owners[elementId]);
    if (!process || !code) return;

    assignments.push({ elementId, code, processId: process.id });
  };

  Object.entries(getRoleAssignments(projectXml)).forEach(([elementId, code]) =>
    push(elementId, code)
  );
  getActionRoles(projectXml).forEach(({ elementId, role }) => push(elementId, role));

  return assignments;
}

/**
 * Разбирает проект: процессы, роли, вход в кабинет.
 *
 * @param {string} projectXml XML проекта (или обычная одно-процессная схема).
 * @returns {{
 *   processes: Array<{id: string, name: string, org: string, orgName: string, participantName: string}>,
 *   roles: Array<Object>,
 *   roleCodes: string[],
 *   problems: string[]
 * }} разбор проекта; `roles` — готовые «пользователи» кабинета.
 */
export function analyzeProject(projectXml) {
  const problems = [];
  const allProcesses = getProjectProcesses(projectXml);

  if (allProcesses.length === 0) {
    problems.push('В схеме нет ни одного bpmn:process — кабинету нечего отыгрывать.');
  }

  if (allProcesses.length > MAX_PROJECT_PROCESSES) {
    const contours = CONTOUR_ORDER.map((org) => CONTOUR_LABELS[org] || org).join(', ');
    problems.push(
      `В схеме ${allProcesses.length} процессов, а кабинет ведёт ${MAX_PROJECT_PROCESSES} ` +
        `(${contours}). Остальные процессы остаются в схеме, но в кабинете недоступны.`
    );
  }

  const processes = allProcesses.slice(0, MAX_PROJECT_PROCESSES).map((process, index) => ({
    ...process,
    org: CONTOUR_ORDER[index],
    orgName: process.participantName || process.name,
  }));
  const processById = new Map(processes.map((process) => [process.id, process]));

  const owners = getElementOwners(projectXml);
  const catalog = getRoleCatalog(projectXml).filter((role) => processById.has(role.processId));
  const catalogByKey = new Map(catalog.map((role) => [role.processId + ':' + role.code, role]));
  const assignments = listRoleAssignments(projectXml, owners, processById);

  const roles = [];
  const roleByKey = new Map();

  const addRole = (process, code) => {
    const key = process.id + ':' + code;
    if (roleByKey.has(key)) return roleByKey.get(key);

    const catalogRole = catalogByKey.get(key) || {};
    const title = catalogRole.title || code;
    const iconName = catalogRole.icon || iconNameOf(code);
    const role = {
      key,
      code,
      // Машинный код для кабинета: `currentUser.role` адресует шаги и кнопки
      // (`potentialOwner`/`act:userAction`), а `roleName` — титул для интерфейса.
      role: code,
      title,
      // Человека у роли нет: имя участника — это её титул.
      name: title,
      roleName: title,
      kind: catalogRole.kind || '',
      iconName,
      icon: roleIcon(iconName),
      username: loginOf(code),
      pass: DEFAULT_PASSWORD,
      org: process.org,
      orgName: process.orgName,
      processId: process.id,
      processName: process.name,
      isExecutive: false,
    };

    roleByKey.set(key, role);
    roles.push(role);

    return role;
  };

  // Сначала каталог (он задаёт порядок карточек на входе), затем роли, которые
  // есть только в назначениях узлов: схему могли нарисовать без каталога.
  catalog.forEach((role) => addRole(processById.get(role.processId), role.code));
  assignments.forEach((assignment) => addRole(processById.get(assignment.processId), assignment.code));

  if (roles.length === 0 && allProcesses.length > 0) {
    problems.push(
      'В схеме не назначено ни одной роли: добавьте bpmn:potentialOwner на задачу, ' +
        'роль в кнопку (act:userAction/@role) или каталог ролей (role:catalog).'
    );
  }

  const hasExplicitKind = catalog.some((role) => role.kind);

  if (hasExplicitKind) {
    roles.forEach((role) => {
      role.isExecutive = role.kind === EXECUTIVE_KIND;
    });
  }

  // Схема без каталога: руководителем считается тот, кто объявил кнопку старта
  // процесса — он и ведёт процесс. Если и такой роли нет, руководителем
  // становится первая роль: иначе схему не открыть в редакторе.
  if (!roles.some((role) => role.isExecutive)) {
    const startAction = getStartAction(projectXml);
    const startElementId = startAction ? startAction.elementId : '';
    const startCode = startAction && startAction.action ? startAction.action.role : '';
    const declaration = assignments.find((item) => item.elementId === startElementId);
    const owner = startCode
      ? { code: startCode, processId: owners[startElementId] }
      : declaration;

    const startRole = owner
      ? roles.find((role) => role.code === owner.code && role.processId === owner.processId)
      : null;
    const executive = startRole || roles[0];

    if (executive) executive.isExecutive = true;
  }

  return {
    processes,
    roles,
    roleCodes: Array.from(new Set(roles.map((role) => role.code))),
    problems,
  };
}

/**
 * Пользователь по введённому логину и паролю.
 *
 * Логином считается и `username`, и название роли: роль — это титул, и
 * участник может ввести его как есть.
 *
 * @param {Array<Object>} roles роли проекта (`analyzeProject().roles`).
 * @param {string} login логин или название роли.
 * @param {string} password пароль.
 * @returns {Object|null} роль либо `null`.
 */
export function findUser(roles, login, password) {
  const value = String(login || '').trim().toLowerCase();
  if (!value) return null;

  return (
    (Array.isArray(roles) ? roles : []).find(
      (role) =>
        (role.username === value || String(role.name).toLowerCase() === value) &&
        password === role.pass
    ) || null
  );
}

