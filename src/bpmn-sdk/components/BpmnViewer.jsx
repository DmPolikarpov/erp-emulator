import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import BpmnJS from 'bpmn-js/lib/NavigatedViewer';

import { resolveTokenMap } from '../tokens';
import '../styles/bpmn-sdk.css';

/**
 * Просмотрщик BPMN-схемы (read-only) с подсветкой токенов процесса.
 *
 * Отличия от прежнего `BpmnView`:
 *  - инстанс `bpmn-js` создаётся один раз, а не при каждом изменении `xml`,
 *    поэтому зум и позиция холста не сбрасываются навигацией пользователя;
 *  - подсветка различает все состояния токена (`ACTIVE`, `COMPLETED`,
 *    `FAILED`, `TIMED_OUT`), а не только активное;
 *  - стили вынесены в CSS-файл, ошибки/загрузка сообщаются через колбэки.
 *
 * @param {Object} props
 * @param {string} props.xml BPMN 2.0 XML.
 * @param {Object<string, string>} [props.tokens] карта `element_id -> состояние`.
 * @param {string|null} [props.activeElementId] активный узел (legacy-проп).
 * @param {number|string} [props.height=520] высота холста.
 * @param {boolean} [props.fitOnImport=true] вписывать схему в холст при импорте.
 * @param {string} [props.className] дополнительные CSS-классы.
 * @param {Object} [props.style] дополнительные inline-стили.
 * @param {(viewer: Object) => void} [props.onReady] инстанс `bpmn-js` готов.
 * @param {(loading: boolean) => void} [props.onLoading] старт/окончание импорта.
 * @param {(error: Error) => void} [props.onError] ошибка импорта схемы.
 */
export function BpmnViewer({
  xml,
  tokens = {},
  activeElementId = null,
  height = 520,
  fitOnImport = true,
  className = '',
  style,
  onReady,
  onLoading,
  onError,
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const importedXmlRef = useRef(null);
  const marksRef = useRef(new Map());
  const importVersionRef = useRef(0);

  // Колбэки держим в ref, чтобы эффект инициализации не зависел от них
  // и не создавал просмотрщик заново при каждом ре-рендере.
  const callbacksRef = useRef({ onReady, onLoading, onError });
  useEffect(() => {
    callbacksRef.current = { onReady, onLoading, onError };
  }, [onReady, onLoading, onError]);

  // Карта «узел -> CSS-классы подсветки»: базовый класс и состояние токена
  // (`tokenMarkerClasses` в `tokens.js`).
  const markerClasses = useMemo(
    () => resolveTokenMap(tokens, activeElementId),
    [tokens, activeElementId]
  );

  /** Снимает прежнюю подсветку и навешивает новую. */
  const applyMarkers = useCallback((nextMarkers) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const canvas = viewer.get('canvas');
    const elementRegistry = viewer.get('elementRegistry');

    // Снимаем ровно те классы, которые навесили сами: `canvas.addMarker`
    // работает с одним классом за вызов, поэтому у узла их может быть
    // несколько (базовый + модификатор состояния).
    marksRef.current.forEach((classNames, elementId) => {
      if (!elementRegistry.get(elementId)) return;

      classNames.forEach((className) => {
        try {
          canvas.removeMarker(elementId, className);
        } catch (e) {
          // Узел мог исчезнуть вместе с предыдущей версией схемы.
        }
      });
    });
    marksRef.current.clear();

    Object.keys(nextMarkers).forEach((elementId) => {
      // diagram-js бросает TypeError для неизвестного идентификатора
      // (Canvas#_updateMarker не проверяет результат elementRegistry.get).
      if (!elementRegistry.get(elementId)) return;

      const applied = [];

      [].concat(nextMarkers[elementId] || []).filter(Boolean).forEach((className) => {
        try {
          canvas.addMarker(elementId, className);
          applied.push(className);
        } catch (e) {
          // Защита от гонок при перерисовке холста.
        }
      });

      if (applied.length > 0) marksRef.current.set(elementId, applied);
    });
  }, []);

  // Просмотрщик создаётся один раз за время жизни компонента.
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const viewer = new BpmnJS({ container: containerRef.current });
    viewerRef.current = viewer;

    if (typeof callbacksRef.current.onReady === 'function') {
      callbacksRef.current.onReady(viewer);
    }

    return () => {
      marksRef.current.clear();
      importedXmlRef.current = null;
      viewerRef.current = null;
      viewer.destroy();
    };
  }, []);

  // Импорт схемы — только когда XML действительно изменился.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    if (!xml || xml === importedXmlRef.current) {
      applyMarkers(markerClasses);
      return undefined;
    }

    let cancelled = false;
    const version = importVersionRef.current + 1;
    importVersionRef.current = version;

    if (typeof callbacksRef.current.onLoading === 'function') {
      callbacksRef.current.onLoading(true);
    }

    viewer
      .importXML(xml)
      .then(() => {
        if (cancelled || importVersionRef.current !== version) return;

        importedXmlRef.current = xml;
        if (fitOnImport) viewer.get('canvas').zoom('fit-viewport');

        marksRef.current.clear();
        applyMarkers(markerClasses);

        if (typeof callbacksRef.current.onLoading === 'function') {
          callbacksRef.current.onLoading(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;

        importedXmlRef.current = null;

        if (typeof callbacksRef.current.onLoading === 'function') {
          callbacksRef.current.onLoading(false);
        }
        if (typeof callbacksRef.current.onError === 'function') {
          callbacksRef.current.onError(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [xml, markerClasses, fitOnImport, applyMarkers]);

  return (
    <div
      className={['bpmn-sdk', 'bpmn-sdk--viewer', className].filter(Boolean).join(' ')}
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        ...style,
      }}
    >
      <div ref={containerRef} className="bpmn-sdk__canvas" />
    </div>
  );
}
