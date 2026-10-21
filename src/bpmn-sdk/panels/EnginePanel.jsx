import React, { useEffect, useId, useMemo, useState } from 'react';
import { Settings } from 'lucide-react';

import {
  ACTION_ICON_PATTERN,
  DEFAULT_ACTION_EVENT,
  getElementActions,
  getElementRole,
  getElementTrigger,
  getNextElementId,
  isActionHostType,
  isActivityType,
  isIdAvailableAmong,
  isTriggerHostType,
  isValidAction,
  isValidElementId,
  isValidInstancePrefix,
  isValidPayloadKeys,
  isValidRole,
  listFlowElements,
} from '../xml/bpmnXml';
import { EMPTY_ACTION, ACTION_FIELDS } from '../xml/actionModdle';
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
 * Кнопки участников узла.
 *
 * Приоритет, как и у роли с триггером, у значения из `elements` (живой реестр
 * редактора). Если поля нет — кнопки читаются из самого XML (`act:userAction`).
 *
 * @param {Object} element узел списка (`{id, name, type, actions?}`).
 * @param {string} [xml] схема-источник, если кнопки не пришли из реестра.
 * @returns {Array<object>} кнопки с полями `ACTION_FIELDS` (возможно, `[]`).
 */
export function resolveElementActions(element, xml) {
  if (!element) return [];
  if (Array.isArray(element.actions)) return element.actions;

  return getElementActions(xml, element.id);
}

/**
 * Сериализует список кнопок для сравнения черновика с источником правды.
 *
 * Список пересобирается на каждом рендере, поэтому в зависимостях эффекта
 * должно стоять значение (строка), а не ссылка на массив.
 *
 * @param {Array<object>} actions кнопки узла.
 * @returns {string} ключ сравнения (`''` для «кнопок нет»).
 */
