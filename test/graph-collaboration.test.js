import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { translate, translateWaypoints } from '../src/layout.js';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { inspectCollaboration } from '../src/graph-layout/support.js';
import { readDiagram, readFixture } from './helpers/read-fixture.js';
import { boxOf, graphGaps, pathOf } from './helpers/layout-metrics.js';
import { compactBenchmarkXml } from '../scripts/graph-benchmark-workload.js';

const find = (diagram, id) => diagram.figures.find((figure) => figure.id === id);

function exportedGeometry(diagram, plan) {
  return {
    figures: Object.fromEntries(diagram.figures.map((figure) => [figure.id, boxOf(plan, figure)])),
    paths: Object.fromEntries([...diagram.edges, ...diagram.auxiliary, ...diagram.messageFlows]
      .map((edge) => [edge.id, pathOf(plan, edge)])),
    labels: Object.fromEntries([...(plan.labels ?? [])].map(([entry, labels]) => [entry.id, labels]))
  };
}

function removeMessages(diagram) {
  const models = new Set(diagram.root.model.messageFlows);
  diagram.root.model.messageFlows = [];
  diagram.messageFlows = [];
  diagram.diElements = diagram.diElements.filter(({ bpmnElement }) => !models.has(bpmnElement));
}

for (const axis of ['x', 'y']) test(`each mixed pool has its isolated layout in a row along ${axis}`, async () => {
  const diagram = await readDiagram(await compactBenchmarkXml(axis));
  const { owner, pools } = inspectCollaboration(diagram);
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  const cross = axis === 'x' ? 'y' : 'x';
  const size = axis === 'x' ? 'width' : 'height';
  assert.deepEqual(pools.map((pool) => boxOf(plan, pool)[cross]), pools.map(() => pools[0].box[cross]));
  assert.deepEqual([boxOf(plan, pools[0]).x, boxOf(plan, pools[0]).y], [40.25, 45.5]);
  const [sender, receiver, carrierBox] = pools.map((pool) => boxOf(plan, pool));
  assert.equal(receiver[axis] - (sender[axis] + sender[size]), 80);
  assert.equal(carrierBox[axis] - (receiver[axis] + receiver[size]), graphGaps[axis]);
  for (const pool of pools) {
    const figures = diagram.figures.filter((figure) => owner.get(figure) === pool);
    const edges = diagram.edges.filter(({ source }) => owner.get(source) === pool);
    const root = { ...diagram.root, model: { $instanceOf: () => false } };
    const isolated = await planGraphLayout({ root, figures, edges, auxiliary: [] }, graphGaps);
    assert.equal(isolated.reason, undefined);
    const local = boxOf(isolated, pool);
    const final = boxOf(plan, pool);
    const delta = { x: final.x - local.x, y: final.y - local.y };
    for (const figure of figures) assert.deepEqual(boxOf(plan, figure), translate(boxOf(isolated, figure), delta));
    for (const edge of edges) assert.deepEqual(pathOf(plan, edge), translateWaypoints(pathOf(isolated, edge), delta));
  }
  const carrier = find(diagram, 'Carrier');
  const final = boxOf(plan, carrier);
  assert.equal(final.width, carrier.box.width);
  assert.equal(final.height, carrier.box.height);
});

test('a one-to-one tie stacks along Y regardless of a side-by-side input or hidden participant', async () => {
  const xml = (await compactBenchmarkXml('y')).replace(/<bpmndi:BPMNShape id="Carrier_di"[\s\S]*?<\/bpmndi:BPMNShape>/, '');
  const diagram = await readDiagram(xml);
  const [sender, receiver] = inspectCollaboration(diagram).pools;
  receiver.box = { ...receiver.box, y: sender.box.y };
  const first = await planGraphLayout(diagram, { x: 101, y: 90 });
  assert.equal(first.reason, undefined);
  const a = boxOf(first, sender);
  const b = boxOf(first, receiver);
  assert.equal(a.x, b.x);
  assert.equal(b.y, a.y + a.height + 90);
  diagram.root.model.participants.reverse();
  const reversed = await planGraphLayout(diagram, { x: 101, y: 90 });
  assert.equal(reversed.reason, undefined);
  assert.deepEqual(boxOf(reversed, sender), a);
  assert.deepEqual(boxOf(reversed, receiver), b);

  removeMessages(diagram);
  receiver.box = { ...receiver.box, y: sender.box.y + (sender.box.height - receiver.box.height) / 2 };
  const tied = await planGraphLayout(diagram, { x: 0, y: 0 });
  assert.equal(tied.reason, undefined);
  const top = boxOf(tied, receiver);
  assert.equal(boxOf(tied, sender).y, top.y + top.height);
  diagram.root.model.participants.reverse();
  const swapped = await planGraphLayout(diagram, { x: 0, y: 0 });
  assert.equal(swapped.reason, undefined);
  const swappedTop = boxOf(swapped, sender);
  assert.equal(boxOf(swapped, receiver).y, swappedTop.y + swappedTop.height);
});

