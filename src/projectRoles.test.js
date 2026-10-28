/**
 * Тесты разбора проекта: роли собираются из схемы, а не из списка в коде.
 *
 * Главный сценарий заказчика — «загрузить любой BPMN и отыграть его»: каталог
 * ролей (`role:catalog`) необязателен, название роли может быть прямо в
 * `bpmn:potentialOwner/@name`, а роль кнопки старта живёт в `act:userAction`.
 */

import {
  CONTOUR_LABELS,
  MAX_PROJECT_PROCESSES,
  analyzeProject,
  findUser,
  iconNameOf,
  loginOf,
} from './projectRoles';
import { DEFAULT_CUSTOMER_BPMN_XML, DEFAULT_PROJECT_BPMN_XML, buildProjectXml } from './vendor/bpmn-sdk';
import { DEFAULT_PASSWORD, ROLE_ICONS } from './roleIcons';

/** Схема без каталога ролей: титул роли — её код (так рисуют сторонние BPMN). */
const PLAIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:act="http://erp.mes/schema/bpmn/action"
                  id="Definitions_Plain" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Plain" name="Складской процесс" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Plain" name="Заявка">
      <bpmn:extensionElements>
        <act:userAction id="accept" label="Принять заявку" role="STOREKEEPER" />
      </bpmn:extensionElements>
      <bpmn:outgoing>Flow_P1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Store" name="Отгрузить">
      <bpmn:incoming>Flow_P1</bpmn:incoming>
      <bpmn:outgoing>Flow_P2</bpmn:outgoing>
      <bpmn:potentialOwner name="Кладовщик" />
    </bpmn:userTask>
    <bpmn:endEvent id="EndEvent_Plain">
      <bpmn:incoming>Flow_P2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_P1" sourceRef="StartEvent_Plain" targetRef="Task_Store" />
    <bpmn:sequenceFlow id="Flow_P2" sourceRef="Task_Store" targetRef="EndEvent_Plain" />
  </bpmn:process>
