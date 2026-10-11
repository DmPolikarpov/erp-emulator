import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modeler from 'bpmn-js/lib/Modeler';

import { XML_CHANGE_DEBOUNCE_MS } from '../constants';
import {
  POTENTIAL_OWNER_TYPE,
  isActivityType,
  isFlowElementType,
  isValidElementId,
  isValidRole,
} from '../xml/bpmnXml';
import { EnginePanel } from '../panels/EnginePanel';
import '../styles/bpmn-sdk.css';

/**
 * Роль исполнителя из бизнес-объекта узла.
 *
 * Роль хранится в `bpmn:potentialOwner` — это штатное свойство
 * `bpmn:Activity#resources` из спецификации BPMN 2.0, оно уже описано в
 * `bpmn-moddle` внутри `bpmn-js`. Поэтому роль переживает импорт и экспорт
 * схемы, хотя моделлер создаётся без `moddleExtensions` (собственные типы
 * вроде `camunda:*` в такой конфигурации молча теряются).
 *
 * @param {Object} businessObject бизнес-объект элемента из `elementRegistry`.
 * @returns {string} роль либо `''`, если роль не назначена.
 */
function roleOfBusinessObject(businessObject) {
  const resources = (businessObject && businessObject.resources) || [];
  const owner = Array.isArray(resources) ? resources[0] : null;

  return owner && owner.name ? owner.name : '';
}

/**
 * Редактор BPMN-схемы с инспектором узлов.
 *
 * Отличия от прежнего `BpmnEditor`:
 *  - внешний XML синхронизируется: смена организации/роли действительно
 *    перерисовывает холст (раньше эффект с `[]` читал устаревший `xml`);
 *  - собственные правки не приводят к повторному импорту (защита от «эха»
 *    через проп `xml`) и не сбрасывают зум/позицию холста;
 *  - правки транслируются наружу через `onChange` с дебаунсом
 *    `XML_CHANGE_DEBOUNCE_MS`, а не по каждому пикселю перемещения;
 *  - список узлов инспектора берётся из живого `elementRegistry`.
 *
 * @param {Object} props
 * @param {string} props.xml текущая схема (внешний источник правды).
 * @param {(xml: string) => void} [props.onChange] схема изменилась.
 * @param {number|string} [props.height=420] высота холста.
 * @param {boolean} [props.showInspector=true] показывать инспектор узлов.
 * @param {string[]} [props.roleOptions=[]] роли для выбора в инспекторе.
 * @param {boolean} [props.fitOnImport=true] вписывать схему при импорте.
 * @param {string} [props.className] дополнительные CSS-классы.
 * @param {Object} [props.style] дополнительные inline-стили контейнера.
 * @param {(viewer: Object) => void} [props.onReady] моделлер готов.
 * @param {(loading: boolean) => void} [props.onLoading] старт/окончание импорта.
 * @param {(error: Error) => void} [props.onError] ошибка импорта/сохранения.
 */
