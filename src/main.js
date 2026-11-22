import Modeler from 'bpmn-js/lib/Modeler';
import { getDi } from 'bpmn-js/lib/util/ModelUtil';
import colorPicker from 'bpmn-js-color-picker';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import autoAlign from './auto-align.js';
import { getUndoAction } from './bpmn-internals.js';
import { clearAlignmentStatus, reportAlignment, reportOperation, reportOperationError, resetAlignment, setAlignmentPending } from './footer.js';
import keyboardPalette from './keyboard-palette.js';
import { protectConditionalFlows, renderProperties } from './properties.js';
import russian from './russian.js';
import { confirmAlignment, reportGapValidity, updateToolTooltip } from './toolbar.js';
import { fitDiagram, revealElements, zoomDiagram } from './viewport.js';
import './style.css';

const EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    id="Definitions_1" targetNamespace="http://example.org/bpmn">
  <bpmn:process id="Process_1" isExecutable="false" />
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const byId = (id) => document.getElementById(id);
const workspace = byId('workspace');
const fileInput = byId('file');
const gapX = byId('gap-x');
const gapY = byId('gap-y');
const maxGapX = byId('max-gap-x');
const maxGapY = byId('max-gap-y');
const useUniformGap = byId('use-uniform-gap');
const uniformGap = byId('uniform-gap');
const rangeGapSettings = byId('gap-range');
const uniformGapSettings = byId('gap-uniform');
const align = byId('align');
const alignSelection = byId('align-selection');
const selectionReason = byId('selection-reason');
const documentName = byId('document-name');
const propertiesFields = byId('properties-fields');
let modeler;
let busy = false;
let aligning = false;
let highlighted = [];
let filename = 'Новая схема.bpmn';
let savedAction;
let dirty = false;

function warnBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = true;
}

function currentAction() {
  return getUndoAction(modeler?.get('commandStack'));
}

function updateDirtyState() {
  const changed = currentAction() !== savedAction;
  if (changed === dirty) return;
  dirty = changed;
  byId('unsaved-changes').textContent = dirty ? 'Есть несохранённые изменения' : '';
  if (dirty) window.addEventListener('beforeunload', warnBeforeUnload);
  else window.removeEventListener('beforeunload', warnBeforeUnload);
}

function updateControls() {
  const stack = modeler?.get('commandStack');
  const selection = modeler?.get('selection').get() ?? [];
  const root = modeler?.get('canvas').getRootElement();
  const empty = !root?.children.length;

  for (const id of ['new', 'open']) byId(id).disabled = busy;
  byId('download').disabled = busy || !modeler;
  align.disabled = busy || empty;
  byId('undo').disabled = busy || !stack?.canUndo();
  byId('redo').disabled = busy || !stack?.canRedo();
  const reason = aligning ? 'Дождитесь завершения выравнивания.' : busy || !modeler
    ? 'Дождитесь завершения операции со схемой.'
    : modeler.get('autoAlign').selection(selection).reason;
  alignSelection.setAttribute('aria-disabled', String(Boolean(reason)));
  selectionReason.textContent = reason ?? '';
  alignSelection.setAttribute('aria-describedby', reason ? 'selection-reason' : 'selection-scope');
  updateToolTooltip();
  renderProperties(modeler, selection);
  propertiesFields.inert = busy;

  byId('empty').hidden = busy || !root || !empty;
  workspace.inert = busy;
  workspace.setAttribute('aria-busy', String(busy));
}

function keepFractionalBounds(modeler) {
  modeler.on('bpmnElement.added', ({ element }) => {
    const di = getDi(element);
    const fields = ['x', 'y', 'width', 'height'];
    const redraw = (shape, bounds) => {
      if (!shape || !bounds || !fields.every((field) => Number.isFinite(bounds[field])) ||
          fields.every((field) => Number.isInteger(bounds[field]))) return;
      for (const field of fields) shape[field] = bounds[field];
      modeler.get('eventBus').fire('element.changed', { element: shape });
    };

    // Stock import rounds DI bounds. An odd-width shape needs a half-unit
    // coordinate when its center is on the grid.
    redraw(element, di?.bounds);
    redraw(element.label, di?.label?.bounds);
  });
}