test('a two-to-two tie gives the empty vertical frame a vote and stacks along Y', async () => {
  const xml = (await compactBenchmarkXml('y'))
    .replace('<bpmn:participant id="Hidden" />', '<bpmn:participant id="Hidden" processRef="Empty" />')
    .replace('<bpmndi:BPMNDiagram id="Diagram">', '<bpmn:process id="Empty" /><bpmndi:BPMNDiagram id="Diagram">')
    .replace('</bpmndi:BPMNPlane>', `<bpmndi:BPMNShape id="Hidden_di" bpmnElement="Hidden" isHorizontal="false">
      <dc:Bounds x="2200" y="1700" width="140.5" height="220.25" />
    </bpmndi:BPMNShape></bpmndi:BPMNPlane>`);
  const diagram = await readDiagram(xml);
  const { pools } = inspectCollaboration(diagram);
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  const boxes = pools.map((pool) => boxOf(plan, pool));
  assert.deepEqual(boxes.map(({ x }) => x), [40.25, 40.25, 40.25, 40.25]);
  assert.deepEqual([boxes[3].width, boxes[3].height], [140.5, 220.25]);
  const last = boxes.at(-1);
  assert.equal(last.y + last.height - boxes[0].y, boxes.reduce((sum, box) => sum + box.height, 80 + 2 * graphGaps.y));
});

test('vertical pools use visual order, break center ties by model order and keep the fractional row anchor', async () => {
  const diagram = await readFixture('order-fulfilment.bpmn');
  removeMessages(diagram);
  const sales = find(diagram, 'Sales');
  const warehouse = find(diagram, 'Warehouse');
  const carrier = find(diagram, 'Carrier');
  for (const pool of [sales, warehouse, carrier]) pool.horizontal = false;
  sales.box = { ...sales.box, x: 310.25, width: 200 };
  warehouse.box = { ...warehouse.box, x: 40.25, y: 31.5, width: 200 };
  carrier.box = { ...carrier.box, x: 310.25, width: 200 };

  const plan = await planGraphLayout({ ...diagram, figures: diagram.figures.toReversed() }, graphGaps);
  assert.equal(plan.reason, undefined);
  const boxes = [warehouse, sales, carrier].map((pool) => boxOf(plan, pool));
  assert.deepEqual(boxes.map(({ y }) => y), [31.5, 31.5, 31.5]);
  assert.equal(boxes[0].x, 40.25);
  for (const [index, box] of boxes.slice(1).entries()) {
    assert.equal(box.x - (boxes[index].x + boxes[index].width), graphGaps.x);
  }
});

test('message crossing two row boundaries reserves space at both', async () => {
  const diagram = await readFixture('order-fulfilment.bpmn');
  const [message] = diagram.messageFlows;
  const carrier = find(diagram, 'Carrier');
  message.model.targetRef = carrier.model;
  message.target = carrier;
  const removed = new Set(diagram.messageFlows.slice(1).map(({ model }) => model));
  diagram.root.model.messageFlows = [message.model];
  diagram.messageFlows = [message];
  diagram.diElements = diagram.diElements.filter(({ bpmnElement }) => !removed.has(bpmnElement));
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  const [sales, warehouse, blackBox] = ['Sales', 'Warehouse', 'Carrier'].map((id) => boxOf(plan, find(diagram, id)));
  assert.equal(warehouse.y - sales.y - sales.height, 80);
  assert.equal(blackBox.y - warehouse.y - warehouse.height, 80);
});

