/**
 * Демо-пользователи и их роли.
 *
 * Роли намеренно не привязаны к узлам схемы в коде: пользователь входит
 * под ролью, а какие шаги этой роли принадлежат — решает сама схема
 * (`bpmn:potentialOwner`, см. `bpmn-sdk/xml/bpmnXml.js`). Поэтому
 * перераспределить шаг между ролями можно в редакторе схемы, не трогая
 * `App.jsx`.
 *
 * `ROLE_CODES` — словарь для выпадающего списка «Роль исполнителя» в
 * инспекторе узлов; он выводится из `USERS`, чтобы роли пользователей и
 * варианты назначения не расходились.
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

export const USERS = [
  { username: 'executive', pass: '123', name: 'Алексей Директоров', role: 'EXECUTIVE', org: 'CUSTOMER', orgName: 'Молочный Завод', roleName: 'Руководитель Заказчика', icon: Crown },
  { username: 'supplier_exec', pass: '123', name: 'Виктор Поставщиков', role: 'SUPPLIER_EXECUTIVE', org: 'SUPPLIER', orgName: 'ООО «Альпийские Луга»', roleName: 'Руководитель Поставщика', icon: Building2 },
  { username: 'production', pass: '123', name: 'Михаил Цехов', role: 'PRODUCTION', org: 'CUSTOMER', orgName: 'Молочный Завод', roleName: 'Мастер производства', icon: PackageCheck },
  { username: 'manager', pass: '123', name: 'Иван Менеджеров', role: 'MANAGER', org: 'CUSTOMER', orgName: 'Молочный Завод', roleName: 'Менеджер закупок', icon: Factory },
  { username: 'security', pass: '123', name: 'Сергей Охранов', role: 'SECURITY', org: 'CUSTOMER', orgName: 'Молочный Завод', roleName: 'Охрана КПП', icon: ShieldCheck },
  { username: 'quality', pass: '123', name: 'Елена Лаборантова', role: 'QUALITY', org: 'CUSTOMER', orgName: 'Молочный Завод', roleName: 'Специалист ОТК', icon: ClipboardCheck },
  { username: 'supplier_mgr', pass: '123', name: 'Петр Отгрузчиков', role: 'SUPPLIER_MANAGER', org: 'SUPPLIER', orgName: 'ООО «Альпийские Луга»', roleName: 'Менеджер Поставщика', icon: Truck },
];

/** Коды ролей без дублей — варианты для назначения роли узлу. */
export const ROLE_CODES = Array.from(new Set(USERS.map((user) => user.role)));