</bpmn:definitions>`;

describe('projectRoles: демо-проект SDK', () => {
  it('собирает роли обоих процессов из каталога', () => {
    const analysis = analyzeProject(DEFAULT_PROJECT_BPMN_XML);

    expect(analysis.problems).toEqual([]);
    expect(analysis.processes).toHaveLength(2);
    expect(analysis.roles).toHaveLength(7);

    expect(analysis.roles.map((role) => role.title)).toEqual([
      'Руководитель Заказчика',
      'Мастер производства',
      'Менеджер закупок',
      'Охрана КПП',
      'Специалист ОТК',
      'Руководитель Поставщика',
      'Менеджер Поставщика',
    ]);
  });

  it('имя участника равно названию роли: ФИО у роли нет', () => {
    const analysis = analyzeProject(DEFAULT_PROJECT_BPMN_XML);
    const role = analysis.roles.find((item) => item.code === 'PRODUCTION');

    expect(role.name).toBe('Мастер производства');
    expect(role.roleName).toBe('Мастер производства');
    // `currentUser.role` в кабинете — машинный код: им адресуются шаги и кнопки.
    expect(role.role).toBe('PRODUCTION');
    expect(role.title).toBe('Мастер производства');
    expect(role.username).toBe('production');
    expect(role.pass).toBe(DEFAULT_PASSWORD);
    expect(role.org).toBe('CUSTOMER');
    expect(role.orgName).toBe('Молочный Завод');
  });

  it('руководителями считает только роли с kind=EXECUTIVE', () => {
    const analysis = analyzeProject(DEFAULT_PROJECT_BPMN_XML);
    const executives = analysis.roles.filter((role) => role.isExecutive).map((role) => role.code);

    expect(executives).toEqual(['EXECUTIVE', 'SUPPLIER_EXECUTIVE']);
  });

  it('подписывает контуры проектом, а не константами', () => {
    const analysis = analyzeProject(DEFAULT_PROJECT_BPMN_XML);

    expect(analysis.processes.map((process) => process.org)).toEqual(['CUSTOMER', 'SUPPLIER']);
    expect(analysis.processes[1].orgName).toBe('ООО «Альпийские Луга»');
    expect(CONTOUR_LABELS.CUSTOMER).toBe('ЗАКАЗЧИК');
  });

  it('словарь ролей для инспектора — коды без дублей', () => {
    const analysis = analyzeProject(DEFAULT_PROJECT_BPMN_XML);

    expect(analysis.roleCodes).toEqual([
      'EXECUTIVE',
      'PRODUCTION',
      'MANAGER',
      'SECURITY',
      'QUALITY',
      'SUPPLIER_EXECUTIVE',
      'SUPPLIER_MANAGER',
    ]);
  });
});

describe('projectRoles: схема без каталога', () => {
  it('берёт название роли из potentialOwner и из кнопки', () => {
    const analysis = analyzeProject(PLAIN_XML);
    const titles = analysis.roles.map((role) => role.title);

    expect(titles).toContain('Кладовщик');
    expect(titles).toContain('STOREKEEPER');
  });

  it('руководителем делает владельца кнопки старта', () => {
    const analysis = analyzeProject(PLAIN_XML);
    const executive = analysis.roles.find((role) => role.isExecutive);

    expect(executive.code).toBe('STOREKEEPER');
  });

  it('одно-процессная схема живёт в контуре Заказчика', () => {
    const analysis = analyzeProject(DEFAULT_CUSTOMER_BPMN_XML);

    expect(analysis.processes).toHaveLength(1);
    expect(analysis.processes[0].org).toBe('CUSTOMER');
    expect(analysis.processes.find((process) => process.org === 'SUPPLIER')).toBeUndefined();
  });
});

describe('projectRoles: границы проекта', () => {
  it('ведёт три контура и предупреждает о лишних процессах', () => {
    const second = DEFAULT_CUSTOMER_BPMN_XML.replace(/Process_MilkCustomer_v1/g, 'Process_Second');
    const third = DEFAULT_CUSTOMER_BPMN_XML.replace(/Process_MilkCustomer_v1/g, 'Process_Third');
    const fourth = DEFAULT_CUSTOMER_BPMN_XML.replace(/Process_MilkCustomer_v1/g, 'Process_Fourth');
    const analysis = analyzeProject(
      buildProjectXml([
        { xml: DEFAULT_CUSTOMER_BPMN_XML },
        { xml: second },
        { xml: third },
        { xml: fourth },
      ])
    );

    expect(MAX_PROJECT_PROCESSES).toBe(3);
    expect(analysis.processes).toHaveLength(MAX_PROJECT_PROCESSES);
    expect(analysis.processes.map((process) => process.org)).toEqual([
      'CUSTOMER',
      'SUPPLIER',
      'CLIENT',
    ]);
    expect(analysis.problems.join(' ')).toContain('4 процессов');
    expect(analysis.problems.join(' ')).toContain(CONTOUR_LABELS.CLIENT);
    expect(analysis.roles.every((role) => role.processId !== 'Process_Fourth')).toBe(true);
  });

  it('третий процесс проекта получает контур Клиента', () => {
    const client = DEFAULT_CUSTOMER_BPMN_XML
      .replace(/Process_MilkCustomer_v1/g, 'Process_Client')
      .replace(/MANAGER/g, 'CLIENT_DIRECTOR');
    const second = DEFAULT_CUSTOMER_BPMN_XML.replace(
      /Process_MilkCustomer_v1/g,
      'Process_Second'
    );
    const analysis = analyzeProject(
      buildProjectXml([
        { xml: DEFAULT_CUSTOMER_BPMN_XML },
        { xml: second },
        { xml: client },
      ])
    );

    expect(analysis.processes.map((process) => process.org)).toEqual([
      'CUSTOMER',
      'SUPPLIER',
      'CLIENT',
    ]);
    expect(CONTOUR_LABELS.CLIENT).toBe('КЛИЕНТ');
    // Роли третьего процесса попадают в кабинет с контуром клиента.
    expect(analysis.roles.filter((role) => role.org === 'CLIENT').map((role) => role.code)).toContain(
      'CLIENT_DIRECTOR'
    );
    expect(analysis.problems).toEqual([]);
  });

  it('пустая схема не падает и объясняет, что не так', () => {
    const analysis = analyzeProject('');

    expect(analysis.processes).toEqual([]);
    expect(analysis.roles).toEqual([]);
    expect(analysis.problems.join(' ')).toContain('bpmn:process');
  });

  it('схема без ролей подсказывает, как их назначить', () => {
    const withoutRoles = PLAIN_XML
      .replace(/\s*<bpmn:potentialOwner name="Кладовщик" \/>/, '')
      .replace(/\s*<bpmn:extensionElements>[\s\S]*?<\/bpmn:extensionElements>/, '');
    const analysis = analyzeProject(withoutRoles);

    expect(analysis.roles).toEqual([]);
    expect(analysis.problems.join(' ')).toContain('potentialOwner');
  });
});

describe('projectRoles: вход по роли', () => {
  it('логин и название роли равнозначны, пароль общий', () => {
    const { roles } = analyzeProject(DEFAULT_PROJECT_BPMN_XML);

    expect(findUser(roles, 'quality', DEFAULT_PASSWORD).code).toBe('QUALITY');
    expect(findUser(roles, 'Специалист ОТК', DEFAULT_PASSWORD).code).toBe('QUALITY');
    expect(findUser(roles, 'quality', 'неверный')).toBeNull();
    expect(findUser(roles, '', DEFAULT_PASSWORD)).toBeNull();
  });

  it('логин выводится из кода роли', () => {
    expect(loginOf('SUPPLIER_MANAGER')).toBe('supplier_manager');
    expect(loginOf('Кладовщик')).toBe('кладовщик');
    expect(loginOf('')).toBe('participant');
  });

  it('иконка по коду детерминирована и есть в наборе кабинета', () => {
    expect(iconNameOf('QUALITY')).toBe(iconNameOf('QUALITY'));
    expect(Object.keys(ROLE_ICONS)).toContain(iconNameOf('MANAGER'));
  });
});