test('carries an empty process and its flat lane as a fixed frame', async () => {
  const xml = await readFile(new URL('./fixtures/order-fulfilment.bpmn', import.meta.url), 'utf8');
  const diagram = await readDiagram(xml
    .replace('id="Carrier" name=', 'id="Carrier" processRef="EmptyProcess" name=')
    .replace('<bpmndi:BPMNDiagram', `
      <bpmn:process id="EmptyProcess">
        <bpmn:laneSet id="EmptySet"><bpmn:lane id="EmptyLane" /></bpmn:laneSet>
      </bpmn:process>
      <bpmndi:BPMNDiagram`)
    .replace('</bpmndi:BPMNPlane>', `
      <bpmndi:BPMNShape id="EmptyLane_di" bpmnElement="EmptyLane" isHorizontal="true">
        <dc:Bounds x="260.5" y="930.25" width="400" height="80" />
      </bpmndi:BPMNShape></bpmndi:BPMNPlane>`));
  removeMessages(diagram);
  const carrier = find(diagram, 'Carrier');
  const lane = find(diagram, 'EmptyLane');
  carrier.box = { x: 230.5, y: 930.25, width: 430, height: 80 };
  const first = await planGraphLayout(diagram, graphGaps);
  assert.equal(first.reason, undefined);
  const next = boxOf(first, carrier);
  assert.equal(next.width, carrier.box.width);
  assert.equal(next.height, carrier.box.height);
  assert.deepEqual(boxOf(first, lane), translate(lane.box, { x: next.x - carrier.box.x, y: next.y - carrier.box.y }));
  for (const [figure, box] of first.boxes) figure.box = box;
  for (const [edge, points] of first.routes) edge.points = points;
  const repeated = await planGraphLayout(diagram, graphGaps);
  assert.equal(repeated.reason, undefined);
  assert.equal(repeated.boxes.size + repeated.routes.size, 0);
});

test('notes use model order across pools and keep valid projected gateway labels', async () => {
  const diagram = await readFixture('graph-layout/collaboration-editor.bpmn');
  const note = find(diagram, 'Note');
  const send = find(diagram, 'Send');
  const receiver = find(diagram, 'Receive');
  const other = diagram.root.model.$model.create('bpmn:Association', {
    id: 'Aardvark', sourceRef: note.model, targetRef: receiver.model
  });
  other.$parent = diagram.root.model;
  diagram.root.model.artifacts.push(other);
  diagram.auxiliary.unshift({ id: other.id, model: other, type: other.$type, source: note, target: receiver,
    points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
  diagram.diElements.push(diagram.root.model.$model.create('bpmndi:BPMNEdge', {
    bpmnElement: other, waypoint: [{ x: 0, y: 0 }, { x: 10, y: 10 }]
  }));
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  const sendAfter = boxOf(plan, send);
  assert.deepEqual(boxOf(plan, note), translate(note.box, {
    x: sendAfter.x - send.box.x, y: sendAfter.y - send.box.y
  }));
  for (const id of ['Split', 'Merge']) {
    const gateway = find(diagram, id);
    const after = boxOf(plan, gateway);
    const delta = { x: after.x - gateway.box.x, y: after.y - gateway.box.y };
    assert.deepEqual(plan.labels.get(gateway), gateway.labels.map((label) => translate(label, delta)));
  }
  const result = exportedGeometry(diagram, plan);
  const messages = diagram.messageFlows;
  messages[0].points = [{ x: 280, y: 192 }, { x: 280, y: 525 }];
  const reversed = { ...diagram, figures: diagram.figures.toReversed(), edges: diagram.edges.toReversed(),
    auxiliary: diagram.auxiliary.toReversed(), diElements: diagram.diElements.toReversed() };
  const repeated = await planGraphLayout(reversed, graphGaps);
  assert.equal(repeated.reason, undefined);
  assert.deepEqual(exportedGeometry(reversed, repeated), result);

  for (const [figure, box] of plan.boxes) figure.box = box;
  for (const [edge, path] of plan.routes) edge.points = path;
  for (const [entry, labels] of plan.labels) entry.labels = labels;
  const settled = await planGraphLayout(diagram, graphGaps);
  assert.equal(settled.reason, undefined);
  assert.equal(settled.boxes.size + settled.routes.size, 0);
});

test('a late label refusal drops all planned changes and leaves the input intact', async () => {
  const diagram = await readDiagram(await compactBenchmarkXml('x'));
  const [message] = diagram.messageFlows;
  message.labels = [{ x: 0, y: 0, width: Infinity, height: 20 }];
  const before = exportedGeometry(diagram, { boxes: new Map(), routes: new Map() });
  const stages = [];
  const plan = await planGraphLayout(diagram, graphGaps, stages);
  assert.equal(stages.length, 3);
  assert.equal(plan.reason, 'graphConnectionLabel');
  assert.equal(plan.elementId, message.id);
  assert.equal(plan.boxes.size + plan.routes.size, 0);
  assert.deepEqual(exportedGeometry(diagram, plan), before);
});