async function loadDiagram(readXML, nextFilename, message, operation = 'new') {
  if (busy) return;
  busy = true;
  updateControls();

  const host = document.createElement('div');
  host.className = 'diagram staging';
  workspace.prepend(host);
  let next;
  try {
    // Keep the live model and its history until the new XML has rendered successfully.
    next = new Modeler({ container: host, additionalModules: [autoAlign, russian, colorPicker, keyboardPalette] });
    protectConditionalFlows(next);
    keepFractionalBounds(next);
    const { warnings } = await next.importXML(await readXML());
    const canvas = next.get('canvas');
    canvas.resized();
    if (canvas.getRootElement().children.length) fitDiagram(canvas);
    next.on('create.init', () => host.classList.add('placing'));
    next.on('create.cleanup', () => host.classList.remove('placing'));
    next.on('commandStack.changed', () => {
      if (modeler !== next) return;
      updateDirtyState();
      clearAlignmentStatus();
      clearSkippedHighlight();
    });
    next.on(['commandStack.changed', 'root.set', 'selection.changed'], () => {
      if (modeler === next) updateControls();
    });

    const oldHost = workspace.querySelector('.diagram:not(.staging)');
    clearSkippedHighlight();
    modeler?.destroy();
    oldHost?.remove();

    modeler = next;
    savedAction = currentAction();
    updateDirtyState();
    host.classList.remove('staging');
    filename = nextFilename;
    documentName.textContent = nextFilename.replace(/\.bpmn$/i, '');
    documentName.title = nextFilename;
    resetAlignment();
    reportOperation(warnings.length ? `${message} Предупреждения импорта: ${warnings.length}.` : message, operation);
  } catch (error) {
    next?.destroy();
    host.remove();
    reportOperationError(operation, operation === 'import'
      ? 'Не удалось открыть BPMN. Проверьте формат файла.'
      : 'Не удалось создать пустую схему.');
    console.error(error);
  } finally {
    busy = false;
    updateControls();
  }
}

const confirmation = byId('confirm-replace');
let fileTrigger = byId('open');
let pendingReplacement;

function replaceDiagram(title, trigger, load) {
  modeler?.get('directEditing').complete();
  if (!dirty) return load();

  pendingReplacement = { trigger, load };
  byId('confirm-title').textContent = title;
  confirmation.returnValue = 'cancel';
  confirmation.showModal();
}

confirmation.addEventListener('close', async () => {
  const { trigger, load } = pendingReplacement;
  pendingReplacement = undefined;
  const action = confirmation.returnValue;
  if (action === 'discard' || (action === 'download' && await downloadDiagram())) await load();
  (trigger.closest('[hidden]') ? byId('open') : trigger).focus();
});

byId('new').addEventListener('click', () => replaceDiagram('Создать схему', byId('new'), () =>
  loadDiagram(() => EMPTY_XML, 'Новая схема.bpmn', 'Создана пустая схема.')));
for (const id of ['open', 'empty-open']) {
  byId(id).addEventListener('click', (event) => {
    fileTrigger = event.currentTarget;
    fileInput.click();
  });
}
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (file) replaceDiagram('Открыть BPMN', fileTrigger, () =>
    loadDiagram(() => file.text(), file.name, 'Файл открыт.', 'import'));
});

byId('undo').addEventListener('click', () => {
  modeler.get('commandStack').undo();
  reportOperation('Действие отменено.');
});
byId('redo').addEventListener('click', () => {
  modeler.get('commandStack').redo();
  reportOperation('Действие повторено.');
});

async function downloadDiagram() {
  if (busy || !modeler) return false;
  modeler.get('directEditing').complete();
  busy = true;
  updateControls();
  const outputName = filename.replace(/\.(bpmn|xml)$/i, '') + '.bpmn';
  let url;
  try {
    const { xml } = await modeler.saveXML({ format: true });
    url = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = outputName;
    link.click();
    savedAction = currentAction();
    updateDirtyState();
    reportOperation('Файл BPMN скачан.', 'export');
    return true;
  } catch (error) {
    reportOperationError('export', 'Не удалось сохранить файл BPMN.');
    console.error(error);
    return false;
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    busy = false;
    updateControls();
  }
}

byId('download').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  await downloadDiagram();
  if (document.activeElement === document.body) button.focus();
});

for (const [id, factor] of [['zoom-out', 1 / 1.25], ['zoom-in', 1.25]]) {
  byId(id).addEventListener('click', () => zoomDiagram(modeler.get('canvas'), factor));
}
byId('zoom-fit').addEventListener('click', () => fitDiagram(modeler.get('canvas')));

function setGapError(input, message) {
  input.setCustomValidity(message);
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  const error = byId(`${input.id}-error`);
  error.textContent = message;
  error.hidden = !message;
}

function validateRequiredGap(input) {
  const value = input.valueAsNumber;
  const valid = Number.isSafeInteger(value) && value >= 0;
  setGapError(input, valid ? '' : 'Введите целое число от нуля.');
  return valid;
}

function validateGaps() {
  if (useUniformGap.checked) {
    validateRequiredGap(uniformGap);
    return;
  }

  for (const [min, max] of [[gapX, maxGapX], [gapY, maxGapY]]) {
    max.min = validateRequiredGap(min) ? String(min.valueAsNumber) : '0';
    const optional = !max.value && !max.validity.badInput;
    const validMax = Number.isSafeInteger(max.valueAsNumber) && max.valueAsNumber >= Number(max.min);
    setGapError(max, optional || validMax ? '' : 'Введите целое число не меньше минимума.');
  }
}

const alignment = byId('alignment');
alignment.addEventListener('submit', (event) => event.preventDefault());
const gapSettings = byId('gap-settings');
gapSettings.addEventListener('input', validateGaps);

