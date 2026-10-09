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

  const tokenMap = useMemo(
    () => resolveTokenMap(tokens, activeElementId),
    [tokens, activeElementId]
  );

  /** Снимает прежнюю подсветку и навешивает новую. */
  const applyMarkers = useCallback((markers) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const canvas = viewer.get('canvas');
    const elementRegistry = viewer.get('elementRegistry');

    marksRef.current.forEach((className, elementId) => {
      if (!elementRegistry.get(elementId)) return;
      try {
        canvas.removeMarker(elementId, className);
      } catch (e) {
        // Узел мог исчезнуть вместе с предыдущей версией схемы.
      }
    });
    marksRef.current.clear();

    Object.keys(markers).forEach((elementId) => {
      // diagram-js бросает TypeError для неизвестного идентификатора
      // (Canvas#_updateMarker не проверяет результат elementRegistry.get).
      if (!elementRegistry.get(elementId)) return;

      try {
        canvas.addMarker(elementId, markers[elementId]);
        marksRef.current.set(elementId, markers[elementId]);
      } catch (e) {
        // Защита от гонок при перерисовке холста.
      }
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
      applyMarkers(tokenMap);
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
        applyMarkers(tokenMap);

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
  }, [xml, tokenMap, fitOnImport, applyMarkers]);

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
