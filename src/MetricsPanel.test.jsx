/**
 * Тесты инфографики по процессам (`MetricsPanel`).
 *
 * Панель — представление: она ничего не считает про движок, а раскладывает
 * готовые записи метрик по карточкам процессов. Поэтому тесты проверяют то, что
 * видит руководитель: подпись процесса и контур, плитки времени, столбики
 * последних запусков и подсказку столбика. Агрегаты и форматирование отдельно
 * покрыты `src/metricsStore.test.js`.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { MetricsPanel } from './MetricsPanel';
import { BAR_HEIGHT_PX } from './metricsStore';

/** Запуск процесса: тест говорит только о тех полях, которые проверяет. */
const runOf = (overrides = {}) => ({
  id: 'inst-cust-1',
  processId: 'Process_MilkCustomer_v1',
  processName: 'Закупка и приемка сырого молока',
  org: 'CUSTOMER',
  orderNumber: '№101',
  startedAt: '2026-10-12T10:00:00.000Z',
  finishedAt: '2026-10-12T10:00:04.000Z',
  durationMs: 4000,
  lastElementId: 'EndEvent_Customer',
  status: 'COMPLETED',
  ...overrides,
});

/** Значение плитки метрики по её подписи. */
const tileValue = (label) => {
  const tile = screen
    .getAllByTestId('metrics-tile')
    .find((node) => node.dataset.label === label);

  return tile ? tile.querySelector('[data-testid="metrics-value"]').textContent : null;
};

describe('MetricsPanel: инфографика по процессам', () => {
  it('без метрик показывает пустое состояние', () => {
    render(<MetricsPanel runs={[]} />);

    expect(screen.getByTestId('metrics-empty')).toBeTruthy();
    expect(screen.queryAllByTestId('metrics-process')).toHaveLength(0);
    expect(screen.getByTestId('metrics-total').textContent).toContain('Завершено: 0');
  });

  it('на каждый процесс — своя карточка с подписью и контуром', () => {
    render(
      <MetricsPanel
        runs={[
          runOf({ id: 'c1' }),
          runOf({
            id: 's1',
            org: 'SUPPLIER',
            processId: 'Process_SupplierSupply_v1',
            processName: 'Внутренняя отгрузка поставщика',
          }),
        ]}
      />
    );

    const cards = screen.getAllByTestId('metrics-process');

    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.processId).toBe('Process_MilkCustomer_v1');
    expect(cards[0].textContent).toContain('Закупка и приемка сырого молока');
    expect(cards[0].textContent).toContain('Заказчик');
    expect(cards[1].textContent).toContain('Внутренняя отгрузка поставщика');
    expect(cards[1].textContent).toContain('Поставщик');
  });

  it('процесс без имени в схеме подписан идентификатором', () => {
    render(<MetricsPanel runs={[runOf({ processName: '' })]} />);

    expect(screen.getByTestId('metrics-process').textContent).toContain(
      'Process_MilkCustomer_v1'
    );
  });

  it('плитки показывают время выполнения запусков', () => {
    render(
      <MetricsPanel
        runs={[
          runOf({ id: 'a', durationMs: 4000 }),
          runOf({ id: 'b', durationMs: 8000 }),
          runOf({ id: 'c', durationMs: 6000 }),
        ]}
      />
    );

    expect(tileValue('Выполнено')).toBe('3');
    expect(tileValue('Среднее время')).toBe('6.0 с');
    expect(tileValue('Минимум')).toBe('4.0 с');
    expect(tileValue('Максимум')).toBe('8.0 с');
    expect(tileValue('В работе')).toBeNull();
  });

  it('столбики: по одному на завершённый запуск, высота — по времени', () => {
    render(
      <MetricsPanel
        runs={[
          runOf({
            id: 'a',
            orderNumber: '№1',
            durationMs: 5000,
            finishedAt: '2026-10-12T10:00:00.000Z',
          }),
          runOf({
            id: 'b',
            orderNumber: '№2',
            durationMs: 10000,
            finishedAt: '2026-10-12T11:00:00.000Z',
          }),
          // Незавершённый запуск: времени ещё нет — столбика быть не должно.
          runOf({ id: 'c', finishedAt: null, durationMs: null, status: 'ACTIVE' }),
        ]}
      />
    );

    const bars = screen.getAllByTestId('metrics-bar');

    expect(bars).toHaveLength(2);
    // Хранилище держит записи «новые первыми», а инфографика читается слева
    // направо: старший запуск слева, последний — справа.
    expect(bars[0].getAttribute('title')).toContain('№1');
    expect(bars[1].getAttribute('title')).toContain('№2');
    // Самый долгий запуск — во всю высоту, вдвое более быстрый — вдвое ниже.
    expect(bars[0].style.height).toBe(`${BAR_HEIGHT_PX / 2}px`);
    expect(bars[1].style.height).toBe(`${BAR_HEIGHT_PX}px`);
    expect(bars[1].getAttribute('title')).toContain('10.0 с');
  });

  it('незавершённый процесс показан как «В работе»', () => {
    render(
      <MetricsPanel
        runs={[runOf({ id: 'a', finishedAt: null, durationMs: null, status: 'ACTIVE' })]}
      />
    );

    expect(tileValue('Выполнено')).toBe('0');
    expect(tileValue('Среднее время')).toBe('—');
    expect(tileValue('В работе')).toBe('1');
    expect(screen.queryAllByTestId('metrics-bar')).toHaveLength(0);
    expect(screen.getByTestId('metrics-process').textContent).toContain(
      'Завершённых запусков пока нет'
    );
  });

  it('столбиков не больше `maxBars`', () => {
    const runs = [];

    for (let index = 0; index < 5; index += 1) {
      runs.push(
        runOf({
          id: `run-${index}`,
          orderNumber: `№${index}`,
          durationMs: 1000,
          finishedAt: `2026-10-12T10:0${index}:00.000Z`,
        })
      );
    }

    render(<MetricsPanel runs={runs} maxBars={3} />);

    expect(screen.getAllByTestId('metrics-bar')).toHaveLength(3);
  });

  it('кнопка «Очистить» вызывает обработчик', () => {
    const onClear = jest.fn();

    render(<MetricsPanel runs={[runOf()]} onClear={onClear} />);

    fireEvent.click(screen.getByTestId('metrics-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('без обработчика кнопки «Очистить» нет', () => {
    render(<MetricsPanel runs={[runOf()]} />);

    expect(screen.queryByTestId('metrics-clear')).toBeNull();
  });

  it('контур пользователя показан первой карточкой', () => {
    render(
      <MetricsPanel
        preferredOrg="SUPPLIER"
        runs={[
          runOf({ id: 'c1' }),
          runOf({
            id: 's1',
            org: 'SUPPLIER',
            processId: 'Process_SupplierSupply_v1',
            processName: 'Внутренняя отгрузка поставщика',
          }),
        ]}
      />
    );

    expect(screen.getAllByTestId('metrics-process')[0].dataset.processId).toBe(
      'Process_SupplierSupply_v1'
    );
  });
});
