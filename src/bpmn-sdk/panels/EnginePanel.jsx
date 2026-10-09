import React, { useEffect, useId, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';

import { isIdAvailableAmong, isValidElementId, listFlowElements } from '../xml/bpmnXml';
import '../styles/bpmn-sdk.css';

/** Подсказка о допустимых идентификаторах (совпадает с `ELEMENT_ID_PATTERN`). */
export const ELEMENT_ID_HINT =
  'Идентификатор должен начинаться с буквы или «_» и содержать только буквы, цифры, «_», «-», «.».';

/** Текст ошибки для недопустимого идентификатора. */
export const ELEMENT_ID_FORMAT_ERROR = `Недопустимый идентификатор. ${ELEMENT_ID_HINT}`;

/**
 * Инспектор узлов схемы: выбор узла и правка его идентификатора/названия.
 *
 * Идентификатор узла — это тот самый `element_id`, которым движок адресует
 * токены в событиях (`mes.bpmn.v1.event.*`), поэтому он проверяется на
 * соответствие шаблону и на уникальность до передачи в модель.
 * Неудачное изменение откатывается: поле возвращается к фактическому
 * значению узла, пользователю показывается причина.
 *
 * Компонент не зависит от `bpmn-js` — он работает с плоским списком узлов.
 *
 * @param {Object} props
 * @param {Array<{id: string, name: string, type: string}>} [props.elements]
 *   узлы схемы (например, из `listFlowElements` или живого `elementRegistry`).
 * @param {string} [props.xml] схема-источник списка, если `elements` не передан.
 * @param {string|null} [props.selectedElementId] выбранный узел.
 * @param {(id: string|null) => void} [props.onSelect] выбор узла.
 * @param {(oldId: string, newId: string) => (boolean|void)} [props.onChangeId]
 *   применение нового идентификатора; `false` или исключение => откат.
 * @param {(id: string, name: string) => void} [props.onChangeName] новое название.
 * @param {boolean} [props.disabled=false] только чтение.
 * @param {string} [props.title] заголовок панели.
 * @param {string} [props.className] дополнительные CSS-классы.
 */
export function EnginePanel({
  elements,
  xml,
  selectedElementId = null,
  onSelect,
  onChangeId,
  onChangeName,
  disabled = false,
  title = 'Инспектор узла (GUI настройки идентификатора и параметров)',
  className = '',
}) {
  const baseId = useId();

  const flowElements = useMemo(
    () => (Array.isArray(elements) ? elements : listFlowElements(xml)),
    [elements, xml]
  );

  const selectedElement = useMemo(
    () => flowElements.find((element) => element.id === selectedElementId) || null,
    [flowElements, selectedElementId]
  );

  const [draftId, setDraftId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Синхронизация черновиков с источником правды. Именно этот эффект
  // выполняет откат: после неудачного переименования либо внешней замены
  // схемы поля возвращаются к фактическим значениям узла.
  useEffect(() => {
    setDraftId(selectedElement ? selectedElement.id : '');
    setDraftName(selectedElement ? selectedElement.name : '');
    setErrorMessage('');
  }, [selectedElement]);

  // Узел исчез из схемы (например, загружена другая версия) — снимаем выбор.
  useEffect(() => {
    if (selectedElementId && flowElements.length > 0 && !selectedElement) {
      if (typeof onSelect === 'function') onSelect(null);
    }
  }, [selectedElementId, selectedElement, flowElements.length, onSelect]);

  const existingIds = useMemo(
    () => flowElements.map((element) => element.id),
    [flowElements]
  );

  const handleSelect = (event) => {
    if (typeof onSelect === 'function') onSelect(event.target.value || null);
  };

  const handleIdChange = (value) => {
    setDraftId(value);
    if (!selectedElement) return;

    if (value === selectedElement.id) {
      setErrorMessage('');
      return;
    }

    if (!isValidElementId(value)) {
      setErrorMessage(ELEMENT_ID_FORMAT_ERROR);
      return;
    }

    if (!isIdAvailableAmong(existingIds, value)) {
      setErrorMessage(`Идентификатор «${value}» уже занят в схеме.`);
      return;
    }

    setErrorMessage('');

    let applied = true;
    try {
      applied =
        typeof onChangeId === 'function'
          ? onChangeId(selectedElement.id, value) !== false
          : true;
    } catch (e) {
      applied = false;
    }

    if (!applied) {
      setErrorMessage('Не удалось переименовать узел — изменение отменено.');
      setDraftId(selectedElement.id);
    }
  };

  /** Откат незавершённого ввода к фактическому значению узла. */
  const handleIdBlur = () => {
    if (selectedElement && draftId !== selectedElement.id) {
      setDraftId(selectedElement.id);
      setErrorMessage('');
    }
  };

  const handleNameChange = (value) => {
    setDraftName(value);
    if (!selectedElement) return;
    if (typeof onChangeName === 'function') onChangeName(selectedElement.id, value);
  };

  const idInvalid = Boolean(errorMessage);
  const idFieldDisabled = disabled || !selectedElement;

  return (
    <div className={['bpmn-sdk-panel', className].filter(Boolean).join(' ')}>
      <h5 className="bpmn-sdk-panel__title">
        <Settings size={14} color="#2563eb" /> {title}
      </h5>

      <div className="bpmn-sdk-panel__grid">
        <div className="bpmn-sdk-panel__field">
          <label className="bpmn-sdk-panel__label" htmlFor={`${baseId}-select`}>
            Выбрать узел на схеме:
          </label>
          <select
            id={`${baseId}-select`}
            className="bpmn-sdk-panel__control"
            disabled={disabled}
            value={selectedElementId || ''}
            onChange={handleSelect}
          >
            <option value="">-- Выберите узел для настройки --</option>
            {flowElements.map((element) => (
              <option key={element.id} value={element.id}>
                {element.name ? `${element.name} [${element.id}]` : element.id}
              </option>
            ))}
          </select>
        </div>

        <div className="bpmn-sdk-panel__field">
          <label
            className="bpmn-sdk-panel__label bpmn-sdk-panel__label--strong"
            htmlFor={`${baseId}-element-id`}
          >
            Идентификатор узла (element_id):
          </label>
          <input
            id={`${baseId}-element-id`}
            type="text"
            disabled={idFieldDisabled}
            value={draftId}
            onChange={(event) => handleIdChange(event.target.value)}
            onBlur={handleIdBlur}
            placeholder="Task_ExecutiveApprove"
            aria-invalid={idInvalid}
            className={[
              'bpmn-sdk-panel__control',
              'bpmn-sdk-panel__control--mono',
              idInvalid ? 'bpmn-sdk-panel__control--invalid' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        </div>

        <div className="bpmn-sdk-panel__field">
          <label className="bpmn-sdk-panel__label" htmlFor={`${baseId}-name`}>
            Название задачи / события:
          </label>
          <input
            id={`${baseId}-name`}
            type="text"
            disabled={idFieldDisabled}
            value={draftName}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder="Согласовать заказ"
            className="bpmn-sdk-panel__control"
          />
        </div>
      </div>

      {errorMessage ? (
        <p className="bpmn-sdk-panel__error">{errorMessage}</p>
      ) : (
        <p className="bpmn-sdk-panel__hint">
          Идентификаторы узлов используются движком как <code>element_id</code> в событиях
          токенов и в авторизации шагов.
        </p>
      )}
    </div>
  );
}
