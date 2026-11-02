/**
 * Подсветка токенов в `BpmnViewer`.
 *
 * `bpmn-js` — ESM-пакет, который Jest в CRA не транспилирует, поэтому на место
 * `NavigatedViewer` ставится заглушка с тем же API, который использует
 * компонент: `importXML`, `get('canvas')`, `get('elementRegistry')`, `destroy`.
 * Проверяется то, что компонент делает поверх библиотеки: маркеры получает
 * **каждый** узел карты токенов (параллельные ветви), прежняя подсветка
 * снимается, а узлы, которых нет в схеме, пропускаются.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { BPMN_TOKEN_BASE_CLASS, BPMN_TOKEN_CLASS, TOKEN_STATES } from '../constants';

jest.mock('bpmn-js/lib/NavigatedViewer', () => {
  const canvas = {
    addMarker: jest.fn(),
    removeMarker: jest.fn(),
    zoom: jest.fn(),
  };
  const elementRegistry = { get: jest.fn() };
  const viewer = {
    importXML: jest.fn(),
    get: jest.fn(),
    destroy: jest.fn(),
  };

  const getService = (service) => {
    if (service === 'canvas') return canvas;
    if (service === 'elementRegistry') return elementRegistry;
    // `installDiagramJsCompat` спрашивает `contextPad` у просмотрщика, а у него
    // модуля контекстной панели нет.
    return null;
  };

  const NavigatedViewer = jest.fn();

  /**
   * CRA включает `resetMocks`, поэтому реализации моков стираются перед каждым
   * тестом — здесь они ставятся заново.
   */
  const reset = () => {
    NavigatedViewer.mockImplementation(() => viewer);
    viewer.importXML.mockImplementation(() => Promise.resolve({ warnings: [] }));
    viewer.get.mockImplementation(getService);
    // По умолчанию `elementRegistry` знает любой узел: схемы в тесте нет.
    elementRegistry.get.mockImplementation((elementId) => ({ id: elementId }));
  };

  NavigatedViewer.__mock = { canvas, elementRegistry, viewer, reset };

  return NavigatedViewer;
});

import { BpmnViewer } from './BpmnViewer';

const { __mock: mock } = jest.requireMock('bpmn-js/lib/NavigatedViewer');

/** Схема-заглушка: содержимое не разбирается, важен факт импорта. */
const XML = '<bpmn:definitions />';

/** Пары «узел — класс» из вызовов `canvas.addMarker`. */
const markerCalls = () => mock.canvas.addMarker.mock.calls;

/** Навешен ли на узел маркер состояния (базовый класс + модификатор). */
const hasMarker = (elementId, state) =>
  markerCalls().some(
    ([id, className]) => id === elementId && className === BPMN_TOKEN_BASE_CLASS
  ) &&
  markerCalls().some(
    ([id, className]) => id === elementId && className === BPMN_TOKEN_CLASS[state]
  );

describe('BpmnViewer: подсветка токенов', () => {
  beforeEach(() => {
    // `resetMocks` (CRA) стирает реализации — ставим свои заново.
    mock.reset();
  });

  it('навешивает маркеры на каждый узел карты токенов', async () => {
    render(
      <BpmnViewer
        xml={XML}
        tokens={{
          Task_Quality: TOKEN_STATES.ACTIVE,
          Task_Security: TOKEN_STATES.ACTIVE,
          Task_Order: TOKEN_STATES.COMPLETED,
        }}
      />
    );

    // Узлов три, классов по два на узел — подсветка не сводится к одному шагу.
    await waitFor(() => expect(markerCalls()).toHaveLength(6));

    expect(hasMarker('Task_Quality', TOKEN_STATES.ACTIVE)).toBe(true);
    expect(hasMarker('Task_Security', TOKEN_STATES.ACTIVE)).toBe(true);
    expect(hasMarker('Task_Order', TOKEN_STATES.COMPLETED)).toBe(true);
  });

  it('снимает прежнюю подсветку при обновлении токенов', async () => {
    const { rerender } = render(
      <BpmnViewer
        xml={XML}
        tokens={{
          Task_Quality: TOKEN_STATES.ACTIVE,
          Task_Security: TOKEN_STATES.ACTIVE,
        }}
      />
    );

    await waitFor(() => expect(markerCalls()).toHaveLength(4));
    mock.canvas.removeMarker.mockClear();

    // Ветвь охраны завершилась: её маркеры обязаны уйти с холста.
    rerender(
      <BpmnViewer
        xml={XML}
        tokens={{
          Task_Quality: TOKEN_STATES.ACTIVE,
          Task_Security: TOKEN_STATES.COMPLETED,
        }}
      />
    );

    await waitFor(() =>
      expect(mock.canvas.removeMarker).toHaveBeenCalledWith(
        'Task_Security',
        BPMN_TOKEN_CLASS[TOKEN_STATES.ACTIVE]
      )
    );
    expect(mock.canvas.removeMarker).toHaveBeenCalledWith(
      'Task_Security',
      BPMN_TOKEN_BASE_CLASS
    );
    expect(hasMarker('Task_Security', TOKEN_STATES.COMPLETED)).toBe(true);
  });

  it('пропускает узлы, которых нет в схеме', async () => {
    // diagram-js бросает TypeError на неизвестный идентификатор, поэтому
    // компонент обязан спросить `elementRegistry` до навешивания маркера.
    mock.elementRegistry.get.mockImplementation((elementId) =>
      elementId === 'Task_Quality' ? { id: elementId } : undefined
    );

    render(
      <BpmnViewer
        xml={XML}
        tokens={{
          Task_Quality: TOKEN_STATES.ACTIVE,
          Task_RemovedFromSchema: TOKEN_STATES.ACTIVE,
        }}
      />
    );

    await waitFor(() => expect(markerCalls()).toHaveLength(2));

    expect(hasMarker('Task_Quality', TOKEN_STATES.ACTIVE)).toBe(true);
    expect(markerCalls().some(([id]) => id === 'Task_RemovedFromSchema')).toBe(false);
  });
});
