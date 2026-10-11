import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
  ELEMENT_ID_FORMAT_ERROR,
  EnginePanel,
  resolveElementRole,
  resolveElementTrigger,
  TRIGGER_FIELD_ERRORS,
  triggerFieldError,
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

/**
 * Схема, в которой кросс-процессный запуск объявлен прямо в XML.
 *
 * `xmlns:trg` обязателен: без объявления namespace схема не разбирается
 * (`DOMParser` сообщает об ошибке, и `listFlowElements` вернёт пустой список).
 */
const TRIGGER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:trg="http://erp.mes/schema/bpmn/trigger" targetNamespace="http://erp">
  <bpmn:process id="Process_Demo" isExecutable="true">
    <bpmn:userTask id="Task_Approve" name="Согласовать">
      <bpmn:extensionElements>
        <trg:processTrigger targetProcessId="Process_SupplierSupply_v1" instancePrefix="inst-supp-" payloadKeys="orderNum,volume" />
      </bpmn:extensionElements>
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

/* --- поля триггера кросс-процессного запуска --- */

const targetField = () => screen.getByLabelText('Запускаемый процесс (targetProcessId):');
const prefixField = () => screen.getByLabelText('Префикс экземпляра (instancePrefix):');
const firstField = () => screen.getByLabelText('Первый узел целевого процесса (firstElementId):');
const startField = () => screen.getByLabelText('Узел-источник (startElementId):');
const payloadField = () => screen.getByLabelText('Ключи payload через запятую (payloadKeys):');

/** Подсказки `datalist` у поля «Запускаемый процесс» (других списков у панели нет). */
const targetHintOptions = () =>
  Array.from(document.querySelectorAll('datalist option')).map((option) => option.value);

/** Полный триггер канонической формы — так его собирает форма. */
const fullTrigger = (overrides = {}) => ({
  targetProcessId: '',
  instancePrefix: '',
  startElementId: '',
  firstElementId: '',
  payloadKeys: '',
  ...overrides,
});

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

