import React, { useCallback, useEffect, useRef, useState } from 'react';
import Modeler from 'bpmn-js/lib/Modeler';

import { installDiagramJsCompat } from '../compat/diagramJsCompat';
import { XML_CHANGE_DEBOUNCE_MS } from '../constants';
import {
  POTENTIAL_OWNER_TYPE,
  isActionHostType,
  isActivityType,
  isFlowElementType,
  isTriggerHostType,
  isValidAction,
  isValidElementId,
  isValidRole,
  isValidTrigger,
  normalizeAction,
  normalizeTrigger,
} from '../xml/bpmnXml';
import {
  TRIGGER_FIELDS,
  TRIGGER_MODELE_EXTENSIONS,
  TRIGGER_TYPE,
} from '../xml/triggerModdle';
import {
  ACTION_FIELDS,
  ACTION_MODELE_EXTENSIONS,
  ACTION_TYPE,
} from '../xml/actionModdle';
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
 * Триггер кросс-процессного запуска из бизнес-объекта узла.
 *
 * Триггер — собственный тип (`trg:ProcessTrigger`), поэтому он читается из
 * `extensionElements.values` только при зарегистрированном
 * `TRIGGER_MODELE_EXTENSIONS`: без регистрации моделлер знает элемент лишь по
 * имени тега (`$type` — `trg:processTrigger`, а не `trg:ProcessTrigger`),
 * поэтому тип здесь не находится, а `moddle.create` в
 * `handleChangeTrigger` бросает `unknown type`.
 *
 * @param {Object} businessObject бизнес-объект элемента из `elementRegistry`.
 * @returns {Object|null} триггер ровно с полями `TRIGGER_FIELDS` либо `null`.
 */
function triggerOfBusinessObject(businessObject) {
  const extensionElements = businessObject && businessObject.extensionElements;
  const values = (extensionElements && extensionElements.values) || [];
  const found = Array.isArray(values)
    ? values.find((value) => value && value.$type === TRIGGER_TYPE)
    : null;

  if (!found) return null;

  return TRIGGER_FIELDS.reduce(
    (trigger, name) => ({
      ...trigger,
      [name]: found[name] == null ? '' : String(found[name]),
    }),
    {}
  );
}

/**
 * Кнопки участников из бизнес-объекта узла.
 *
 * Кнопки — собственный тип (`act:UserAction`), поэтому читаются из
 * `extensionElements.values` только при зарегистрированном
 * `ACTION_MODELE_EXTENSIONS` (та же ловушка, что у `trg:ProcessTrigger`).
 * Узел может объявлять несколько кнопок — порядок в XML сохраняется.
 *
 * @param {Object} businessObject бизнес-объект элемента из `elementRegistry`.
 * @returns {Array<object>} Кнопки ровно с полями `ACTION_FIELDS` (возможно, `[]`).
 */
