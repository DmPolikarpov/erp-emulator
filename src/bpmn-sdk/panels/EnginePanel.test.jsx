import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
  ELEMENT_ID_FORMAT_ERROR,
  EnginePanel,
  resolveElementRole,
} from './EnginePanel';

const ELEMENTS = [
  { id: 'StartEvent_Customer', name: 'Заказ принят', type: 'bpmn:StartEvent' },
  { id: 'Task_Approve', name: 'Согласовать', type: 'bpmn:UserTask' },
];

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://erp">
  <bpmn:process id="Process_Demo" isExecutable="true">
    <bpmn:startEvent id="StartEvent_Customer" name="Заказ принят" />
    <bpmn:userTask id="Task_Approve" name="Согласовать" />
  </bpmn:process>
</bpmn:definitions>`;

/** Схема, в которой роль узла назначена прямо в XML. */
const ROLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://erp">
  <bpmn:process id="Process_Demo" isExecutable="true">
    <bpmn:userTask id="Task_Approve" name="Согласовать">
      <bpmn:potentialOwner name="SECURITY" />
    </bpmn:userTask>
  </bpmn:process>
</bpmn:definitions>`;

const setup = (props = {}) =>
  render(<EnginePanel elements={ELEMENTS} selectedElementId={null} {...props} />);

const idField = () => screen.getByLabelText('Идентификатор узла (element_id):');
const nameField = () => screen.getByLabelText('Название задачи / события:');
const selectField = () => screen.getByLabelText('Выбрать узел на схеме:');
const roleField = () => screen.getByLabelText('Роль исполнителя (potentialOwner):');

/** Значения опций списка узлов (у панели два списка: узлы и роли). */
const nodeOptions = () =>
  within(selectField())
    .getAllByRole('option')
    .map((option) => option.value);

/** Значения опций списка ролей. */
const roleOptionsOf = () =>
  within(roleField())
    .getAllByRole('option')
    .map((option) => option.value);

