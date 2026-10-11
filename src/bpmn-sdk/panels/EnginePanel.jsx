import React, { useEffect, useId, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';

import {
  getElementRole,
  getElementTrigger,
  isActivityType,
  isIdAvailableAmong,
  isTriggerHostType,
  isValidElementId,
  isValidInstancePrefix,
  isValidPayloadKeys,
  listFlowElements,
} from '../xml/bpmnXml';
import { EMPTY_TRIGGER, TRIGGER_FIELDS } from '../xml/triggerModdle';
import { INSTANCE_PREFIX } from '../constants';
import '../styles/bpmn-sdk.css';

/** Подсказка о допустимых идентификаторах (совпадает с `ELEMENT_ID_PATTERN`). */
export const ELEMENT_ID_HINT =
  'Идентификатор должен начинаться с буквы или «_» и содержать только буквы, цифры, «_», «-», «.».';

/** Текст ошибки для недопустимого идентификатора. */
export const ELEMENT_ID_FORMAT_ERROR = `Недопустимый идентификатор. ${ELEMENT_ID_HINT}`;

/** Значение выпадающего списка «роль не назначена». */
export const NO_ROLE_OPTION = '';

/**
 * Роль исполнителя узла.
 *
 * Приоритет у значения из `elements` (живой реестр редактора: он знает
 * про правки, ещё не отданные наружу). Если поля нет — роль читается из
 * самого XML (`bpmn:potentialOwner`).
 *
 * @param {Object} element узел списка (`{id, name, type, role?}`).
 * @param {string} [xml] схема-источник, если роль не пришла из реестра.
 * @returns {string} роль либо `''`.
 */
export function resolveElementRole(element, xml) {
  if (!element) return '';
  if (typeof element.role === 'string') return element.role;

  return getElementRole(xml, element.id);
}

/**
 * Триггер кросс-процессного запуска узла.
 *
 * Приоритет, как и у роли, у значения из `elements` (живой реестр редактора).
 * Если поля нет — триггер читается из самого XML (`trg:processTrigger`).
 *
 * @param {Object} element узел списка (`{id, name, type, trigger?}`).
 * @param {string} [xml] схема-источник, если триггер не пришёл из реестра.
 * @returns {Object|null} триггер с полями `TRIGGER_FIELDS` либо `null`.
 */
export function resolveElementTrigger(element, xml) {
  if (!element) return null;
  if (element.trigger && typeof element.trigger === 'object') return element.trigger;

  return getElementTrigger(xml, element.id);
}

/**
 * Сериализует триггер для сравнения черновика с источником правды.
 *
 * Объект триггера пересобирается на каждом рендере, поэтому в зависимостях
 * эффекта должно стоять значение (строка), а не ссылка на объект.
 *
 * @param {Object|null} trigger триггер.
 * @returns {string} ключ сравнения (`''` для «триггера нет»).
 */
export function triggerKey(trigger) {
  if (!trigger) return '';

  return TRIGGER_FIELDS.map((name) => String(trigger[name] == null ? '' : trigger[name])).join('\u0000');
}

/** Сообщения об ошибках полей триггера. */
export const TRIGGER_FIELD_ERRORS = {
  targetProcessId: 'Недопустимый идентификатор процесса (ожидается bpmn:process/@id).',
  instancePrefix: 'Недопустимый префикс экземпляра: допустимы буквы, цифры, «_», «-», «.».',
  startElementId: `Недопустимый узел-источник. ${ELEMENT_ID_HINT}`,
  firstElementId: `Недопустимый первый узел целевого процесса. ${ELEMENT_ID_HINT}`,
  payloadKeys: 'Ключи payload перечисляются через запятую и должны быть именами полей.',
};

/**
 * Проверяет одно поле триггера.
 *
 * @param {string} field имя поля (`TRIGGER_FIELDS`).
 * @param {string} value значение из формы.
 * @returns {string} сообщение об ошибке либо `''`, если поле допустимо.
 */
export function triggerFieldError(field, value) {
  const text = value == null ? '' : String(value);
  const empty = text.trim() === '';

  switch (field) {
    case 'targetProcessId':
      return isValidElementId(text.trim()) ? '' : TRIGGER_FIELD_ERRORS.targetProcessId;
    case 'instancePrefix':
      return isValidInstancePrefix(text.trim()) ? '' : TRIGGER_FIELD_ERRORS.instancePrefix;
    case 'startElementId':
      return empty || isValidElementId(text.trim()) ? '' : TRIGGER_FIELD_ERRORS.startElementId;
    case 'firstElementId':
      return empty || isValidElementId(text.trim()) ? '' : TRIGGER_FIELD_ERRORS.firstElementId;
    case 'payloadKeys':
      return isValidPayloadKeys(text) ? '' : TRIGGER_FIELD_ERRORS.payloadKeys;
    default:
      return '';
  }
}

/**
 * Поле формы триггера запуска.
 *
 * Все поля триггера — строки, поэтому поле одно: при добавлении поля в
 * `TRIGGER_FIELDS` форма не разрастается. `options` рисуются как `datalist`,
 * то есть подсказывают идентификаторы процессов, но не мешают ввести свой
 * (схема может ссылаться на процесс, которого нет в текущем списке).
 *
 * @param {Object} props
 * @param {string} props.id идентификатор поля (`label`/`input`/`datalist`).
 * @param {string} props.label подпись поля.
 * @param {string} props.value значение из черновика.
 * @param {boolean} props.disabled только чтение.
 * @param {boolean} props.invalid значение отклонено (подсветка).
 * @param {string} props.placeholder подсказка-пример.
 * @param {string[]} [props.options=[]] подсказки-идентификаторы процессов.
 * @param {(value: string) => void} props.onChange новое значение.
 * @param {() => void} props.onBlur ввод завершён (откат незавершённого ввода).
 */
function TriggerField({
  id,
  label,
  value,
  disabled,
  invalid,
  placeholder,
  options = [],
  onChange,
  onBlur,
}) {
  const listId = `${id}-options`;
  const hasOptions = Array.isArray(options) && options.length > 0;

  return (
    <div className="bpmn-sdk-panel__field">
      <label className="bpmn-sdk-panel__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        list={hasOptions ? listId : undefined}
        disabled={disabled}
        value={value == null ? '' : value}
        placeholder={placeholder}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={[
          'bpmn-sdk-panel__control',
          'bpmn-sdk-panel__control--mono',
          invalid ? 'bpmn-sdk-panel__control--invalid' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {hasOptions ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

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
 * @param {string[]} [props.roleOptions=[]] роли для выбора (`USERS[].role`).
 * @param {(id: string, role: string) => (boolean|void)} [props.onChangeRole]
 *   назначение роли исполнителя; `false` или исключение => откат.
 * @param {string[]} [props.triggerTargets=[]] идентификаторы процессов,
 *   которые можно запускать из узла (`trg:processTrigger/@targetProcessId`).
 * @param {(id: string, trigger: (Object|null)) => (boolean|void)} [props.onChangeTrigger]
 *   запись или снятие триггера запуска (`null` — снять); `false` или исключение => откат.
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
  roleOptions = [],
  onChangeRole,
  triggerTargets = [],
  onChangeTrigger,
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
  const [draftRole, setDraftRole] = useState(NO_ROLE_OPTION);
  const [draftTrigger, setDraftTrigger] = useState({ ownerId: null, trigger: EMPTY_TRIGGER });
  const [errorMessage, setErrorMessage] = useState('');
  const [triggerError, setTriggerError] = useState('');

  /** Фактическая роль узла (источник правды для поля роли). */
  const actualRole = resolveElementRole(selectedElement, xml);

  /**
   * Фактический триггер узла (источник правды для полей триггера).
   *
   * Мемоизация нужна и по производительности: `getElementTrigger` разбирает
   * весь XML, а рендеров у панели много.
   */
  const actualTrigger = useMemo(
    () => resolveElementTrigger(selectedElement, xml),
    [selectedElement, xml]
  );

  /** Ключ значения триггера: черновик сравнивается со схемой по значению. */
  const actualTriggerId = triggerKey(actualTrigger);

  /** Ключ узла-владельца: при смене узла черновики сбрасываются. */
  const ownerKey = selectedElement ? selectedElement.id : '';

  // Роли для выпадающего списка: переданный набор плюс роль из схемы, если её
  // в наборе нет (в XML могла попасть роль, которой нет среди пользователей).
  const roleChoices = useMemo(() => {
    const options = (Array.isArray(roleOptions) ? roleOptions : []).filter(Boolean);

    return actualRole && !options.includes(actualRole) ? [...options, actualRole] : options;
  }, [roleOptions, actualRole]);

  // Синхронизация черновиков с источником правды. Именно этот эффект
  // выполняет откат: после неудачного переименования либо внешней замены
  // схемы поля возвращаются к фактическим значениям узла.
  useEffect(() => {
    setDraftId(selectedElement ? selectedElement.id : '');
    setDraftName(selectedElement ? selectedElement.name : '');
    setErrorMessage('');
  }, [selectedElement]);

  // Роль меняется и через внешний источник (правка схемы в другом месте),
  // поэтому поле роли синхронизируется отдельно — по самому значению роли.
  useEffect(() => {
    setDraftRole(actualRole);
  }, [actualRole]);

  // Триггер синхронизируется так же — по значению и по узлу-владельцу.
  // Сравнение по ключу (`triggerKey`) обязательно: черновик — объект, и без
  // сравнения каждое обновление состояния порождало бы новый рендер, то есть
  // петлю (владелец панели вполне может передавать список узлов новым массивом).
  useEffect(() => {
    setDraftTrigger((current) =>
      current.ownerId === ownerKey && triggerKey(current.trigger) === actualTriggerId
        ? current
        : { ownerId: ownerKey, trigger: actualTrigger || EMPTY_TRIGGER }
    );
    setTriggerError('');
  }, [ownerKey, actualTrigger, actualTriggerId]);

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

  /**
   * Назначение роли исполнителя.
   *
   * Откат как у идентификатора: если владелец схемы не применил правку
   * (`false` или исключение), поле возвращается к роли из схемы.
   */
  const handleRoleChange = (value) => {
    setDraftRole(value);
    if (!selectedElement || typeof onChangeRole !== 'function') return;

    let applied = true;
    try {
      applied = onChangeRole(selectedElement.id, value) !== false;
    } catch (e) {
      applied = false;
    }

    if (!applied) setDraftRole(actualRole);
  };

  /** Передаёт триггер владельцу схемы; при отказе возвращает поля к схеме. */
  const applyTrigger = (trigger) => {
    let applied = true;
    try {
      applied =
        typeof onChangeTrigger === 'function'
          ? onChangeTrigger(selectedElement.id, trigger) !== false
          : true;
    } catch (e) {
      applied = false;
    }

    if (!applied) {
      setTriggerError('Не удалось записать триггер — изменение отменено.');
      setDraftTrigger({ ownerId: ownerKey, trigger: actualTrigger || EMPTY_TRIGGER });
    }
  };

  /**
   * Правка поля триггера запуска.
   *
   * Пустое поле «Запускаемый процесс» снимает триггер целиком (`null`) и
   * обнуляет остальные поля. Недопустимое значение в схему не уходит: поле
   * подсвечивается, а черновик остаётся с введённым текстом, чтобы его можно
   * было поправить (тем же способом, что и недопустимый идентификатор узла).
   */
  const handleTriggerChange = (field, value) => {
    if (!selectedElement || typeof onChangeTrigger !== 'function') return;

    const next = { ...draftTrigger.trigger, [field]: value };
    setDraftTrigger({ ownerId: ownerKey, trigger: next });
    setTriggerError('');

    // Пустой «Запускаемый процесс» — это «триггера нет», а не ошибка поля.
    // Проверка идёт до `triggerFieldError`: иначе пустое обязательное поле
    // было бы признано недопустимым и снять разметку было бы нечем.
    if (field === 'targetProcessId' && String(value == null ? '' : value).trim() === '') {
      setDraftTrigger({ ownerId: ownerKey, trigger: EMPTY_TRIGGER });
      applyTrigger(null);
      return;
    }

    const fieldError = triggerFieldError(field, value);
    if (fieldError) {
      setTriggerError(fieldError);
      return;
    }

    // Остальные поля без «Запускаемый процесс» смысла не имеют: пока целевой
    // процесс не задан, триггер в схему не уходит.
    if (String(next.targetProcessId == null ? '' : next.targetProcessId).trim() === '') {
      setTriggerError(TRIGGER_FIELD_ERRORS.targetProcessId);
      return;
    }

    applyTrigger(next);
  };

  /**
   * Правка поля триггера с клавиатуры завершена.
   *
   * Незавершённый ввод откатывается к схеме, как у идентификатора узла:
   * триггер — это объект из нескольких полей, и «полупустое» состояние в схеме
   * не имеет смысла (`targetProcessId` обязателен).
   */
  const handleTriggerBlur = () => {
    if (!selectedElement) return;

    const actual = actualTrigger || EMPTY_TRIGGER;
    if (triggerKey(draftTrigger.trigger) !== triggerKey(actual)) {
      setDraftTrigger({ ownerId: ownerKey, trigger: actual });
      setTriggerError('');
    }
  };

  const idInvalid = Boolean(errorMessage);
  const idFieldDisabled = disabled || !selectedElement;

  // Роль по спецификации BPMN 2.0 есть только у Activity (`resourceRole`):
  // у события или шлюза `bpmn:potentialOwner` молча потеряется при сохранении
  // схемы в редакторе, поэтому поле роли там заблокировано.
  const roleSupported = Boolean(selectedElement && isActivityType(selectedElement.type));

  // Список ролей пуст (панель используют без набора ролей) и назначения нет —
  // выбирать нечего, поле показываем только для чтения.
  const roleFieldDisabled = idFieldDisabled || roleChoices.length === 0 || !roleSupported;

  // Триггер запуска: хостом может быть только узел потока (движок активирует
  // его токеном), и записывать триггер должен уметь владелец схемы.
  const triggerSupported = Boolean(selectedElement && isTriggerHostType(selectedElement.type));
  const triggerDisabled =
    idFieldDisabled || !triggerSupported || typeof onChangeTrigger !== 'function';

  /** Значения полей формы триггера (черновик, а не схема). */
  const trigger = draftTrigger.trigger;

  /** Подсказки-идентификаторы процессов для поля «Запускаемый процесс». */
  const triggerTargetChoices = useMemo(
    () =>
      (Array.isArray(triggerTargets) ? triggerTargets : [])
        .map((target) => String(target == null ? '' : target).trim())
        .filter(Boolean),
    [triggerTargets]
  );

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

        <div className="bpmn-sdk-panel__field">
          <label className="bpmn-sdk-panel__label" htmlFor={`${baseId}-role`}>
            Роль исполнителя (potentialOwner):
          </label>
          <select
            id={`${baseId}-role`}
            className="bpmn-sdk-panel__control"
            disabled={roleFieldDisabled}
            value={draftRole}
            onChange={(event) => handleRoleChange(event.target.value)}
          >
            <option value={NO_ROLE_OPTION}>-- Роль не назначена --</option>
            {roleChoices.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          {selectedElement && !roleSupported ? (
            <span className="bpmn-sdk-panel__hint">
              Роль назначается только задачам и подпроцессам: у событий и шлюзов нет
              <code>resourceRole</code> в BPMN 2.0.
            </span>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p className="bpmn-sdk-panel__error">{errorMessage}</p>
      ) : (
        <p className="bpmn-sdk-panel__hint">
          Идентификаторы узлов используются движком как <code>element_id</code> в событиях
          токенов и в авторизации шагов. Роль исполнителя хранится в самой схеме
          (<code>bpmn:potentialOwner</code>) и определяет, какой пользователь видит шаг
          в интерфейсе.
        </p>
      )}

      <div className="bpmn-sdk-panel__section">
        <h6 className="bpmn-sdk-panel__subtitle">
          Запуск другого процесса при активации узла (trg:processTrigger)
        </h6>

        <div className="bpmn-sdk-panel__grid">
          <TriggerField
            id={`${baseId}-trigger-target`}
            label="Запускаемый процесс (targetProcessId):"
            value={trigger.targetProcessId}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder="Process_Supplier"
            options={triggerTargetChoices}
            onChange={(value) => handleTriggerChange('targetProcessId', value)}
            onBlur={handleTriggerBlur}
          />

          <TriggerField
            id={`${baseId}-trigger-prefix`}
            label="Префикс экземпляра (instancePrefix):"
            value={trigger.instancePrefix}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder={INSTANCE_PREFIX.SUPPLIER}
            onChange={(value) => handleTriggerChange('instancePrefix', value)}
            onBlur={handleTriggerBlur}
          />

          <TriggerField
            id={`${baseId}-trigger-first`}
            label="Первый узел целевого процесса (firstElementId):"
            value={trigger.firstElementId}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder="Task_SupplierCreateDocs"
            onChange={(value) => handleTriggerChange('firstElementId', value)}
            onBlur={handleTriggerBlur}
          />

          <TriggerField
            id={`${baseId}-trigger-start`}
            label="Узел-источник (startElementId):"
            value={trigger.startElementId}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder={ownerKey || 'Task_ExecutiveApprove'}
            onChange={(value) => handleTriggerChange('startElementId', value)}
            onBlur={handleTriggerBlur}
          />

          <TriggerField
            id={`${baseId}-trigger-payload`}
            label="Ключи payload через запятую (payloadKeys):"
            value={trigger.payloadKeys}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder="orderNum,volume"
            onChange={(value) => handleTriggerChange('payloadKeys', value)}
            onBlur={handleTriggerBlur}
          />
        </div>

        {triggerError ? (
          <p className="bpmn-sdk-panel__error">{triggerError}</p>
        ) : (
          <p className="bpmn-sdk-panel__hint">
            {selectedElement && !triggerSupported
              ? 'Триггер запуска ставится только на узлы потока: последовательный поток движок токеном не активирует.'
              : 'Когда токен активирует узел, движок стартует экземпляр процесса из «Запускаемый процесс»: узлы «Первый узел» и «Узел-источник» задают, с какого шага начать и по какому шагу считать источник, а «Ключи payload» — какие поля контекста передать. Пустое поле «Запускаемый процесс» снимает триггер.'}
          </p>
        )}
      </div>
    </div>
  );
}