function actionsOfBusinessObject(businessObject) {
  const extensionElements = businessObject && businessObject.extensionElements;
  const values = (extensionElements && extensionElements.values) || [];
  const found = Array.isArray(values)
    ? values.filter((value) => value && value.$type === ACTION_TYPE)
    : [];

  return found.map((value) =>
    ACTION_FIELDS.reduce(
      (action, name) => ({
        ...action,
        [name]: value[name] == null ? '' : String(value[name]),
      }),
      {}
    )
  );
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
 * @param {string[]} [props.triggerTargets=[]] процессы, которые можно запускать
 *   из узла (подсказки для поля `targetProcessId` инспектора).
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
  triggerTargets = [],
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
          trigger: triggerOfBusinessObject(element.businessObject),
          actions: actionsOfBusinessObject(element.businessObject),
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

    const modeler = new Modeler({
      container: containerRef.current,
      // Без регистрации `trg:processTrigger` и `act:userAction` моделлер не
      // знает собственные типы и теряет их при `saveXML` (та же ловушка, что и
      // с `camunda:*`).
      moddleExtensions: {
        ...TRIGGER_MODELE_EXTENSIONS,
        ...ACTION_MODELE_EXTENSIONS,
      },
    });
    modelerRef.current = modeler;

    // `bpmn-js` открывает меню «Change element» (гаечный ключ на контекстной
    // панели) через устаревший `ContextPad#getPad`, и `diagram-js` пишет из-за
    // этого предупреждение со стеком в консоль клиента. Подробности и рамки
    // заплаты — в `compat/diagramJsCompat.js`.
    installDiagramJsCompat(modeler);

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

  /**
   * Запись/снятие триггера кросс-процессного запуска.
   *
   * Триггер живёт в `extensionElements` узла, а не в его бизнес-объекте, поэтому
   * вся цепочка расширений пересобирается новым объектом (`bpmn:ExtensionElements`
   * + `trg:ProcessTrigger`): `modeling.updateProperties` пишет свойство узла, а
   * `UpdatePropertiesHandler` фиксирует правку по новому значению. Чужие
   * расширения узла (`camunda:*` и прочее) при этом сохраняются.
   *
   * `null` снимает триггер. Триггер ставится только на узлы потока: движок
   * активирует их токеном, а на `sequenceFlow` он никогда не сработает.
   *
   * @param {string} elementId идентификатор узла.
   * @param {Object|null} trigger триггер (`TRIGGER_FIELDS`) либо `null`.
   * @returns {boolean} правка принята (`false` => инспектор вернёт поля назад).
   */
  const handleChangeTrigger = useCallback((elementId, trigger) => {
    const modeler = modelerRef.current;
    if (!modeler) return false;
    if (trigger && !isValidTrigger(trigger)) return false;

    const element = modeler.get('elementRegistry').get(elementId);
    if (!element) return false;
    if (trigger && !isTriggerHostType(element.type)) return false;

    const moddle = modeler.get('moddle');
    const current =
      (element.businessObject.extensionElements &&
        element.businessObject.extensionElements.values) ||
      [];
    const kept = current.filter((value) => !value || value.$type !== TRIGGER_TYPE);

    const values = [...kept];
    if (trigger) {
      try {
        values.push(moddle.create(TRIGGER_TYPE, normalizeTrigger(trigger)));
      } catch (e) {
        return false;
      }
    }

    const extensionElements =
      values.length > 0
        ? moddle.create('bpmn:ExtensionElements', { values })
        : undefined;

    try {
      // `undefined`, а не пустой контейнер: иначе в схеме остаётся
      // `<bpmn:extensionElements />` — след снятого триггера.
      modeler.get('modeling').updateProperties(element, { extensionElements });
    } catch (e) {
      return false;
    }

    return true;
  }, []);

  /**
   * Запись/снятие кнопок участников (`act:userAction`).
   *
   * Механика та же, что у триггера: расширения узла пересобираются новым
   * объектом `bpmn:ExtensionElements`, в котором остаются все прочие
   * расширения (`trg:processTrigger`, `camunda:*`). Кнопок у узла может быть
   * несколько, поэтому список пишется целиком: `[]` снимает их и, если других
   * расширений нет, убирает контейнер.
   *
   * @param {string} elementId идентификатор узла.
   * @param {Array<object>} actions кнопки (`ACTION_FIELDS`); `[]` — снять.
   * @returns {boolean} правка принята (`false` => инспектор вернёт поля назад).
   */
  const handleChangeActions = useCallback((elementId, actions) => {
    const modeler = modelerRef.current;
    if (!modeler) return false;

    const list = (Array.isArray(actions) ? actions : []).filter(
      (action) => action && typeof action === 'object'
    );
    if (list.some((action) => !isValidAction(action))) return false;

    const element = modeler.get('elementRegistry').get(elementId);
    if (!element) return false;
    if (list.length > 0 && !isActionHostType(element.type)) return false;

    const moddle = modeler.get('moddle');
    const current =
      (element.businessObject.extensionElements &&
        element.businessObject.extensionElements.values) ||
      [];
    const kept = current.filter((value) => !value || value.$type !== ACTION_TYPE);

    let values = [...kept];
    if (list.length > 0) {
      try {
        values = [
          ...kept,
          ...list.map((action) => moddle.create(ACTION_TYPE, normalizeAction(action))),
        ];
      } catch (e) {
        return false;
      }
    }

    const extensionElements =
      values.length > 0
        ? moddle.create('bpmn:ExtensionElements', { values })
        : undefined;

    try {
      modeler.get('modeling').updateProperties(element, { extensionElements });
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
          triggerTargets={triggerTargets}
          onChangeTrigger={handleChangeTrigger}
          onChangeActions={handleChangeActions}
        />
      )}
    </div>
  );
}
