import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { BpmnModdle } from 'bpmn-moddle';
import { planAlignment } from '../src/alignment-plan.js';

const fixtures = new URL('./fixtures/', import.meta.url);
const bounds = ({ x, y, width, height }) => ({ x, y, width, height });
const is = (value, type) => value?.$instanceOf(type);

async function readFixture(file) {
  const xml = await readFile(new URL(file, fixtures), 'utf8');
  const { rootElement, warnings } = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(warnings, []);
  const { plane } = rootElement.diagrams[0];
  const root = { id: plane.bpmnElement.id, kind: 'root', header: 0, horizontal: true };
  const poolByProcess = new Map();
  const shapes = new Map();

  for (const di of plane.planeElement.filter((entry) => is(entry, 'bpmndi:BPMNShape'))) {
    const model = di.bpmnElement;
    const kind = is(model, 'bpmn:Participant') ? 'pool' : is(model, 'bpmn:Lane') ? 'lane' :
      is(model, 'bpmn:Group') ? 'group' : is(model, 'bpmn:FlowNode') && !is(model, 'bpmn:BoundaryEvent') ? 'node' : 'artifact';
    const figure = {
      id: model.id, type: model.$type, kind, box: bounds(di.bounds),
      expanded: is(model, 'bpmn:SubProcess') && Boolean(di.isExpanded),
      header: kind === 'pool' || kind === 'lane' ? 30 : 0,
      labels: di.label?.bounds ? [bounds(di.label.bounds)] : []
    };
    if (model.processRef) poolByProcess.set(model.processRef, figure);
    if (figure.header) figure.horizontal = di.isHorizontal ?? true;
    shapes.set(model, figure);
  }

  function scopeOf(model) {
    for (let parent = model.$parent; parent; parent = parent.$parent) {
      if (shapes.get(parent)?.expanded) return shapes.get(parent);
      if (poolByProcess.has(parent)) return poolByProcess.get(parent);
    }
    return root;
  }

  for (const [model, figure] of shapes) {
    figure.scope = scopeOf(model);
    const parent = figure.kind === 'lane' ? model.$parent?.$parent : model.$parent;
    figure.parent = shapes.get(parent) ?? figure.scope;
    figure.host = shapes.get(model.attachedToRef);
    if (figure.kind === 'lane') {
      for (const member of model.flowNodeRef ?? []) {
        if (shapes.get(member)?.kind === 'node') shapes.get(member).lane = figure;
      }
    }
  }

  const diagram = { root, figures: [...shapes.values()], edges: [], messageFlows: [], auxiliary: [] };
  for (const di of plane.planeElement.filter((entry) => is(entry, 'bpmndi:BPMNEdge'))) {
    const model = di.bpmnElement;
    const group = is(model, 'bpmn:SequenceFlow') ? diagram.edges :
      is(model, 'bpmn:MessageFlow') ? diagram.messageFlows : diagram.auxiliary;
    group.push({
      id: model.id, type: model.$type, source: shapes.get(model.sourceRef), target: shapes.get(model.targetRef),
      isDefault: model.sourceRef.default === model, points: di.waypoint.map(({ x, y }) => ({ x, y }))
    });
  }
  return diagram;
}

for (const file of (await readdir(fixtures)).filter((name) => name.endsWith('.bpmn')).sort()) {
  test(`preserves the alignment golden for ${file}`, async () => {
    const diagram = await readFixture(file);
    const gaps = file.endsWith('compact-loop.bpmn') ? { x: 80, y: 80, maxX: 80, maxY: 80 } : { x: 40, y: 30 };
    const plan = planAlignment(diagram, gaps);
    const actual = {
      boxes: Object.fromEntries(diagram.figures.map((figure) => [figure.id, plan.boxes.get(figure) ?? figure.box])),
      routes: Object.fromEntries([...diagram.edges, ...diagram.messageFlows, ...diagram.auxiliary]
        .map((edge) => [edge.id, plan.routes.get(edge) ?? edge.points])),
      skipped: plan.skipped.map(({ scope, reason }) => ({ scope: scope.id, reason })),
      reason: plan.reason ?? null
    };
    const golden = new URL(file.replace(/\.bpmn$/, '.golden.json'), fixtures);
    if (process.env.UPDATE_ALIGNMENT_GOLDENS === '1') {
      await writeFile(golden, JSON.stringify(actual, null, 2) + '\n');
    }
    assert.deepEqual(actual, JSON.parse(await readFile(golden, 'utf8')));
  });
}