describe('EnginePanel: список узлов', () => {
  it('наполняет выпадающий список переданными узлами', () => {
    setup();

    expect(nodeOptions()).toEqual([
      '',
      'StartEvent_Customer',
      'Task_Approve',
    ]);
    expect(screen.getByText('Согласовать [Task_Approve]')).toBeTruthy();
  });

  it('строит список из XML, если elements не передан', () => {
    render(<EnginePanel xml={XML} />);

    expect(nodeOptions()).toEqual([
      '',
      'StartEvent_Customer',
      'Task_Approve',
    ]);
  });

  it('поднимает выбор узла наружу', () => {
    const onSelect = jest.fn();
    setup({ onSelect });

    fireEvent.change(selectField(), { target: { value: 'Task_Approve' } });

    expect(onSelect).toHaveBeenCalledWith('Task_Approve');
  });

  it('снимает выбор, если узел исчез из схемы', () => {
    const onSelect = jest.fn();
    render(
      <EnginePanel
        elements={ELEMENTS}
        selectedElementId="Task_Gone"
        onSelect={onSelect}
      />
    );

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('EnginePanel: правка узла', () => {
  it('показывает идентификатор и название выбранного узла', () => {
    setup({ selectedElementId: 'Task_Approve' });

    expect(idField().value).toBe('Task_Approve');
    expect(nameField().value).toBe('Согласовать');
    expect(selectField().value).toBe('Task_Approve');
  });

  it('блокирует поля без выбранного узла', () => {
    setup();

    expect(idField().disabled).toBe(true);
    expect(nameField().disabled).toBe(true);
  });

  it('сообщает о недопустимом идентификаторе и не трогает модель', () => {
    const onChangeId = jest.fn();
    setup({ selectedElementId: 'Task_Approve', onChangeId });

    fireEvent.change(idField(), { target: { value: '1 Плохой id' } });

    expect(screen.getByText(ELEMENT_ID_FORMAT_ERROR)).toBeTruthy();
    expect(idField().getAttribute('aria-invalid')).toBe('true');
    expect(onChangeId).not.toHaveBeenCalled();
    expect(idField().value).toBe('1 Плохой id');
  });

  it('не допускает дубликат идентификатора', () => {
    const onChangeId = jest.fn();
    setup({ selectedElementId: 'Task_Approve', onChangeId });

    fireEvent.change(idField(), { target: { value: 'StartEvent_Customer' } });

    expect(
      screen.getByText('Идентификатор «StartEvent_Customer» уже занят в схеме.')
    ).toBeTruthy();
    expect(onChangeId).not.toHaveBeenCalled();
  });

  it('передаёт новое имя и идентификатор наружу', () => {
    const onChangeId = jest.fn(() => true);
    const onChangeName = jest.fn();
    setup({ selectedElementId: 'Task_Approve', onChangeId, onChangeName });

    fireEvent.change(nameField(), { target: { value: 'Согласовать заказ' } });
    fireEvent.change(idField(), { target: { value: 'Task_ExecutiveApprove' } });

    expect(onChangeName).toHaveBeenCalledWith('Task_Approve', 'Согласовать заказ');
    expect(onChangeId).toHaveBeenCalledWith('Task_Approve', 'Task_ExecutiveApprove');
    expect(screen.queryByText(ELEMENT_ID_FORMAT_ERROR)).toBeNull();
  });

  it('откатывает изменение, если модель его отвергла', () => {
    const onChangeId = jest.fn(() => false);
    setup({ selectedElementId: 'Task_Approve', onChangeId });

    fireEvent.change(idField(), { target: { value: 'Task_Renamed' } });

    expect(idField().value).toBe('Task_Approve');
    expect(
      screen.getByText('Не удалось переименовать узел — изменение отменено.')
    ).toBeTruthy();
  });

  it('откатывает изменение при исключении в модели', () => {
    const onChangeId = jest.fn(() => {
      throw new Error('diagram-js: модель занята');
    });
    setup({ selectedElementId: 'Task_Approve', onChangeId });

    fireEvent.change(idField(), { target: { value: 'Task_Renamed' } });

    expect(idField().value).toBe('Task_Approve');
    expect(
      screen.getByText('Не удалось переименовать узел — изменение отменено.')
    ).toBeTruthy();
  });

  it('возвращает черновик к фактическому значению при потере фокуса', () => {
    setup({ selectedElementId: 'Task_Approve' });

    fireEvent.change(idField(), { target: { value: 'Плохой id' } });
    expect(screen.getByText(ELEMENT_ID_FORMAT_ERROR)).toBeTruthy();

    fireEvent.blur(idField());

    expect(idField().value).toBe('Task_Approve');
    expect(screen.queryByText(ELEMENT_ID_FORMAT_ERROR)).toBeNull();
  });

  it('показывает подсказку, когда ошибок нет', () => {
    setup({ selectedElementId: 'Task_Approve' });

    expect(
      screen.getByText(/Идентификаторы узлов используются движком/)
    ).toBeTruthy();
  });
});

describe('EnginePanel: роль исполнителя (bpmn:potentialOwner)', () => {
  /** Узел с ролью так, как его отдаёт реестр редактора. */
  const elementWithRole = (role) => [
    { id: 'Task_Approve', name: 'Согласовать', type: 'bpmn:UserTask', role },
  ];

  it('показывает роль узла из реестра редактора и список ролей', () => {
    setup({
      elements: elementWithRole('QUALITY'),
      selectedElementId: 'Task_Approve',
      roleOptions: ['MANAGER', 'QUALITY', 'SECURITY'],
    });

    expect(roleField().value).toBe('QUALITY');
    expect(roleOptionsOf()).toEqual(['', 'MANAGER', 'QUALITY', 'SECURITY']);
  });

  it('читает роль из XML, если роли нет в `elements`', () => {
    render(
      <EnginePanel
        xml={ROLE_XML}
        selectedElementId="Task_Approve"
        roleOptions={['SECURITY']}
      />
    );

    expect(roleField().value).toBe('SECURITY');
  });

  it('отдаёт выбранную роль наружу и умеет её снять', () => {
    const onChangeRole = jest.fn(() => true);
    setup({
      selectedElementId: 'Task_Approve',
      roleOptions: ['QUALITY'],
      onChangeRole,
    });

    fireEvent.change(roleField(), { target: { value: 'QUALITY' } });
    expect(onChangeRole).toHaveBeenCalledWith('Task_Approve', 'QUALITY');
    expect(roleField().value).toBe('QUALITY');

    fireEvent.change(roleField(), { target: { value: '' } });
    expect(onChangeRole).toHaveBeenLastCalledWith('Task_Approve', '');
    expect(roleField().value).toBe('');
  });

  it('откатывает роль, если модель её отвергла', () => {
    const onChangeRole = jest.fn(() => false);
    setup({
      elements: elementWithRole('QUALITY'),
      selectedElementId: 'Task_Approve',
      roleOptions: ['QUALITY', 'MANAGER'],
      onChangeRole,
    });

    fireEvent.change(roleField(), { target: { value: 'MANAGER' } });

    expect(roleField().value).toBe('QUALITY');
  });

  it('откатывает роль при исключении в модели', () => {
    const onChangeRole = jest.fn(() => {
      throw new Error('diagram-js: модель занята');
    });
    setup({
      elements: elementWithRole('SECURITY'),
      selectedElementId: 'Task_Approve',
      roleOptions: ['SECURITY'],
      onChangeRole,
    });

    fireEvent.change(roleField(), { target: { value: '' } });

    expect(roleField().value).toBe('SECURITY');
  });

  it('добавляет в список роль из схемы, которой нет среди переданных', () => {
    setup({
      elements: elementWithRole('ROBOT_CELL'),
      selectedElementId: 'Task_Approve',
      roleOptions: ['QUALITY'],
    });

    expect(roleOptionsOf()).toEqual(['', 'QUALITY', 'ROBOT_CELL']);
  });

  it('блокирует поле роли без выбранного узла и без вариантов выбора', () => {
    setup({ roleOptions: ['QUALITY'] });
    expect(roleField().disabled).toBe(true);
  });

  it('без вариантов ролей поле доступно, чтобы снять назначение', () => {
    render(
      <EnginePanel elements={elementWithRole('QUALITY')} selectedElementId="Task_Approve" />
    );

    expect(roleField().disabled).toBe(false);
    expect(roleOptionsOf()).toEqual(['', 'QUALITY']);
  });

  it('блокирует поле роли для событий и шлюзов (там нет `resourceRole`)', () => {
    const gateway = [
      { id: 'Gateway_1', name: 'Развилка', type: 'bpmn:ExclusiveGateway', role: '' },
    ];

    setup({
      elements: gateway,
      selectedElementId: 'Gateway_1',
      roleOptions: ['QUALITY'],
    });

    expect(roleField().disabled).toBe(true);
    expect(screen.getByText(/Роль назначается только задачам и подпроцессам/)).toBeTruthy();

    // У задачи поле снова доступно.
    cleanup();
    setup({
      elements: ELEMENTS,
      selectedElementId: 'Task_Approve',
      roleOptions: ['QUALITY'],
    });

    expect(roleField().disabled).toBe(false);
    expect(screen.queryByText(/Роль назначается только задачам/)).toBeNull();
  });

  it('resolveElementRole: приоритет у значения из реестра', () => {
    expect(resolveElementRole({ id: 'Task_Approve', role: 'QUALITY' }, ROLE_XML)).toBe('QUALITY');
    expect(resolveElementRole({ id: 'Task_Approve' }, ROLE_XML)).toBe('SECURITY');
    expect(resolveElementRole(null, ROLE_XML)).toBe('');
  });
});