export function BpmnEditor({
  xml,
  onChange,
  height = 420,
  showInspector = true,
  roleOptions = [],
  fitOnImport = true,
  className = '',
  style,
  onReady,
  onLoading,
  onError,
}) {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);
  /** XML, лежащий сейчас на холсте (`null`, если были правки). */
  const canvasXmlRef = useRef(null);
  /** Последний XML, отданный наружу через `onChange`. */
  const emittedXmlRef = useRef(null);
  const saveTimerRef = useRef(null);
  const importingRef = useRef(false);

  const [elements, setElements] = useState([]);
  const [selectedElementId, setSelectedElementId] = useState(null);

  const callbacksRef = useRef({ onChange, onReady, onLoading, onError });
  useEffect(() => {
    callbacksRef.current = { onChange, onReady, onLoading, onError };
  }, [onChange, onReady, onLoading, onError]);

  /** Пересобирает плоский список узлов из живого реестра моделлера. */
  const refreshElements = useCallback((modeler) => {
    const registry = modeler.get('elementRegistry');

    setElements(
      registry
        .getAll()
        .filter((element) => isFlowElementType(element.type))
        .map((element) => ({
          id: element.id,
          name: element.businessObject && element.businessObject.name
            ? element.businessObject.name
            : '',
          type: element.type,
          role: roleOfBusinessObject(element.businessObject),
        }))
    );
  }, []);

  /** Дебаунс: сохраняет схему и отдаёт её наружу после паузы в правках. */
  const scheduleEmit = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;

      const modeler = modelerRef.current;
      if (!modeler) return;

      modeler
        .saveXML({ format: true })
        .then(({ xml: saved }) => {
          if (saved === canvasXmlRef.current) return;

          canvasXmlRef.current = saved;
          emittedXmlRef.current = saved;

          if (typeof callbacksRef.current.onChange === 'function') {
            callbacksRef.current.onChange(saved);
          }
        })
        .catch((error) => {
          if (typeof callbacksRef.current.onError === 'function') {
            callbacksRef.current.onError(error);
          }
        });
    }, XML_CHANGE_DEBOUNCE_MS);
  }, []);

  // Моделлер создаётся один раз за время жизни компонента.
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const modeler = new Modeler({ container: containerRef.current });
    modelerRef.current = modeler;

    const handleChanged = () => {
      // Правки, порождённые импортом схемы, наружу не транслируем.
      if (importingRef.current) return;

      canvasXmlRef.current = null;
      refreshElements(modeler);
      scheduleEmit();
    };

    // `CommandStack` не является `EventBus` (diagram-js >= 14), у него нет
    // `on`/`off`: свои события он отправляет шине диаграммы как
    // `commandStack.changed` (см. `CommandStack.prototype._fire`).
    const eventBus = modeler.get('eventBus');
    eventBus.on('commandStack.changed', handleChanged);

    if (typeof callbacksRef.current.onReady === 'function') {
      callbacksRef.current.onReady(modeler);
    }

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      eventBus.off('commandStack.changed', handleChanged);
      canvasXmlRef.current = null;
      emittedXmlRef.current = null;
      modelerRef.current = null;
      modeler.destroy();
    };
  }, [refreshElements, scheduleEmit]);

  // Импорт внешнего XML: только если холст действительно устарел.
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || !xml) return undefined;

    // На холсте уже эта схема.
    if (xml === canvasXmlRef.current) return undefined;

    // Эхо собственного сохранения — импортировать не нужно.
    if (xml === emittedXmlRef.current) {
      canvasXmlRef.current = xml;
      return undefined;
    }

    let cancelled = false;
    importingRef.current = true;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (typeof callbacksRef.current.onLoading === 'function') {
      callbacksRef.current.onLoading(true);
    }

    modeler
      .importXML(xml)
      .then(() => {
        if (cancelled) return;

        importingRef.current = false;
        canvasXmlRef.current = xml;

        if (fitOnImport) modeler.get('canvas').zoom('fit-viewport');
        refreshElements(modeler);

        if (typeof callbacksRef.current.onLoading === 'function') {
          callbacksRef.current.onLoading(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;

        importingRef.current = false;
        canvasXmlRef.current = null;

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
  }, [xml, fitOnImport, refreshElements]);

  /** Переименование узла: `element_id`, которым движок адресует токены. */
  const handleChangeId = useCallback((oldId, newId) => {
    const modeler = modelerRef.current;
    if (!modeler || !isValidElementId(newId)) return false;

    const registry = modeler.get('elementRegistry');
    if (registry.get(newId)) return false;

    const element = registry.get(oldId);
    if (!element) return false;

    try {
      modeler.get('modeling').updateProperties(element, { id: newId });
    } catch (e) {
      return false;
    }

    setSelectedElementId(newId);
    return true;
  }, []);

  /** Изменение названия узла (отображается на схеме). */
  const handleChangeName = useCallback((elementId, name) => {
    const modeler = modelerRef.current;
    if (!modeler) return false;

    const element = modeler.get('elementRegistry').get(elementId);
    if (!element) return false;

    try {
      modeler.get('modeling').updateProperties(element, { name });
    } catch (e) {
      return false;
    }

    return true;
  }, []);

  /**
   * Назначение роли исполнителя: `bpmn:potentialOwner` в `Activity#resources`.
   *
   * Пустая роль снимает назначение (`resources: []`). Элемент роли создаётся
   * без `id`: `renameElementId` переименовывает в схеме все `id`, и роль
   * «уехала» бы вместе с переименованным узлом.
   *
   * Правка идёт через `modeling.updateProperties`, поэтому попадает в
   * `commandStack`, транслируется наружу (дебаунс `XML_CHANGE_DEBOUNCE_MS`)
   * и переживает `saveXML` — то же, что и правки на холсте.
   */
  const handleChangeRole = useCallback((elementId, role) => {
    const modeler = modelerRef.current;
    if (!modeler) return false;
    if (role !== '' && !isValidRole(role)) return false;

    const element = modeler.get('elementRegistry').get(elementId);
    if (!element) return false;
    // `resourceRole` есть только у Activity: у события или шлюза моддл
    // не признаёт `bpmn:potentialOwner` и потеряет его при `saveXML`.
    if (!isActivityType(element.type)) return false;

    try {
      const resources = role
        ? [modeler.get('moddle').create(POTENTIAL_OWNER_TYPE, { name: role })]
        : [];

      modeler.get('modeling').updateProperties(element, { resources });
    } catch (e) {
      return false;
    }

    return true;
  }, []);

  return (
    <div
      className={['bpmn-sdk-editor', className].filter(Boolean).join(' ')}
      style={style}
    >
      <div
        className="bpmn-sdk bpmn-sdk--editor"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        <div ref={containerRef} className="bpmn-sdk__canvas" />
      </div>

      {showInspector && (
        <EnginePanel
          elements={elements}
          selectedElementId={selectedElementId}
          onSelect={setSelectedElementId}
          onChangeId={handleChangeId}
          onChangeName={handleChangeName}
          roleOptions={roleOptions}
          onChangeRole={handleChangeRole}
        />
      )}
    </div>
  );
}
