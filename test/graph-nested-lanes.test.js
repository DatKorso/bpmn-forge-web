import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bottom, contains, right, transpose } from '../src/alignment-state.js';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { intersects, translate, translateWaypoints } from '../src/layout.js';
import { cutsInterior, expandObstacle, ROUTE_MARGIN } from '../src/route-flows.js';
import { boxOf, graphGaps, measure, pathOf } from './helpers/layout-metrics.js';
import { nestedLaneVariant } from './helpers/nested-lanes.js';
import { readDiagram, readFixture } from './helpers/read-fixture.js';

const xml = await readFile(new URL('./fixtures/graph-layout/nested-lanes.bpmn', import.meta.url), 'utf8');
const shapeDi = (id) => new RegExp(`<bpmndi:BPMNShape id="${id}_di"[^>]*>[\\s\\S]*?<\\/bpmndi:BPMNShape>`);
const cuts = (path, box) => path.slice(1).some((point, index) => cutsInterior(path[index], point, box));
const ref = (id) => `<bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`;

function normalized(diagram, plan) {
  const pool = diagram.figures.find(({ id }) => id === 'Pool');
  const { x, y } = boxOf(plan, pool);
  const delta = { x: -x, y: -y };
  return {
    boxes: Object.fromEntries(diagram.figures.map((figure) => [figure.id, translate(boxOf(plan, figure), delta)])),
    routes: Object.fromEntries([...diagram.edges, ...diagram.messageFlows, ...diagram.auxiliary]
      .map((edge) => [edge.id, translateWaypoints(pathOf(plan, edge), delta)])),
    labels: Object.fromEntries([...plan.labels].filter(([, labels]) => labels.length)
      .map(([figure, labels]) => [figure.id, labels.map((box) => translate(box, delta))]))
  };
}

function verifyPacking(boxes, label, worldToProcess) {
  const { Pool, Operations, Preparation, Desk, Empty, Dispatch, Completion, Split, Prepare, Timer, Send, Done } =
    Object.fromEntries(Object.entries(boxes).map(([id, box]) => [id, worldToProcess(box)]));
  for (const [parent, children] of [
    [Pool, [Operations, Completion]],
    [Operations, [Preparation, Dispatch]],
    [Preparation, [Desk, Empty]]
  ]) {
    for (const [index, child] of children.entries()) {
      assert.ok(contains(parent, child));
      assert.equal(child.x, parent.x + 30);
      assert.equal(right(child), right(Pool));
      if (index) assert.equal(child.y, bottom(children[index - 1]));
    }
    assert.equal(bottom(children.at(-1)), bottom(parent));
  }
  assert.equal(Operations.y, Pool.y);
  assert.equal(Desk.y, Preparation.y);
  assert.ok(Empty.height > 0);
  const parentBand = { ...Operations, height: Preparation.y - Operations.y };
  assert.ok(contains(parentBand, Split));
  assert.ok(contains(parentBand, worldToProcess(label)));
  for (const [lane, node] of [[Desk, Prepare], [Desk, Timer], [Dispatch, Send], [Completion, Done]]) {
    assert.ok(contains(lane, node));
    assert.ok(node.x >= Desk.x + 30 + ROUTE_MARGIN);
  }
  assert.ok(intersects(Prepare, Timer));
  assert.ok(bottom(Desk) < Dispatch.y);
}

for (const vertical of [false, true]) {
  for (const collaboration of [false, true]) {
    test(`packs nested lanes in a ${vertical ? 'vertical' : 'horizontal'} ${collaboration ? 'collaboration' : 'single pool'}`, async () => {
      const input = { vertical, collaboration };
      const diagram = await readDiagram(nestedLaneVariant(xml, input));
      const stages = [];
      const plan = await planGraphLayout(diagram, graphGaps, stages, { allowMixedPools: false });
      assert.equal(plan.reason, undefined, plan.elementId);
      assert.equal(stages.length, collaboration ? 2 : 1);
      const { r1, r2, r3, r4 } = measure(diagram, plan, stages, ROUTE_MARGIN);
      assert.deepEqual({ r1, r2, r3, r4 }, { r1: [], r2: [], r3: [], r4: [] });
      const expected = normalized(diagram, plan);
      const process = vertical ? transpose : (value) => value;
      verifyPacking(expected.boxes, expected.labels.Split[0], process);
      for (const lane of diagram.figures.filter(({ kind }) => kind === 'lane')) {
        const laneBox = process(expected.boxes[lane.id]);
        const header = expandObstacle(process({ ...laneBox, width: lane.header }), ROUTE_MARGIN);
        for (const [id, path] of Object.entries(expected.routes)) {
          assert.equal(cuts(path, header), false, `${id} crosses the header of ${lane.id}`);
        }
      }
      assert.ok(cuts(expected.routes.Handoff, expected.boxes.Empty));
      assert.ok(expected.routes.Link.length >= 2);
      if (collaboration) assert.ok(expected.routes.Delivery.length >= 2);

      const perturbed = await readDiagram(nestedLaneVariant(xml, { ...input, reverseDi: true }));
      for (const [index, figure] of perturbed.figures.entries()) {
        const shift = figure.kind === 'pool' ? { x: 500, y: -200 } :
          ['Send', 'Note'].includes(figure.id) ? { x: -24, y: 39 } : { x: 7 * index, y: -11 * index };
        figure.box = translate(figure.box, shift);
        figure.labels = figure.labels.map((label) => translate(label, shift));
      }
      const reordered = await planGraphLayout(perturbed, graphGaps);
      assert.equal(reordered.reason, undefined, reordered.elementId);
      assert.deepEqual(normalized(perturbed, reordered), expected);
    });
  }
}

