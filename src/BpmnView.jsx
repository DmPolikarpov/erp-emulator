import React, { useEffect, useRef } from 'react';
import BpmnJS from 'bpmn-js/lib/NavigatedViewer';

export function BpmnView({ xml, activeElementId }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const currentMarkerRef = useRef(null);

  // Инициализация и обработка изменений BPMN XML
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new BpmnJS({
      container: containerRef.current
    });
    viewerRef.current = viewer;

    let isMounted = true;

    async function renderBpmn() {
      if (!xml) return;
      try {
        await viewer.importXML(xml);
        if (!isMounted) return;

        const canvas = viewer.get('canvas');
        canvas.zoom('fit-viewport');

        // Сбрасываем сохраненный реф маркера при смене XML
        currentMarkerRef.current = null;

        if (activeElementId) {
          try {
            canvas.addMarker(activeElementId, 'active-node-highlight');
            currentMarkerRef.current = activeElementId;
          } catch (e) {
            // Узел еще не отрисован или отсутствует в этой версии схемы
          }
        }
      } catch (err) {
        if (isMounted) {
          console.warn('BpmnView: Ошибка рендеринга BPMN XML:', err);
        }
      }
    }

    renderBpmn();

    return () => {
      isMounted = false;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [xml]);

  // Динамическая подсветка активного узла при движении токена
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    try {
      const canvas = viewer.get('canvas');
      if (currentMarkerRef.current) {
        canvas.removeMarker(currentMarkerRef.current, 'active-node-highlight');
        currentMarkerRef.current = null;
      }
      if (activeElementId) {
        canvas.addMarker(activeElementId, 'active-node-highlight');
        currentMarkerRef.current = activeElementId;
      }
    } catch (e) {
      // Игнорируем отсутствие узла
    }
  }, [activeElementId]);

  return (
    <div style={{ width: '100%', height: '520px', position: 'relative', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fff' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      
      <style>{`
        @keyframes bpmn-pulse {
          0% {
            stroke: #2563eb;
            stroke-width: 3px;
            filter: drop-shadow(0 0 2px rgba(37, 99, 235, 0.4));
          }
          50% {
            stroke: #0284c7;
            stroke-width: 4px;
            filter: drop-shadow(0 0 8px rgba(2, 132, 199, 0.8));
          }
          100% {
            stroke: #2563eb;
            stroke-width: 3px;
            filter: drop-shadow(0 0 2px rgba(37, 99, 235, 0.4));
          }
        }

        .active-node-highlight:not(.djs-connection) .djs-visual > :nth-child(1) {
          fill: #dbeafe !important;
          animation: bpmn-pulse 2s infinite;
        }

        .active-node-highlight.djs-shape .djs-visual rect,
        .active-node-highlight.djs-shape .djs-visual circle,
        .active-node-highlight.djs-shape .djs-visual polygon {
          animation: bpmn-pulse 2s infinite;
        }
      `}</style>
    </div>
  );
}