import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  ELEMENT_ID_FORMAT_ERROR,
  EnginePanel,
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

const setup = (props = {}) =>
  render(<EnginePanel elements={ELEMENTS} selectedElementId={null} {...props} />);

const idField = () => screen.getByLabelText('Идентификатор узла (element_id):');
const nameField = () => screen.getByLabelText('Название задачи / события:');
const selectField = () => screen.getByLabelText('Выбрать узел на схеме:');

describe('EnginePanel: список узлов', () => {
  it('наполняет выпадающий список переданными узлами', () => {
    setup();

    expect(screen.getAllByRole('option').map((option) => option.value)).toEqual([
      '',
      'StartEvent_Customer',
      'Task_Approve',
    ]);
    expect(screen.getByText('Согласовать [Task_Approve]')).toBeTruthy();
  });

  it('строит список из XML, если elements не передан', () => {
    render(<EnginePanel xml={XML} />);

    expect(screen.getAllByRole('option').map((option) => option.value)).toEqual([
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