export function actionsKey(actions) {
  if (!Array.isArray(actions)) return '';

  return actions
    .map((action) =>
      ACTION_FIELDS.map((name) => String((action && action[name]) == null ? '' : action[name])).join(
        '\u0000'
      )
    )
    .join('\u0001');
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

/** Сообщения об ошибках полей кнопки участника. */
export const ACTION_FIELD_ERRORS = {
  id: `Недопустимый ключ кнопки. ${ELEMENT_ID_HINT}`,
  label: 'У кнопки должна быть надпись — её видит участник в кабинете.',
  role: 'Недопустимая роль участника: допустимы буквы, цифры, «_», «-», «.».',
  icon: 'Имя иконки — одно слово латиницей без пробелов (например, Truck).',
  event: `Недопустимое событие кнопки. Пусто — «шаг выполнен» (${DEFAULT_ACTION_EVENT}). ${ELEMENT_ID_HINT}`,
  elementId: `Недопустимый узел, на который встанет токен. Пусто — следующий блок по связи. ${ELEMENT_ID_HINT}`,
  counterpartEvent: `Недопустимое событие второй стороны. ${ELEMENT_ID_HINT}`,
  counterpartElementId: `Недопустимый узел второй стороны. ${ELEMENT_ID_HINT}`,
  startsProcess: 'Недопустимый запускаемый процесс (ожидается bpmn:process/@id).',
};

/**
 * Кнопка не уходит в схему: не заполнено то, что схема вывести не может.
 *
 * Обязательны ключ и надпись — по ключу клиент находит кнопку, надпись видит
 * участник. Событие и узел — не ошибка: пустые поля означают умолчания схемы
 * («шаг выполнен» — `CompleteBlock` и следующий блок по единственной исходящей
 * связи), их подставляет `resolveAction` в момент нажатия.
 */
export const ACTION_INCOMPLETE_ERROR =
  'Кнопка ещё не записана в схему: нужны ключ (id) и надпись (label). Событие и узел заполнять не обязательно — пустые поля читаются как «шаг выполнен» (CompleteBlock и следующий блок по связи).';

/**
 * Проверяет одно поле кнопки.
 *
 * @param {string} field имя поля (`ACTION_FIELDS`).
 * @param {string} value значение из формы.
 * @returns {string} сообщение об ошибке либо `''`, если поле допустимо.
 */
export function actionFieldError(field, value) {
  const text = value == null ? '' : String(value);
  const trimmed = text.trim();
  const empty = trimmed === '';

  switch (field) {
    case 'id':
      return isValidElementId(trimmed) ? '' : ACTION_FIELD_ERRORS.id;
    case 'label':
      return empty ? ACTION_FIELD_ERRORS.label : '';
    case 'role':
      return empty || isValidRole(trimmed) ? '' : ACTION_FIELD_ERRORS.role;
    case 'icon':
      return empty || ACTION_ICON_PATTERN.test(trimmed) ? '' : ACTION_FIELD_ERRORS.icon;
    case 'event':
      return empty || isValidElementId(trimmed) ? '' : ACTION_FIELD_ERRORS.event;
    case 'elementId':
      return empty || isValidElementId(trimmed) ? '' : ACTION_FIELD_ERRORS.elementId;
    case 'counterpartEvent':
      return empty || isValidElementId(trimmed) ? '' : ACTION_FIELD_ERRORS.counterpartEvent;
    case 'counterpartElementId':
      return empty || isValidElementId(trimmed) ? '' : ACTION_FIELD_ERRORS.counterpartElementId;
    case 'startsProcess':
      return empty || isValidElementId(trimmed) ? '' : ACTION_FIELD_ERRORS.startsProcess;
    default:
      return '';
  }
}

/**
 * Свободный ключ для новой кнопки (`action1`, `action2`, ...).
 *
 * Ключ кнопки — это `element_id`-подобное имя: он попадает в XML-атрибут, и
 * клиент сопоставляет по нему кнопку из схемы с вычисляемым payload.
 *
 * @param {Array<object>} actions уже объявленные кнопки узла.
 * @returns {string} ключ, которого нет среди существующих.
 */
export function nextActionId(actions) {
  const used = new Set(
    (Array.isArray(actions) ? actions : []).map((action) =>
      String(action && action.id ? action.id : '')
    )
  );

  let index = 1;
  while (used.has('action' + index)) index += 1;

  return 'action' + index;
}

/**
 * Поле формы с подсказками.
 *
 * Все поля расширений (триггер, кнопки) — строки, поэтому поле одно:
 * при добавлении поля в `TRIGGER_FIELDS`/`ACTION_FIELDS` форма не разрастается.
 * `options` рисуются как `datalist`, то есть подсказывают идентификаторы, но не
 * мешают ввести свой (схема может ссылаться на процесс или узел, которого нет в
 * текущем списке).
 *
 * @param {Object} props
 * @param {string} props.id идентификатор поля (`label`/`input`/`datalist`).
 * @param {string} props.label подпись поля.
 * @param {string} props.value значение из черновика.
 * @param {boolean} props.disabled только чтение.
 * @param {boolean} props.invalid значение отклонено (подсветка).
 * @param {string} props.placeholder подсказка-пример.
 * @param {string[]} [props.options=[]] подсказки-значения.
 * @param {(value: string) => void} props.onChange новое значение.
 * @param {() => void} props.onBlur ввод завершён (откат незавершённого ввода).
 */
function OptionField({
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
 * Поля формы кнопки участника в порядке `ACTION_FIELDS`.
 *
 * Форма не разрастается при добавлении поля в `ACTION_FIELDS`: поля описаны
 * данными, а подсказки-значения (`optionsKey`) берутся из контекста панели —
 * роли пользователей, идентификаторы узлов схемы, процессы второй стороны.
 *
 * Поля, у которых схема выводит значение сама (`event`, `elementId`), помечены в
 * подписи: пустое поле — это не «дырка» в кнопке, а умолчание. Подпись поля
 * `elementId` подсказывает и сам узел, если он выводится из схемы (см.
 * `nextElementId`).
 */
const ACTION_FORM_FIELDS = [
  { name: 'id', label: 'Ключ кнопки (id):', placeholder: 'sendToSupplier' },
  { name: 'label', label: 'Надпись на кнопке (label):', placeholder: 'Отправить заказ' },
  { name: 'role', label: 'Роль участника (role):', placeholder: 'MANAGER', optionsKey: 'roles' },
  { name: 'icon', label: 'Иконка (icon):', placeholder: 'Send' },
  {
    name: 'event',
    label: `Событие при нажатии (event), пусто — ${DEFAULT_ACTION_EVENT}:`,
    placeholder: DEFAULT_ACTION_EVENT,
  },
  {
    name: 'elementId',
    label: 'Узел после нажатия (elementId), пусто — следующий блок:',
    placeholder: 'Task_Next',
    optionsKey: 'elements',
  },
  {
    name: 'counterpartEvent',
    label: 'Событие второй стороны (counterpartEvent):',
    placeholder: 'SupplierShippedSignal',
  },
  {
    name: 'counterpartElementId',
    label: 'Узел второй стороны (counterpartElementId):',
    placeholder: 'Task_ReceiveDocsAndIssuePass',
    optionsKey: 'elements',
  },
  {
    name: 'startsProcess',
    label: 'Запускаемый процесс (startsProcess):',
    placeholder: 'Process_Supplier',
    optionsKey: 'processes',
  },
];

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
 * @param {Array<{id: string, name: string, type: string, actions?: Array<object>}>} [props.elements]
 *   узлы схемы (например, из `listFlowElements` или живого `elementRegistry`).
 * @param {string} [props.xml] схема-источник списка, если `elements` не передан.
 * @param {string|null} [props.selectedElementId] выбранный узел.
 * @param {(id: string|null) => void} [props.onSelect] выбор узла.
 * @param {(oldId: string, newId: string) => (boolean|void)} [props.onChangeId]
 *   применение нового идентификатора; `false` или исключение => откат.
 * @param {(id: string, name: string) => void} [props.onChangeName] новое название.
 * @param {string[]} [props.roleOptions=[]] роли для выбора: коды из `role:catalog`
 *   и назначений шагов (`bpmn:potentialOwner`, `act:userAction/@role`).
 * @param {(id: string, role: string) => (boolean|void)} [props.onChangeRole]
 *   назначение роли исполнителя; `false` или исключение => откат.
 * @param {string[]} [props.triggerTargets=[]] идентификаторы процессов,
 *   которые можно запускать из узла (`trg:processTrigger/@targetProcessId`).
 * @param {(id: string, trigger: (Object|null)) => (boolean|void)} [props.onChangeTrigger]
 *   запись или снятие триггера запуска (`null` — снять); `false` или исключение => откат.
 * @param {(id: string, actions: Array<object>) => (boolean|void)} [props.onChangeActions]
 *   запись кнопок участников узла (`act:userAction`); `[]` — снять все;
 *   `false` или исключение => откат.
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
  onChangeActions,
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
  const [draftActions, setDraftActions] = useState({ ownerId: null, actions: [] });
  const [errorMessage, setErrorMessage] = useState('');
  const [triggerError, setTriggerError] = useState('');
  const [actionError, setActionError] = useState('');

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

  /**
   * Фактические кнопки узла (источник правды для полей кнопок).
   *
   * Мемоизация, как и у триггера, нужна и по производительности: чтение из
   * XML разбирает всю схему, а рендеров у панели много.
   */
  const actualActions = useMemo(
    () => resolveElementActions(selectedElement, xml),
    [selectedElement, xml]
  );

  /** Ключ значения кнопок: черновик сравнивается со схемой по значению. */
  const actualActionsKey = actionsKey(actualActions);

  /**
   * Узел, который кнопка выберет по умолчанию.
   *
   * Пустое поле «Узел после нажатия» читается как «следующий блок по схеме»
   * (`getNextElementId` — цель единственной исходящей связи). Значение
   * показывается подсказкой в поле, чтобы «не заполнено» не выглядело как
   * потерянное поле. `''`, если схема-источник не передана (панель работает на
   * живом реестре редактора) или связь неоднозначна — тогда подсказка
   * статичная, а узел придётся указать руками.
   */
  const nextElementId = useMemo(
    () => (selectedElement ? getNextElementId(xml, selectedElement.id) : ''),
    [selectedElement, xml]
  );

  /** Подсказка-пример поля кнопки: у узла — вывод из схемы, у остальных — её своя. */
  const actionFieldPlaceholder = (field) =>
    field.name === 'elementId' && nextElementId !== '' ? nextElementId : field.placeholder;

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

  // Кнопки синхронизируются так же — по значению и по узлу-владельцу.
  useEffect(() => {
    setDraftActions((current) =>
      current.ownerId === ownerKey && actionsKey(current.actions) === actualActionsKey
        ? current
        : { ownerId: ownerKey, actions: actualActions }
    );
    setActionError('');
  }, [ownerKey, actualActions, actualActionsKey]);

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

  /** Передаёт кнопки владельцу схемы; при отказе возвращает поля к схеме. */
  const applyActions = (actions) => {
    let applied = true;
    try {
      applied =
        typeof onChangeActions === 'function'
          ? onChangeActions(selectedElement.id, actions) !== false
          : true;
    } catch (e) {
      applied = false;
    }

    if (!applied) {
      setActionError('Не удалось записать кнопки — изменение отменено.');
      setDraftActions({ ownerId: ownerKey, actions: actualActions });
    }

    return applied;
  };

  /**
   * Правка поля кнопки.
   *
   * В схему список уходит целиком, как только все кнопки списка допустимы: у
   * кнопки обязательны ключ и надпись, а событие и узел схема выводит сама
   * (пустые поля — это «шаг выполнен» и следующий блок по связи). Недопустимые
   * значения подсвечиваются, а черновик остаётся в форме — в отличие от
   * триггера, недописанная кнопка не откатывается, иначе набор новой кнопки
   * стирался бы на первом же уходе из поля.
   */
  const handleActionChange = (index, field, value) => {
    if (!selectedElement || typeof onChangeActions !== 'function') return;

    const next = draftActions.actions.map((action, position) =>
      position === index ? { ...action, [field]: value } : action
    );

    setDraftActions({ ownerId: ownerKey, actions: next });
    setActionError('');

    const fieldError = actionFieldError(field, value);
    if (fieldError) {
      setActionError(fieldError);
      return;
    }

    if (next.some((action) => !isValidAction(action))) {
      setActionError(ACTION_INCOMPLETE_ERROR);
      return;
    }

    applyActions(next);
  };

  /**
   * Добавляет кнопку.
   *
   * Кнопка уходит в схему сразу: ключ и надпись форма заполняет сама, а событие
   * и узел схема выводит из связей (пустые поля = «шаг выполнен» и следующий
   * блок). Отдельного «черновика, который ждёт заполнения», как у кнопки с
   * обязательными `event`/`elementId`, больше нет: список кнопок в форме и в
   * схеме совпадают — как и при правке поля.
   */
  const handleAddAction = () => {
    if (!selectedElement || typeof onChangeActions !== 'function') return;

    const next = [
      ...draftActions.actions,
      { ...EMPTY_ACTION, id: nextActionId(draftActions.actions), label: 'Новая кнопка' },
    ];

    setDraftActions({ ownerId: ownerKey, actions: next });
    setActionError('');

    if (next.some((action) => !isValidAction(action))) {
      setActionError(ACTION_INCOMPLETE_ERROR);
      return;
    }

    applyActions(next);
  };

  /** Удаляет кнопку узла и сразу пишет сокращённый список в схему. */
  const handleRemoveAction = (index) => {
    if (!selectedElement || typeof onChangeActions !== 'function') return;

    const next = draftActions.actions.filter((action, position) => position !== index);

    setDraftActions({ ownerId: ownerKey, actions: next });
    setActionError('');

    if (next.some((action) => !isValidAction(action))) {
      setActionError(ACTION_INCOMPLETE_ERROR);
      return;
    }

    applyActions(next);
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

  // Кнопки участников: хостом может быть только узел потока (движок активирует
  // его токеном), и записывать их должен уметь владелец схемы.
  const actionsSupported = Boolean(selectedElement && isActionHostType(selectedElement.type));
  const actionsDisabled =
    idFieldDisabled || !actionsSupported || typeof onChangeActions !== 'function';

  /** Значения полей формы кнопок (черновик, а не схема). */
  const actions = draftActions.actions;

  /** Подсказки-идентификаторы узлов схемы для полей «Узел после нажатия». */
  const elementIdChoices = useMemo(
    () => flowElements.map((element) => element.id).filter(Boolean),
    [flowElements]
  );

  /** Подсказки для поля кнопки по источнику (`optionsKey` в `ACTION_FORM_FIELDS`). */
  const actionFieldOptions = (optionsKey) => {
    if (optionsKey === 'roles') return roleChoices;
    if (optionsKey === 'elements') return elementIdChoices;
    if (optionsKey === 'processes') return triggerTargetChoices;

    return [];
  };

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
          <OptionField
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

          <OptionField
            id={`${baseId}-trigger-prefix`}
            label="Префикс экземпляра (instancePrefix):"
            value={trigger.instancePrefix}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder={INSTANCE_PREFIX.SUPPLIER}
            onChange={(value) => handleTriggerChange('instancePrefix', value)}
            onBlur={handleTriggerBlur}
          />

          <OptionField
            id={`${baseId}-trigger-first`}
            label="Первый узел целевого процесса (firstElementId):"
            value={trigger.firstElementId}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder="Task_SupplierCreateDocs"
            onChange={(value) => handleTriggerChange('firstElementId', value)}
            onBlur={handleTriggerBlur}
          />

          <OptionField
            id={`${baseId}-trigger-start`}
            label="Узел-источник (startElementId):"
            value={trigger.startElementId}
            disabled={triggerDisabled}
            invalid={Boolean(triggerError)}
            placeholder={ownerKey || 'Task_ExecutiveApprove'}
            onChange={(value) => handleTriggerChange('startElementId', value)}
            onBlur={handleTriggerBlur}
          />

          <OptionField
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

      <div className="bpmn-sdk-panel__section">
        <h6 className="bpmn-sdk-panel__subtitle">
          Кнопки участников на узле (act:userAction)
        </h6>

        {actions.length === 0 ? (
          <p className="bpmn-sdk-panel__hint">У узла нет кнопок участников.</p>
        ) : (
          actions.map((action, index) => (
            <div
              className="bpmn-sdk-panel__item"
              key={`${baseId}-action-${index}-${action.id || 'new'}`}
            >
              <div className="bpmn-sdk-panel__grid">
                {ACTION_FORM_FIELDS.map((field) => (
                  <OptionField
                    key={`${baseId}-action-${index}-${field.name}`}
                    id={`${baseId}-action-${index}-${field.name}`}
                    label={field.label}
                    value={action[field.name]}
                    disabled={actionsDisabled}
                    invalid={Boolean(actionFieldError(field.name, action[field.name]))}
                    placeholder={actionFieldPlaceholder(field)}
                    options={actionFieldOptions(field.optionsKey)}
                    onChange={(value) => handleActionChange(index, field.name, value)}
                  />
                ))}

                <div className="bpmn-sdk-panel__field">
                  <button
                    type="button"
                    className="bpmn-sdk-panel__button bpmn-sdk-panel__button--danger"
                    disabled={actionsDisabled}
                    onClick={() => handleRemoveAction(index)}
                  >
                    Удалить кнопку
                  </button>
                </div>
              </div>
            </div>
          ))
        )}

        <div className="bpmn-sdk-panel__field">
          <button
            type="button"
            className="bpmn-sdk-panel__button"
            disabled={actionsDisabled}
            onClick={handleAddAction}
          >
            Добавить кнопку
          </button>
        </div>

        {actionError ? (
          <p className="bpmn-sdk-panel__error">{actionError}</p>
        ) : (
          <p className="bpmn-sdk-panel__hint">
            {selectedElement && !actionsSupported
              ? 'Кнопка ставится только на узлы потока: последовательный поток движок токеном не активирует.'
              : `Кнопка описывает шаг участника: надпись и иконку рисует кабинет, «Событие» и «Узел после нажатия» уходят движку. Оба поля можно не заполнять: пустое «Событие» — это «шаг выполнен» (${DEFAULT_ACTION_EVENT}), пустой «Узел» — следующий блок по единственной исходящей связи (в развилке узел придётся указать — там схема его не выводит). «Роль участника» нужна там, где роль узла задать нельзя (у событий нет resourceRole), «Событие/Узел второй стороны» — сигнал в экземпляр соседа по заказу, «Запускаемый процесс» — старт процесса второй стороны.`}
          </p>
        )}
      </div>
    </div>
  );
}
