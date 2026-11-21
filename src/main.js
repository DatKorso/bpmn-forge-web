import Modeler from 'bpmn-js/lib/Modeler';
import { getDi } from 'bpmn-js/lib/util/ModelUtil';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import autoAlign from './auto-align.js';
import russian from './russian.js';
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
const status = byId('status');
let modeler;
let busy = false;
let filename = 'Новая схема.bpmn';

function updateControls() {
  const stack = modeler?.get('commandStack');

  for (const id of ['new', 'open']) byId(id).disabled = busy;
  for (const id of ['download', 'align']) byId(id).disabled = busy || !modeler;
  byId('undo').disabled = busy || !stack?.canUndo();
  byId('redo').disabled = busy || !stack?.canRedo();

  const root = modeler?.get('canvas').getRootElement();
  byId('empty').hidden = busy || !root || root.children.length > 0;
  workspace.inert = busy;
  workspace.setAttribute('aria-busy', String(busy));
}

function report(message, skipped = [], error = false) {
  status.classList.toggle('error', error);
  status.textContent = message;
  if (!skipped.length) return;

  const list = document.createElement('ul');
  for (const { name, reason } of skipped) {
    const item = document.createElement('li');
    item.textContent = `${name} — ${reason}.`;
    list.append(item);
  }
  status.append(list);
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

async function loadDiagram(readXML, nextFilename, message) {
  if (busy) return;
  busy = true;
  updateControls();

  const host = document.createElement('div');
  host.className = 'diagram staging';
  workspace.prepend(host);
  let next;
  try {
    // Keep the live model and its history until the new XML has rendered successfully.
    next = new Modeler({ container: host, additionalModules: [autoAlign, russian] });
    keepFractionalBounds(next);
    const { warnings } = await next.importXML(await readXML());
    const canvas = next.get('canvas');
    if (canvas.getRootElement().children.length) canvas.zoom('fit-viewport');
    next.on(['commandStack.changed', 'root.set'], updateControls);

    const oldHost = workspace.querySelector('.diagram:not(.staging)');
    modeler?.destroy();
    oldHost?.remove();

    modeler = next;
    host.classList.remove('staging');
    filename = nextFilename;
    byId('document-name').textContent = nextFilename.replace(/\.bpmn$/i, '');
    report(warnings.length ? `${message} Предупреждения импорта: ${warnings.length}.` : message);
  } catch (error) {
    next?.destroy();
    host.remove();
    report('Не удалось открыть BPMN. Проверьте формат файла.', [], true);
    console.error(error);
  } finally {
    busy = false;
    updateControls();
  }
}

byId('new').addEventListener('click', () => loadDiagram(
  () => EMPTY_XML, 'Новая схема.bpmn', 'Создана пустая схема.'
));
byId('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (file) loadDiagram(() => file.text(), file.name, 'Файл открыт.');
});

byId('undo').addEventListener('click', () => {
  modeler.get('commandStack').undo();
  report('Действие отменено.');
});
byId('redo').addEventListener('click', () => {
  modeler.get('commandStack').redo();
  report('Действие повторено.');
});

byId('download').addEventListener('click', async () => {
  const currentModeler = modeler;
  const outputName = filename.replace(/\.(bpmn|xml)$/i, '') + '.bpmn';
  try {
    const { xml } = await currentModeler.saveXML({ format: true });
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = outputName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (currentModeler === modeler) report('Файл BPMN скачан.');
  } catch (error) {
    if (currentModeler === modeler) report('Не удалось сохранить файл BPMN.', [], true);
    console.error(error);
  }
});

function validateGap(input) {
  input.setCustomValidity('');
  if (input.validity.badInput || !Number.isSafeInteger(input.valueAsNumber) || input.valueAsNumber < 0) {
    input.setCustomValidity('Введите целое число от нуля.');
  }
}

for (const input of [gapX, gapY]) {
  input.addEventListener('input', () => validateGap(input));
}

const alignment = byId('alignment');
alignment.addEventListener('submit', (event) => event.preventDefault());
byId('align').addEventListener('click', () => {
  if (busy || !modeler || !alignment.reportValidity()) return;

  const { moved, skipped } = modeler.get('autoAlign').run({
    x: gapX.valueAsNumber,
    y: gapY.valueAsNumber
  });
  report(`Перемещено фигур: ${moved}. Пропущено участков: ${skipped.length}.`, skipped);
});

new ResizeObserver(() => modeler?.get('canvas').resized()).observe(workspace);
loadDiagram(() => EMPTY_XML, filename, 'Схема готова к редактированию.');
