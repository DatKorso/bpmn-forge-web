import { is } from 'bpmn-js/lib/util/ModelUtil';
import { isExpanded } from 'bpmn-js/lib/util/DiUtil';
import { getLabel } from 'bpmn-js/lib/util/LabelUtil';

const byId = (id) => document.getElementById(id);
const panel = byId('properties');
const toggle = byId('toggle-properties');
const message = byId('properties-message');
const fields = byId('properties-fields');
const nameInput = byId('property-name');
const condition = byId('property-condition');
const conditionHint = byId('condition-hint');
const defaultBranch = byId('property-default');
const documentation = byId('documentation-entries');
const addDocumentation = byId('add-documentation');
const narrow = matchMedia('(max-width: 760px)');
const open = { wide: true, narrow: false };
const mode = () => narrow.matches ? 'narrow' : 'wide';
const supports = (object, name) => Boolean(object?.$descriptor?.propertiesByName[name]);
let modeler;
let selected;
const rows = new Map();

function syncPanel() {
  const visible = open[mode()];
  if (!visible && panel.contains(document.activeElement)) toggle.focus();
  panel.hidden = !visible;
  toggle.setAttribute('aria-expanded', String(visible));
}

function togglePanel(visible) {
  open[mode()] = visible;
  syncPanel();
  (visible ? byId('close-properties') : toggle).focus();
}

toggle.addEventListener('click', () => togglePanel(panel.hidden));
byId('close-properties').addEventListener('click', () => togglePanel(false));
narrow.addEventListener('change', syncPanel);
panel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    togglePanel(false);
  }
  event.stopPropagation();
});
panel.addEventListener('keyup', (event) => event.stopPropagation());
syncPanel();

const modeling = () => modeler.get('modeling');

function createOwned(type, properties, parent) {
  const entry = modeler.get('moddle').create(type, properties);
  entry.$parent = parent;
  return entry;
}

function setValue(input, value, replace = false) {
  if (replace || document.activeElement !== input) input.value = value ?? '';
}

function updateDocumentation() {
  const element = selected;
  const object = element.businessObject;
  const entries = object.get('documentation');
  for (const [entry, { row }] of rows) {
    if (entries.includes(entry)) continue;
    row.remove();
    rows.delete(entry);
  }
  entries.forEach((entry, index) => {
    if (!rows.has(entry)) {
      const row = document.createElement('div');
      row.className = 'documentation-entry';
      const label = document.createElement('label');
      label.className = 'property-field';
      const caption = document.createElement('span');
      const input = document.createElement('textarea');
      input.rows = 3;
      input.addEventListener('blur', () => {
        if (selected === element && (entry.text ?? '') !== input.value) {
          modeling().updateModdleProperties(element, entry, { text: input.value });
        }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', () => {
        modeling().updateProperties(element, { documentation: object.get('documentation').filter((item) => item !== entry) });
        addDocumentation.focus();
      });
      label.append(caption, input);
      row.append(label, remove);
      rows.set(entry, { row, caption, input, remove });
    }
    const { row, caption, input, remove } = rows.get(entry);
    const label = `Описание ${index + 1}`;
    caption.textContent = label;
    remove.setAttribute('aria-label', `Удалить описание ${index + 1}`);
    setValue(input, entry.text);
    if (documentation.children[index] !== row) documentation.insertBefore(row, documentation.children[index] ?? null);
  });
}

addDocumentation.addEventListener('click', () => {
  const object = selected.businessObject;
  const entry = createOwned('bpmn:Documentation', {}, object);
  modeling().updateProperties(selected, { documentation: [...object.get('documentation'), entry] });
  rows.get(entry).input.focus();
});

nameInput.addEventListener('blur', () => {
  const object = selected?.businessObject;
  if (supports(object, 'name') && (object.name ?? '') !== nameInput.value) {
    const name = nameInput.value.trim() ? nameInput.value : undefined;
    nameInput.value = name ?? '';
    if (getLabel(selected) !== undefined) modeling().updateLabel(selected, name ?? null);
    else modeling().updateProperties(selected, { name });
  }
});