describe('EnginePanel: триггер кросс-процессного запуска', () => {
  /** Узел, у которого триггер уже объявлен (живой реестр редактора). */
  const elementWithTrigger = (trigger) => [
    { id: 'Task_Approve', name: 'Согласовать', type: 'bpmn:UserTask', trigger },
  ];

  it('показывает поля триггера из реестра и подсказки-процессы', () => {
    setup({
      elements: elementWithTrigger(
        fullTrigger({
          targetProcessId: 'Process_SupplierSupply_v1',
          instancePrefix: 'inst-supp-',
          startElementId: 'Task_Approve',
          payloadKeys: 'orderNum,volume',
        })
      ),
      selectedElementId: 'Task_Approve',
      triggerTargets: [' Process_SupplierSupply_v1 ', 'Process_CustomerOrder', ''],
      onChangeTrigger: jest.fn(() => true),
    });

    expect(targetField().value).toBe('Process_SupplierSupply_v1');
    expect(prefixField().value).toBe('inst-supp-');
    expect(startField().value).toBe('Task_Approve');
    expect(firstField().value).toBe('');
    expect(payloadField().value).toBe('orderNum,volume');

    // Подсказки не заменяют ввод: `datalist` их только предлагает, а пустые
    // значения отброшены.
    expect(targetHintOptions()).toEqual([
      'Process_SupplierSupply_v1',
      'Process_CustomerOrder',
    ]);
  });

  it('читает триггер из XML, если его нет в `elements`', () => {
    render(
      <EnginePanel
        xml={TRIGGER_XML}
        selectedElementId="Task_Approve"
        triggerTargets={['Process_SupplierSupply_v1']}
        onChangeTrigger={jest.fn(() => true)}
      />
    );

    expect(targetField().value).toBe('Process_SupplierSupply_v1');
    expect(prefixField().value).toBe('inst-supp-');
    expect(payloadField().value).toBe('orderNum,volume');
    expect(firstField().value).toBe('');
  });

  it('передаёт заполненные поля наружу целиком', () => {
    const onChangeTrigger = jest.fn(() => true);
    setup({
      selectedElementId: 'Task_Approve',
      triggerTargets: ['Process_SupplierSupply_v1'],
      onChangeTrigger,
    });

    fireEvent.change(targetField(), { target: { value: 'Process_SupplierSupply_v1' } });

    expect(onChangeTrigger).toHaveBeenLastCalledWith(
      'Task_Approve',
      fullTrigger({ targetProcessId: 'Process_SupplierSupply_v1' })
    );

    // Следующая правка уносит и уже введённое обязательное поле.
    fireEvent.change(payloadField(), { target: { value: 'orderNum, volume' } });

    expect(onChangeTrigger).toHaveBeenLastCalledWith(
      'Task_Approve',
      fullTrigger({
        targetProcessId: 'Process_SupplierSupply_v1',
        payloadKeys: 'orderNum, volume',
      })
    );
    expect(payloadField().value).toBe('orderNum, volume');
  });

  it('пустое поле «Запускаемый процесс» снимает триггер целиком', () => {
    const onChangeTrigger = jest.fn(() => true);
    setup({
      elements: elementWithTrigger(
        fullTrigger({
          targetProcessId: 'Process_SupplierSupply_v1',
          instancePrefix: 'inst-supp-',
          payloadKeys: 'orderNum',
        })
      ),
      selectedElementId: 'Task_Approve',
      onChangeTrigger,
    });

    fireEvent.change(targetField(), { target: { value: '' } });

    // `null` — «триггера нет»: владелец схемы снимает разметку, а не пишет
    // её с пустым обязательным полем.
    expect(onChangeTrigger).toHaveBeenCalledWith('Task_Approve', null);
    expect(targetField().value).toBe('');
    expect(prefixField().value).toBe('');
    expect(payloadField().value).toBe('');
  });

  it('не отправляет в модель недопустимые значения и подсвечивает поле', () => {
    const onChangeTrigger = jest.fn(() => true);
    setup({ selectedElementId: 'Task_Approve', onChangeTrigger });

    fireEvent.change(targetField(), { target: { value: '1 Плохой процесс' } });

    expect(screen.getByText(TRIGGER_FIELD_ERRORS.targetProcessId)).toBeTruthy();
    expect(targetField().getAttribute('aria-invalid')).toBe('true');
    expect(onChangeTrigger).not.toHaveBeenCalled();
    expect(targetField().value).toBe('1 Плохой процесс');

    // Значение осталось в поле, поэтому следующая правка другого поля снова
    // начинается с непустого «Запускаемый процесс» и уходит в модель.
    fireEvent.change(payloadField(), { target: { value: 'orderNum' } });

    expect(onChangeTrigger).toHaveBeenCalledWith(
      'Task_Approve',
      fullTrigger({ targetProcessId: '1 Плохой процесс', payloadKeys: 'orderNum' })
    );
  });

  it('сообщает об ошибке поля, но помнит введённый текст', () => {
    const onChangeTrigger = jest.fn(() => true);
    setup({
      elements: elementWithTrigger(fullTrigger({ targetProcessId: 'Process_Supplier' })),
      selectedElementId: 'Task_Approve',
      onChangeTrigger,
    });

    fireEvent.change(prefixField(), { target: { value: 'inst supp' } });

    expect(screen.getByText(TRIGGER_FIELD_ERRORS.instancePrefix)).toBeTruthy();
    expect(prefixField().getAttribute('aria-invalid')).toBe('true');
    expect(prefixField().value).toBe('inst supp');
    expect(onChangeTrigger).not.toHaveBeenCalled();

    // Пустой «Первый узел» допустим: движок войдёт в цель штатным маршрутом.
    fireEvent.change(prefixField(), { target: { value: 'inst-supp-' } });
    fireEvent.change(firstField(), { target: { value: '' } });

    expect(onChangeTrigger).toHaveBeenLastCalledWith(
      'Task_Approve',
      fullTrigger({ targetProcessId: 'Process_Supplier', instancePrefix: 'inst-supp-' })
    );
  });

  it('откатывает поля триггера, если модель отвергла правку', () => {
    const onChangeTrigger = jest.fn(() => false);
    setup({
      elements: elementWithTrigger(
        fullTrigger({ targetProcessId: 'Process_Supplier', payloadKeys: 'orderNum' })
      ),
      selectedElementId: 'Task_Approve',
      onChangeTrigger,
    });

    fireEvent.change(targetField(), { target: { value: 'Process_Other' } });

    expect(targetField().value).toBe('Process_Supplier');
    expect(payloadField().value).toBe('orderNum');
    expect(screen.getByText(/Не удалось записать триггер/)).toBeTruthy();
  });

  it('откатывает поля триггера при исключении в модели', () => {
    const onChangeTrigger = jest.fn(() => {
      throw new Error('diagram-js: модель занята');
    });
    setup({
      elements: elementWithTrigger(fullTrigger({ targetProcessId: 'Process_Supplier' })),
      selectedElementId: 'Task_Approve',
      onChangeTrigger,
    });

    fireEvent.change(targetField(), { target: { value: 'Process_Other' } });

    expect(targetField().value).toBe('Process_Supplier');
  });

  it('откатывает незавершённый ввод, если поле покинуто без записи', () => {
    const onChangeTrigger = jest.fn(() => false);
    setup({
      elements: elementWithTrigger(fullTrigger({ targetProcessId: 'Process_Supplier' })),
      selectedElementId: 'Task_Approve',
      onChangeTrigger,
    });

    fireEvent.change(payloadField(), { target: { value: 'orderNum' } });
    fireEvent.blur(payloadField());

    expect(payloadField().value).toBe('');
  });

  it('блокирует поля триггера на последовательном потоке', () => {
    const flow = [{ id: 'Flow_1', name: '', type: 'bpmn:SequenceFlow' }];

    setup({
      elements: flow,
      selectedElementId: 'Flow_1',
      onChangeTrigger: jest.fn(() => true),
    });

    expect(targetField().disabled).toBe(true);
    expect(screen.getByText(/Триггер запуска ставится только на узлы потока/)).toBeTruthy();

    // У задачи поле снова доступно.
    cleanup();
    setup({ selectedElementId: 'Task_Approve', onChangeTrigger: jest.fn(() => true) });

    expect(targetField().disabled).toBe(false);
    expect(screen.queryByText(/Триггер запуска ставится только на узлы потока/)).toBeNull();
  });

  it('блокирует поля триггера без узла и без владельца записи', () => {
    setup({ triggerTargets: ['Process_Supplier'] });
    expect(targetField().disabled).toBe(true);

    cleanup();
    // Владелец не умеет писать триггер (`onChangeTrigger` не передан) —
    // панель работает только на чтение.
    setup({ selectedElementId: 'Task_Approve' });
    expect(targetField().disabled).toBe(true);
  });

  it('resolveElementTrigger: приоритет у значения из реестра', () => {
    const fromRegistry = fullTrigger({ targetProcessId: 'Process_Other' });

    expect(
      resolveElementTrigger({ id: 'Task_Approve', trigger: fromRegistry }, TRIGGER_XML)
    ).toBe(fromRegistry);
    expect(
      resolveElementTrigger({ id: 'Task_Approve' }, TRIGGER_XML).targetProcessId
    ).toBe('Process_SupplierSupply_v1');
    expect(resolveElementTrigger({ id: 'Task_Gone' }, TRIGGER_XML)).toBeNull();
    expect(resolveElementTrigger(null, TRIGGER_XML)).toBeNull();
  });

  it('triggerFieldError: проверяет поля теми же правилами, что и XML', () => {
    expect(triggerFieldError('targetProcessId', 'Process_Supplier')).toBe('');
    expect(triggerFieldError('targetProcessId', '')).toBe(TRIGGER_FIELD_ERRORS.targetProcessId);
    expect(triggerFieldError('instancePrefix', 'inst-supp-')).toBe('');
    expect(triggerFieldError('instancePrefix', 'inst supp')).toBe(
      TRIGGER_FIELD_ERRORS.instancePrefix
    );
    expect(triggerFieldError('startElementId', '')).toBe('');
    expect(triggerFieldError('startElementId', 'Task_Approve')).toBe('');
    expect(triggerFieldError('startElementId', '1 Task')).toBe(TRIGGER_FIELD_ERRORS.startElementId);
    expect(triggerFieldError('payloadKeys', 'orderNum, volume')).toBe('');
    expect(triggerFieldError('payloadKeys', 'order num')).toBe(TRIGGER_FIELD_ERRORS.payloadKeys);
  });
});