test('packs fully empty nested pools and reserves space for every leaf', async () => {
  for (const vertical of [false, true]) {
    for (const collaboration of [false, true]) {
      const input = nestedLaneVariant(xml, { vertical, collaboration })
        .replace(/    <bpmn:exclusiveGateway[\s\S]*?(  <\/bpmn:process>)/, '$1')
        .replace(/\s*<bpmn:flowNodeRef>[^<]+<\/bpmn:flowNodeRef>/g, '')
        .replace(/    <bpmn:messageFlow.*\n/g, '')
        .replace(/      <bpmndi:BPMN(Shape|Edge) id="(?:Split|Prepare|Timer|Send|Done|Note|Begin|Skip|Handoff|Timeout|Finish|Link|Delivery)_di"[\s\S]*?<\/bpmndi:BPMN\1>\n/g, '');
      const diagram = await readDiagram(input);
      const plan = await planGraphLayout(diagram, graphGaps);
      assert.equal(plan.reason, undefined, plan.elementId);
      const boxes = normalized(diagram, plan).boxes;
      const process = vertical ? transpose : (value) => value;
      const [pool, parent, branch, desk, empty] = ['Pool', 'Operations', 'Preparation', 'Desk', 'Empty']
        .map((id) => process(boxes[id]));
      assert.equal(pool.y, parent.y);
      assert.equal(parent.y, branch.y);
      assert.equal(branch.y, desk.y);
      assert.equal(bottom(desk), empty.y);
      assert.ok(desk.height > 0 && empty.height > 0);
      assert.ok(desk.width > 30 && empty.width > 30);
      assert.equal(bottom(empty), bottom(branch));
      assert.equal(right(empty), right(pool));
    }
  }
});

test('refuses invalid child lanes and membership with an addressable empty plan before ELK', async () => {
  const cases = [
    [xml.replace(shapeDi('Empty'), ''), 'graphIncomplete', 'Empty'],
    [xml.replace(shapeDi('Empty'), (entry) => entry + entry.replace('Empty_di', 'Duplicate_di')), 'graphIncomplete', 'Empty'],
    [xml.replace(shapeDi('Empty'), (entry) => entry.replace('height="70"', 'height="0"')), 'graphIncomplete', 'Empty'],
    [xml.replace('<bpmndi:BPMNShape id="Empty_di"', '<bpmndi:BPMNShape isHorizontal="false" id="Empty_di"'),
      'graphLaneOrientation', 'Empty'],
    [xml.replace(ref('Send'), ref('Send') + ref('Prepare')), 'graphOwnership', 'Prepare'],
    [xml.replace(ref('Send'), ref('Send') + ref('Send')), 'graphOwnership', 'Send'],
    [xml.replace(ref('Send'), ref('Send') + ref('Timer')), 'graphOwnership', 'Timer'],
    [xml.replace(ref('Send'), ''), 'graphMissingLane', 'Send']
  ];
  async function refuse(diagram, reason, id) {
    const stages = [];
    const plan = await planGraphLayout(diagram, graphGaps, stages);
    assert.equal(plan.reason, reason, id);
    assert.equal(plan.elementId, id);
    assert.equal(plan.boxes.size, 0);
    assert.equal(plan.routes.size, 0);
    assert.deepEqual(stages, []);
  }
  for (const collaboration of [false, true]) {
    for (const [input, reason, id] of cases) {
      await refuse(await readDiagram(nestedLaneVariant(input, { collaboration })), reason, id);
    }
    const wrongParent = await readDiagram(nestedLaneVariant(xml, { collaboration }));
    const child = wrongParent.figures.find(({ id }) => id === 'Empty');
    child.parent = child.scope;
    await refuse(wrongParent, 'graphOwnership', 'Empty');

    const noEventRef = await readDiagram(nestedLaneVariant(xml.replace(ref('Timer'), ''), { collaboration }));
    const plan = await planGraphLayout(noEventRef, graphGaps);
    assert.equal(plan.reason, undefined);
    const { Desk, Timer } = normalized(noEventRef, plan).boxes;
    assert.ok(contains(Desk, Timer));
  }
  await refuse(await readDiagram(xml.replace(ref('Send'), ref('Send') + ref('Receive'))),
    'graphOwnership', 'Receive');
  const noPool = nestedLaneVariant(xml, { collaboration: false })
    .replace(shapeDi('Pool'), '').replace('id="Plane" bpmnElement="Collaboration"', 'id="Plane" bpmnElement="Process"');
  await refuse(await readDiagram(noPool), 'graphNestedLanes', 'Operations');

  const expanded = await readFixture('pool-subprocess.bpmn');
  const subprocess = expanded.figures.find((figure) => figure.expanded);
  const nested = await readDiagram(xml);
  subprocess.model.laneSets = nested.figures.find(({ id }) => id === 'Pool').model.processRef.laneSets;
  await refuse(expanded, 'graphNestedLanes', 'Operations');
});