const storageKey = 'bpmn-forge.alignment-gaps';
const gapInputs = [gapX, gapY, maxGapX, maxGapY, uniformGap];
let storedGaps = {};
try {
  const settings = JSON.parse(localStorage.getItem(storageKey));
  if (settings && typeof settings === 'object') storedGaps = settings;
} catch {
  // Storage can be disabled by the browser.
}
useUniformGap.checked = storedGaps.uniform === true;
for (const input of gapInputs) {
  const value = storedGaps[input.id];
  if (typeof value !== 'string') continue;
  if ((!input.required && value === '') || (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)))) {
    input.value = value;
  }
}

function storeGaps() {
  if (gapSettings.querySelector('input:invalid')) return;
  storedGaps.uniform = useUniformGap.checked;
  const activeInputs = useUniformGap.checked ? [uniformGap] : [gapX, gapY, maxGapX, maxGapY];
  for (const input of activeInputs) {
    storedGaps[input.id] = input.value ? String(input.valueAsNumber) : '';
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(storedGaps));
  } catch {
    // Continue using the settings in this tab.
  }
}

gapSettings.addEventListener('change', storeGaps);

function updateGapMode() {
  const uniform = useUniformGap.checked;
  rangeGapSettings.hidden = rangeGapSettings.disabled = uniform;
  uniformGapSettings.hidden = uniformGapSettings.disabled = !uniform;
  validateGaps();
}

useUniformGap.addEventListener('change', updateGapMode);
updateGapMode();

function checkGaps() {
  validateGaps();
  return reportGapValidity();
}

function alignmentGaps() {
  if (useUniformGap.checked) {
    const gap = uniformGap.valueAsNumber;
    return { x: gap, y: gap, maxX: gap, maxY: gap };
  }

  return {
    x: gapX.valueAsNumber,
    y: gapY.valueAsNumber,
    maxX: maxGapX.value ? maxGapX.valueAsNumber : undefined,
    maxY: maxGapY.value ? maxGapY.valueAsNumber : undefined
  };
}

function clearSkippedHighlight() {
  const canvas = modeler?.get('canvas');
  for (const shape of highlighted) canvas.removeMarker(shape, 'alignment-skipped');
  highlighted = [];
}

function revealSkippedRegion({ element, kind }) {
  const registry = modeler.get('elementRegistry');
  if (registry.get(element.id) !== element) return;
  clearSkippedHighlight();
  const canvas = modeler.get('canvas');
  if (kind === 'root') {
    canvas.setRootElement(element);
    highlighted = element.children.filter((child) => !child.hidden && !child.waypoints && !child.labelTarget);
    fitDiagram(canvas);
  } else {
    highlighted = [element];
    revealElements(canvas, highlighted);
  }
  const outline = modeler.get('outline');
  for (const shape of highlighted) {
    outline.createOutline(shape);
    canvas.addMarker(shape, 'alignment-skipped');
  }
  canvas.focus();
}

async function alignDiagram(button, trigger) {
  if (busy || !modeler || button.disabled || button.getAttribute('aria-disabled') === 'true' || !checkGaps()) return;
  const selected = button === alignSelection;
  const selection = selected ? modeler.get('selection').get() : null;
  const gaps = alignmentGaps();
  storeGaps();
  modeler.get('directEditing').complete();
  const current = modeler;
  const action = currentAction();
  busy = aligning = true;
  setAlignmentPending(true);
  updateControls();

  try {
    // Let Chromium paint the pending state before synchronous planning.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const autoAlign = current.get('autoAlign');
    const plan = selected ? autoAlign.planSelection(selection, gaps) : autoAlign.planDiagram(gaps);
    setAlignmentPending(false);
    if (plan.apply && !await confirmAlignment(plan)) return;
    if (current !== modeler || action !== currentAction()) {
      reportAlignment({ reason: 'Схема изменилась. Запустите выравнивание ещё раз.' });
      return;
    }
    clearSkippedHighlight();
    reportAlignment(plan.apply ? plan.apply() : plan, revealSkippedRegion);
  } catch (error) {
    reportAlignment({ reason: selected ? 'Не удалось выровнять выделение.' : 'Не удалось выполнить автовыравнивание.' });
    console.error(error);
  } finally {
    busy = aligning = false;
    setAlignmentPending(false);
    updateControls();
    if (document.activeElement === document.body) (trigger === document.body ? button : trigger).focus();
  }
}

for (const button of [align, alignSelection]) {
  button.addEventListener('click', () => alignDiagram(button, button));
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) clearSkippedHighlight();
  if (event.defaultPrevented || event.repeat || event.key !== 'Enter' || !event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest('dialog, input, textarea, select, [contenteditable]')) return;
  const button = event.shiftKey ? alignSelection : align;
  if (busy || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  event.preventDefault();
  alignDiagram(button, document.activeElement);
});

new ResizeObserver(() => modeler?.get('canvas').resized()).observe(workspace);
loadDiagram(() => EMPTY_XML, filename, 'Схема готова к редактированию.');
