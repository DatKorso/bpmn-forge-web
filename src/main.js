import Modeler from 'bpmn-js/lib/Modeler';
import { getDi } from 'bpmn-js/lib/util/ModelUtil';
import colorPicker from 'bpmn-js-color-picker';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import autoAlign from './auto-align.js';
import { clearAlignmentStatus, reportAlignment, reportOperation, reportOperationError, resetAlignment } from './footer.js';
import keyboardPalette from './keyboard-palette.js';
import { protectConditionalFlows, renderProperties } from './properties.js';
import russian from './russian.js';
import { reportGapValidity, updateToolTooltip } from './toolbar.js';
import { fitDiagram, zoomDiagram } from './viewport.js';
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
const alignSelection = byId('align-selection');
const selectionReason = byId('selection-reason');
const documentName = byId('document-name');
const propertiesFields = byId('properties-fields');
let modeler;
let busy = false;
let filename = 'Новая схема.bpmn';
let savedAction;
let dirty = false;

function warnBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = true;
}

function currentAction() {
  // The pinned diagram-js stack retains action identity across undo and redo.
  return modeler?.get('commandStack')._getUndoAction();
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

  for (const id of ['new', 'open']) byId(id).disabled = busy;
  for (const id of ['download', 'align']) byId(id).disabled = busy || !modeler;
  byId('undo').disabled = busy || !stack?.canUndo();
  byId('redo').disabled = busy || !stack?.canRedo();
  const reason = busy || !modeler ? 'Дождитесь загрузки схемы.' : modeler.get('autoAlign').selection(selection).reason;
  alignSelection.setAttribute('aria-disabled', String(Boolean(reason)));
  selectionReason.textContent = reason ?? '';
  alignSelection.setAttribute('aria-describedby', reason ? 'selection-reason' : 'selection-scope');
  updateToolTooltip();
  renderProperties(modeler, selection);
  propertiesFields.inert = busy;

  const root = modeler?.get('canvas').getRootElement();
  byId('empty').hidden = busy || !root || root.children.length > 0;
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
    next.on('commandStack.changed', () => {
      if (modeler !== next) return;
      updateDirtyState();
      clearAlignmentStatus();
    });
    next.on(['commandStack.changed', 'root.set', 'selection.changed'], () => {
      if (modeler === next) updateControls();
    });

    const oldHost = workspace.querySelector('.diagram:not(.staging)');
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
  trigger.focus();
});

byId('new').addEventListener('click', () => replaceDiagram('Создать схему', byId('new'), () =>
  loadDiagram(() => EMPTY_XML, 'Новая схема.bpmn', 'Создана пустая схема.')));
byId('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (file) replaceDiagram('Открыть BPMN', byId('open'), () =>
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

function validateRequiredGap(input) {
  const value = input.valueAsNumber;
  const valid = Number.isSafeInteger(value) && value >= 0;
  input.setCustomValidity(valid ? '' : 'Введите целое число от нуля.');
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
    max.setCustomValidity(optional || validMax ? '' : 'Введите целое число не меньше минимума.');
  }
}

const alignment = byId('alignment');
alignment.addEventListener('submit', (event) => event.preventDefault());
byId('gap-settings').addEventListener('input', validateGaps);

function updateGapMode() {
  const uniform = useUniformGap.checked;
  rangeGapSettings.hidden = rangeGapSettings.disabled = uniform;
  uniformGapSettings.hidden = uniformGapSettings.disabled = !uniform;
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

byId('align').addEventListener('click', () => {
  if (busy || !modeler || !checkGaps()) return;

  try {
    reportAlignment(modeler.get('autoAlign').run(alignmentGaps()));
  } catch (error) {
    reportAlignment({ reason: 'Не удалось выполнить автовыравнивание.' });
    console.error(error);
  }
});

alignSelection.addEventListener('click', () => {
  if (busy || !modeler || alignSelection.getAttribute('aria-disabled') === 'true' || !checkGaps()) return;
  try {
    const selection = modeler.get('selection').get();
    reportAlignment(modeler.get('autoAlign').runSelection(selection, alignmentGaps()));
  } catch (error) {
    reportAlignment({ reason: 'Не удалось выровнять выделение.' });
    console.error(error);
  }
});

new ResizeObserver(() => modeler?.get('canvas').resized()).observe(workspace);
loadDiagram(() => EMPTY_XML, filename, 'Схема готова к редактированию.');
