import React, { useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { Settings, Layers, Hash, Type } from 'lucide-react';

export function BpmnEditor({ xml, onChange }) {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  const [elementsList, setElementsList] = useState([]);
  const [selectedElement, setSelectedElement] = useState(null);
  const [nodeId, setNodeId] = useState('');
  const [nodeName, setNodeName] = useState('');

  // Инициализация bpmn-js Modeler
  useEffect(() => {
    if (!containerRef.current) return;

    const modeler = new BpmnModeler({
      container: containerRef.current,
      keyboard: { bindTo: document }
    });

    modelerRef.current = modeler;

    // Импорт XML на холст
    modeler.importXML(xml).then(() => {
      refreshElementsList();
    }).catch(err => {
      console.error('Ошибка загрузки BPMN XML в визуальный редактор:', err);
    });

    // Слушатель изменений элементов на холсте
    const eventBus = modeler.get('eventBus');
    const updateXml = async () => {
      try {
        const { xml: newXml } = await modeler.saveXML({ format: true });
        onChange(newXml);
        refreshElementsList();
      } catch (err) {
        console.error('Ошибка сохранения XML из Modeler:', err);
      }
    };

    eventBus.on('commandStack.changed', updateXml);
    eventBus.on('selection.changed', (e) => {
      const selection = e.newSelection[0];
      if (selection) {
        selectNode(selection);
      } else {
        setSelectedElement(null);
      }
    });

    return () => {
      modeler.destroy();
    };
  }, []);

  // Обновление списка узлов схемы для быстрой GUI-навигации
  const refreshElementsList = () => {
    if (!modelerRef.current) return;
    const elementRegistry = modelerRef.current.get('elementRegistry');
    const allElements = elementRegistry.getAll().filter(el => {
      const type = el.type;
      return type.includes('Task') || type.includes('Event') || type.includes('Gateway');
    });
    setElementsList(allElements);
  };

  // Выбор узла для редактирования в GUI
  const selectNode = (element) => {
    setSelectedElement(element);
    setNodeId(element.id || '');
    setNodeName(element.businessObject?.name || '');
  };

  // Изменение ID узла через GUI
  const handleNodeIdChange = (newId) => {
    setNodeId(newId);
    if (!selectedElement || !modelerRef.current) return;
    
    const modeling = modelerRef.current.get('modeling');
    try {
      modeling.updateProperties(selectedElement, { id: newId });
    } catch (e) {
      console.warn('ID уже существует или некорректен:', e);
    }
  };

  // Изменение Названия узла через GUI
  const handleNodeNameChange = (newName) => {
    setNodeName(newName);
    if (!selectedElement || !modelerRef.current) return;
    
    const modeling = modelerRef.current.get('modeling');
    modeling.updateProperties(selectedElement, { name: newName });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Визуальный Холст BPMN */}
      <div 
        ref={containerRef} 
        style={{ 
          width: '100%', 
          height: '420px', 
          border: '1px solid #cbd5e1', 
          borderRadius: '8px', 
          backgroundColor: '#fff' 
        }} 
      />

      {/* GUI Инспектор свойств узлов */}
      <div style={{ padding: '12px', backgroundColor: '#f1f5f9', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h5 style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Settings size={14} color="#2563eb" /> Инспектор узла (GUI настройки идентификатора и параметров)
        </h5>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', alignItems: 'end' }}>
          {/* Селектор выбора узла */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>Выбрать узел на схемы:</label>
            <select 
              value={selectedElement?.id || ''} 
              onChange={(e) => {
                const el = elementsList.find(item => item.id === e.target.value);
                if (el) selectNode(el);
              }}
              style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            >
              <option value="">-- Выберите узел для настройки --</option>
              {elementsList.map(el => (
                <option key={el.id} value={el.id}>
                  {el.businessObject?.name ? `${el.businessObject.name} [${el.id}]` : el.id}
                </option>
              ))}
            </select>
          </div>

          {/* Редактирование ID узла */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px', fontWeight: '600' }}>
              Идентификатор узла (element_id):
            </label>
            <input 
              type="text" 
              disabled={!selectedElement}
              value={nodeId} 
              onChange={(e) => handleNodeIdChange(e.target.value)} 
              placeholder="Task_ExecutiveApprove"
              style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px', fontFamily: 'monospace' }}
            />
          </div>

          {/* Редактирование Названия узла */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
              Название задачи / события:
            </label>
            <input 
              type="text" 
              disabled={!selectedElement}
              value={nodeName} 
              onChange={(e) => handleNodeNameChange(e.target.value)} 
              placeholder="Согласовать заказ"
              style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}