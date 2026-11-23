import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';

const fixtures = new URL('../fixtures/', import.meta.url);
const bounds = ({ x, y, width, height }) => ({ x, y, width, height });
const is = (value, type) => value?.$instanceOf(type);

export async function readFixture(file, planeId) {
  return readDiagram(await readFile(new URL(file, fixtures), 'utf8'), planeId);
}

export async function readDiagram(xml, planeId) {
  const { rootElement, warnings } = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(warnings, []);
  const selected = planeId
    ? rootElement.diagrams.find(({ plane }) => plane.id === planeId || plane.bpmnElement.id === planeId)
    : rootElement.diagrams[0];
  assert.ok(selected, `Plane ${planeId} does not exist`);
  const { plane } = selected;
  const diElements = plane.planeElement ?? [];
  const root = { id: plane.bpmnElement.id, model: plane.bpmnElement, kind: 'root', header: 0, horizontal: true };
  const poolByProcess = new Map();
  const shapes = new Map();

  for (const di of diElements.filter((entry) => is(entry, 'bpmndi:BPMNShape'))) {
    const model = di.bpmnElement;
    const kind = is(model, 'bpmn:Participant') ? 'pool' : is(model, 'bpmn:Lane') ? 'lane' :
      is(model, 'bpmn:Group') ? 'group' : is(model, 'bpmn:FlowNode') && !is(model, 'bpmn:BoundaryEvent') ? 'node' : 'artifact';
    const figure = {
      id: model.id, model, type: model.$type, kind, box: bounds(di.bounds),
      expanded: is(model, 'bpmn:SubProcess') && Boolean(di.isExpanded),
      header: kind === 'pool' || kind === 'lane' ? 30 : 0,
      labels: di.label?.bounds ? [bounds(di.label.bounds)] : []
    };
    if (model.processRef) poolByProcess.set(model.processRef, figure);
    if (figure.header) figure.horizontal = di.isHorizontal ?? true;
    shapes.set(model, figure);
  }

  function hidden(model) {
    for (let parent = model.$parent; parent && parent !== root.model; parent = parent.$parent) {
      if (is(parent, 'bpmn:SubProcess') && shapes.has(parent) && !shapes.get(parent).expanded) return true;
    }
    return false;
  }

  const visible = new Map([...shapes].filter(([model]) => !hidden(model)));
  function scopeOf(model) {
    for (let parent = model.$parent; parent; parent = parent.$parent) {
      if (visible.get(parent)?.expanded) return visible.get(parent);
      if (poolByProcess.has(parent)) return poolByProcess.get(parent);
    }
    return root;
  }

  for (const [model, figure] of visible) {
    figure.scope = scopeOf(model);
    const parent = figure.kind === 'lane' ? model.$parent?.$parent : model.$parent;
    figure.parent = visible.get(parent) ?? figure.scope;
    figure.host = visible.get(model.attachedToRef);
    if (figure.kind === 'lane') {
      for (const member of model.flowNodeRef ?? []) {
        if (visible.get(member)?.kind === 'node') visible.get(member).lane = figure;
      }
    }
  }

  const diagram = { root, figures: [...visible.values()], diElements,
    edges: [], messageFlows: [], auxiliary: [] };
  for (const di of diElements.filter((entry) => is(entry, 'bpmndi:BPMNEdge'))) {
    const model = di.bpmnElement;
    if (hidden(model)) continue;
    const group = is(model, 'bpmn:SequenceFlow') ? diagram.edges :
      is(model, 'bpmn:MessageFlow') ? diagram.messageFlows : diagram.auxiliary;
    const source = is(model, 'bpmn:DataOutputAssociation') ? model.$parent : [model.sourceRef].flat()[0];
    const target = is(model, 'bpmn:DataInputAssociation') ? model.$parent : model.targetRef;
    group.push({
      id: model.id, model, type: model.$type, source: visible.get(source), target: visible.get(target),
      isDefault: source?.default === model, points: (di.waypoint ?? []).map(({ x, y }) => ({ x, y })),
      labels: di.label?.bounds ? [bounds(di.label.bounds)] : []
    });
  }
  return diagram;
}

