/**
 * Демо-роли: то, что осталось в коде от списка пользователей.
 *
 * Раньше здесь лежал `USERS` — фиксированный список людей с ФИО, логинами и
 * ролями. Теперь роль — это **только титул** («Мастер производства»), а её
 * название и состав живут в самой BPMN-схеме (`role:catalog` либо
 * `bpmn:potentialOwner`), поэтому вход в кабинет собирается из схемы
 * (`src/projectRoles.js`). В коде остаются только иконки: картинку данными
 * схемы не выразить, хотя имя иконки каталог и хранит (`icon="Truck"`).
 *
 * Пароль у всех демо-ролей один: это симулятор процесса, а не система
 * аутентификации. Логин выводится из кода роли (`PRODUCTION` → `production`).
 */

import {
  Building2,
  ClipboardCheck,
  Crown,
  Factory,
  PackageCheck,
  ShieldCheck,
  Truck,
} from 'lucide-react';

/** Пароль всех демо-ролей. */
export const DEFAULT_PASSWORD = '123';

/**
 * Иконки ролей по имени из схемы (`role:businessRole/@icon`).
 *
 * Набор — дело кабинета: схема хранит имя, а не картинку. Незнакомое имя
 * рисуется нейтральной иконкой, схему это не ломает.
 */
export const ROLE_ICONS = {
  Crown,
  Building2,
  PackageCheck,
  Factory,
  ShieldCheck,
  ClipboardCheck,
  Truck,
};

/** Иконка роли, у которой схема имени не назвала. */
export const DEFAULT_ROLE_ICON = PackageCheck;

/**
 * Иконка по имени из схемы.
 *
 * @param {string} name имя иконки (`Truck`).
 * @returns {Function} компонент `lucide-react`.
 */
export function roleIcon(name) {
  return ROLE_ICONS[name] || DEFAULT_ROLE_ICON;
}