condition.addEventListener('blur', () => {
  const object = selected?.businessObject;
  if (!is(object, 'bpmn:SequenceFlow') || condition.disabled) return;
  const expression = object.conditionExpression;
  const body = condition.value;
  if (!body.trim()) {
    condition.value = '';
    if (expression) modeling().updateProperties(selected, { conditionExpression: undefined });
  } else if (expression) {
    if (body !== expression.body) modeling().updateModdleProperties(selected, expression, { body });
  } else {
    modeling().updateProperties(selected, { conditionExpression: createOwned('bpmn:FormalExpression', { body }, object) });
  }
});

defaultBranch.addEventListener('change', () => {
  const object = selected.businessObject;
  if (object.conditionExpression && defaultBranch.checked) {
    defaultBranch.checked = false;
    return;
  }
  modeling().updateProperties(selected.source, { default: defaultBranch.checked ? object : undefined });
});

const typeNames = {
  Participant: 'Пул', Lane: 'Дорожка', Process: 'Процесс', TextAnnotation: 'Текстовая аннотация',
  Group: 'Группа', MessageFlow: 'Поток сообщений', Association: 'Ассоциация'
};

function displayType(element) {
  const type = element.businessObject.$type.split(':').at(-1);
  if (type === 'SubProcess') return isExpanded(element) ? 'Раскрытый подпроцесс' : 'Свёрнутый подпроцесс';
  const readable = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  return typeNames[type] ?? modeler.get('translate')(readable[0] + readable.slice(1).toLowerCase());
}

export function renderProperties(next, selection) {
  const elements = [...new Set(selection.map((element) => element.labelTarget ?? element))];
  const element = elements.length === 1 ? elements[0] : undefined;
  const changed = element !== selected || next !== modeler;
  if (changed) {
    rows.clear();
    documentation.replaceChildren();
  }
  modeler = next;
  selected = element;
  message.hidden = Boolean(element);
  fields.hidden = !element;
  if (!element) {
    message.textContent = elements.length ? `Выбрано элементов: ${elements.length}.` : 'Выберите элемент на схеме.';
    return;
  }

  const object = element.businessObject;
  byId('property-type').textContent = displayType(element);
  byId('property-id').textContent = object.id;
  byId('property-name-field').hidden = !supports(object, 'name');
  setValue(nameInput, object.name, changed);
  byId('property-documentation').hidden = !supports(object, 'documentation');
  if (supports(object, 'documentation')) updateDocumentation();

  const source = element.source;
  const sequence = is(object, 'bpmn:SequenceFlow');
  const canDefault = sequence && supports(source?.businessObject, 'default');
  const expression = sequence && object.conditionExpression;
  const isDefault = canDefault && source.businessObject.default === object;
  const canCondition = canDefault && (!is(source, 'bpmn:Activity') ||
    source.outgoing.some((flow) => flow !== element && is(flow, 'bpmn:SequenceFlow')));
  byId('property-flow').hidden = !canDefault && !expression;
  byId('property-condition-field').hidden = !canCondition && !expression;
  setValue(condition, expression?.body, changed);
  condition.disabled = isDefault && !expression;
  conditionHint.hidden = !condition.disabled;
  conditionHint.textContent = condition.disabled ? 'Снимите отметку ветки по умолчанию, чтобы задать условие.' : '';
  defaultBranch.closest('label').hidden = !canDefault;
  defaultBranch.checked = isDefault;
  defaultBranch.disabled = Boolean(expression) && !isDefault;
  byId('default-hint').hidden = !canDefault || !defaultBranch.disabled;
}

export function protectConditionalFlows(modeler) {
  modeler.get('popupMenu').registerProvider('bpmn-replace', 500, {
    getPopupMenuEntries(element) {
      return (entries) => {
        if (is(element, 'bpmn:SequenceFlow') && element.businessObject.conditionExpression) {
          delete entries['replace-with-default-flow'];
        }
        return entries;
      };
    }
  });
}
