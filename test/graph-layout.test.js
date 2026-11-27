import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { contains } from '../src/alignment-state.js';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { packRows } from '../src/graph-layout/arrange.js';
import { modelOrder, orderGraph } from '../src/graph-layout/model-order.js';
import { acceptsRoute, cutsInterior, expandObstacle, ROUTE_MARGIN, routeCost, routeFlows, simplifyRoute } from '../src/route-flows.js';
import { readDiagram, readFixture } from './helpers/read-fixture.js';
import { boxOf, graphFixtures, graphGaps, measure, normalized, pathOf, perturb } from './helpers/layout-metrics.js';

function verify(diagram, plan, stages) {
  assert.equal(plan.reason, undefined, plan.scope?.id);
  assert.deepEqual(plan.skipped, []);
  const { r1, r2, r3, r4 } = measure(diagram, plan, stages, ROUTE_MARGIN);
  assert.deepEqual({ r1, r2, r3, r4 }, { r1: [], r2: [], r3: [], r4: [] });
}

function apply(diagram, plan) {
  for (const [figure, box] of plan.boxes) {
    const dx = box.x - figure.box.x;
    const dy = box.y - figure.box.y;
    figure.labels = figure.labels.map((label) => ({ ...label, x: label.x + dx, y: label.y + dy }));
    figure.box = box;
  }
  for (const [edge, path] of plan.routes) edge.points = path;
  for (const [entry, labels] of plan.labels ?? []) entry.labels = labels;
}

for (const name of graphFixtures) {
  const load = () => readFixture(`${name}.bpmn`);
  test(`${name} meets R1–R4 and gives an empty second plan`, async () => {
    const diagram = await load();
    const stages = [];
    const plan = await planGraphLayout(diagram, graphGaps, stages);
    verify(diagram, plan, stages);
    apply(diagram, plan);
    const repeated = await planGraphLayout(diagram, graphGaps);
    assert.equal(repeated.reason, undefined);
    assert.equal(repeated.boxes.size, 0);
    assert.equal(repeated.routes.size, 0);
  });

  test(`${name} is independent of input geometry, DI order and IDs`, async () => {
    const diagram = await load();
    const plan = await planGraphLayout(diagram, graphGaps);
    assert.equal(plan.reason, undefined);
    const geometry = normalized(diagram, plan);
    for (const amount of [15, 40, 120]) {
      for (let seed = 1; seed <= 10; seed++) {
        const input = perturb(await load(), amount, seed);
        const reordered = { ...input, figures: input.figures.toReversed(), edges: input.edges.toReversed(),
          auxiliary: input.auxiliary.toReversed() };
        const stages = [];
        const next = await planGraphLayout(reordered, graphGaps, stages);
        verify(input, next, stages);
        assert.deepEqual(normalized(input, next), geometry, `jitter=${amount}, seed=${seed}`);
      }
    }
  });
}

test('supports zero and asymmetric minimum gaps in both orientations', async () => {
  for (const name of ['tight-pool', 'vertical-pool', 'pool-subprocess']) {
    for (const gaps of [{ x: 0, y: 0 }, { x: 15, y: 100 }, { x: 100, y: 15 }]) {
      const diagram = await readFixture(`${name}.bpmn`);
      const stages = [];
      const plan = await planGraphLayout(diagram, gaps, stages);
      verify(diagram, plan, stages);
      for (const { flows } of stages) {
        for (const flow of flows.filter(({ back }) => !back)) {
          const [axis, span] = flow.vertical ? ['y', 'height'] : ['x', 'width'];
          assert.ok(flow.target[axis] - (flow.source[axis] + flow.source[span]) >= gaps[axis]);
        }
      }
    }
  }
});

test('packs lane bands from ELK rows without using original lane geometry', () => {
  const first = { header: 30 };
  const second = { header: 30 };
  const figures = [{}, {}, {}];
  const units = new Map(figures.map((figure, index) => [figure, {
    key: String(index), lane: index < 2 ? first : second,
    parts: [[figure, { x: 0, y: 0, width: index === 1 ? 41 : 70, height: 50 }]]
  }]));
  const geometry = new Map([
    ['0', { x: 0, y: 10 }], ['1', { x: 140, y: 10 }], ['2', { x: 10, y: 0 }]
  ]);
  const children = new Map([[undefined, [first, second]]]);
  const { positioned, laneBoxes } = packRows(units, children, geometry, 30, graphGaps);
  assert.equal(positioned.get(figures[0]).y, positioned.get(figures[1]).y);
  assert.ok(positioned.get(figures[2]).y >= laneBoxes.get(second).y);
  assert.equal(laneBoxes.get(first).height, laneBoxes.get(second).y);
});

test('uses complete flowElements and prioritizes default and authored outgoing', async () => {
  const { root } = await readFixture('acyclic-reorder.bpmn');
  const [source] = modelOrder(root).nodes;
  assert.equal(source.outgoing?.length ?? 0, 0);
  assert.deepEqual(modelOrder(root).edges.map(({ id }) => id), ['SA', 'SB', 'BA']);
  const [sa, sb] = modelOrder(root).edges;
  source.outgoing = [sb, sa];
  assert.deepEqual(modelOrder(root).edges.map(({ id }) => id), ['SA', 'SB', 'BA']);
  source.default = undefined;
  assert.deepEqual(modelOrder(root).edges.map(({ id }) => id), ['SB', 'SA', 'BA']);
});

test('chooses DFS back edges only inside SCCs and produces a topological order', () => {
  const ab = { source: 'a', target: 'b', isDefault: true };
  const bc = { source: 'b', target: 'c' };
  const ca = { source: 'c', target: 'a' };
  const cb = { source: 'c', target: 'b' };
  const enter = { source: 's', target: 'a' };
  const exit = { source: 'a', target: 't' };
  const { back, ordered, dag } = orderGraph(['c', 'b', 'a', 's', 't'], [enter, exit, ab, bc, ca, cb], []);
  assert.deepEqual([...back], [ca, cb]);
  assert.deepEqual(ordered, ['s', 'a', 'b', 'c', 't']);
  assert.ok(dag.every(({ source, target }) => ordered.indexOf(source) < ordered.indexOf(target)));
});

test('keeps the default branch continuation forward across lanes in a cycle', async () => {
  const diagram = await readFixture('graph-layout/cycle-across-lanes.bpmn');
  const stages = [];
  const plan = await planGraphLayout(diagram, graphGaps, stages);
  verify(diagram, plan, stages);
  const flows = stages.flatMap(({ flows }) => flows);
  assert.deepEqual(flows.filter(({ back }) => back).map(({ edge }) => edge.id), ['BA']);
  const { source, target } = flows.find(({ edge }) => edge.id === 'AB');
  assert.ok(source.x + source.width <= target.x);
});

test('keeps the acyclic graph forward and directs every data edge to a sink', async () => {
  for (const name of ['acyclic-reorder', 'shared-data']) {
    const diagram = await readFixture(`${name}.bpmn`);
    const stages = [];
    const plan = await planGraphLayout(diagram, graphGaps, stages);
    verify(diagram, plan, stages);
    const [{ elk, flows, units }] = stages;
    assert.ok(flows.every(({ back }) => !back));
    const data = new Set([...units].filter(([figure]) => /Data/.test(figure.type)).map(([, unit]) => unit.key));
    if (name === 'shared-data') assert.equal(data.size, 2);
    for (const { id, sources: [source], targets: [target] } of elk.edges) {
      assert.ok(!data.has(source.replace(/Out$/, '')));
      if (id.startsWith('d')) assert.ok(data.has(target.replace(/In$/, '')));
    }
  }
});

test('routes the self loops through distinct ports on their real endpoints', async () => {
  const diagram = await readFixture('self-loop.bpmn');
  const stages = [];
  const plan = await planGraphLayout(diagram, graphGaps, stages);
  verify(diagram, plan, stages);
  const [{ flows, limits, obstacles, elk }] = stages;
  assert.equal(elk.edges.length, 2);
  for (const flow of flows) {
    const path = pathOf(plan, flow.edge);
    if (!flow.back) {
      assert.equal(simplifyRoute(path).length, 2);
      continue;
    }
    const dx = boxOf(plan, flow.edge.source).x - flow.source.x;
    const dy = boxOf(plan, flow.edge.source).y - flow.source.y;
    const local = path.map(({ x, y }) => ({ x: x - dx, y: y - dy }));
    assert.ok(acceptsRoute(local, flow, limits, obstacles));
    assert.notDeepEqual(local[0], local.at(-1));
    assert.equal(flow.target, obstacles.find((box) => box === flow.target));
    assert.equal(flow.edge.source.id, flow.edge.id === 'EA' ? 'Event' : 'A');
  }
});

test('leaves 16 pixels between a shortcut and the task it bypasses', async () => {
  const diagram = await readFixture('acyclic-reorder.bpmn');
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  const { x, y, width, height } = boxOf(plan, diagram.figures.find(({ id }) => id === 'B'));
  const points = pathOf(plan, diagram.edges.find(({ id }) => id === 'SA'));
  const index = points.findIndex((point, index) => {
    const next = points[index + 1];
    return next?.y === point.y && point.x <= x && next.x >= x + width;
  });
  assert.ok(index >= 0, 'expected a horizontal shortcut spanning task B');
  assert.equal(Math.max(y - points[index].y, points[index].y - (y + height)), 16);
});

test('routes both shortcuts without doubling back and leaves 16 pixels around the bypassed tasks', async () => {
  const diagram = await readFixture('graph-layout/two-shortcuts.bpmn');
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  const first = boxOf(plan, diagram.figures.find(({ id }) => id === 'FirstTask'));
  const last = boxOf(plan, diagram.figures.find(({ id }) => id === 'LastTask'));
  for (const [id, y] of [['FirstShortcut', first.y - 16], ['SecondShortcut', last.y + last.height + 16]]) {
    const points = pathOf(plan, diagram.edges.find((edge) => edge.id === id));
    assert.deepEqual(points.slice(1, -1).map((point) => point.y), [y, y], id);
  }
});

test('keeps same-lane main flows and an unobstructed default flow straight', async () => {
  const diagram = await readFixture('tight-pool.bpmn');
  const flow = diagram.edges.find(({ id }) => id === 'DecisionToEnd');
  flow.source.model.default = flow.model;
  flow.isDefault = true;
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  for (const id of ['StartToReview', 'DecisionToEnd']) {
    assert.equal(simplifyRoute(pathOf(plan, diagram.edges.find((edge) => edge.id === id))).length, 2);
  }
});

test('separates the invoice handoff and timer routes while preserving straight continuations', async () => {
  const diagram = await readFixture('invoice-approval.bpmn');
  const plan = await planGraphLayout(diagram, graphGaps);
  const flow = (id) => pathOf(plan, diagram.edges.find((edge) => edge.id === id));
  assert.equal(plan.reason, undefined);
  assert.deepEqual(routeCost([flow('ForReview'), flow('Late')]).slice(0, 2), [0, 0]);
  assert.deepEqual(routeCost([flow('Approved'), flow('Late')]).slice(0, 2), [0, 0]);
  for (const id of ['Reviewed', 'Pay']) assert.equal(simplifyRoute(flow(id)).length, 2);
});

test('refuses atomically when a note cannot fit without changing process geometry', async () => {
  const diagram = await readFixture('invoice-approval.bpmn');
  const note = diagram.figures.find(({ type }) => type === 'bpmn:TextAnnotation');
  note.box = { ...note.box, width: 50000 };
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, 'annotations');
  assert.equal(plan.boxes.size, 0);
  assert.equal(plan.routes.size, 0);
});

test('refuses groups, missing child lane DI and missing lane membership atomically', async () => {
  const xml = await readFile(new URL('./fixtures/tight-pool.bpmn', import.meta.url), 'utf8');
  const cases = [
    [await readDiagram(xml.replace('</bpmn:process>', '<bpmn:group id="G" /></bpmn:process>')), 'graphGroup'],
    [await readDiagram(xml.replace('</bpmn:lane>', '<bpmn:childLaneSet id="Child"><bpmn:lane id="Nested" /></bpmn:childLaneSet></bpmn:lane>')), 'graphIncomplete'],
    [await readDiagram(xml.replace('<bpmn:flowNodeRef>Start</bpmn:flowNodeRef>', '')), 'graphMissingLane']
  ];
  for (const [diagram, reason] of cases) {
    const result = await planGraphLayout(diagram, graphGaps);
    assert.equal(result.reason, reason);
    assert.equal(result.boxes.size, 0);
    assert.equal(result.routes.size, 0);
    assert.deepEqual(result.skipped, []);
  }
});

test('preserves a fractional pool anchor and ignores old frame sizes', async () => {
  const diagram = await readFixture('pool-subprocess.bpmn');
  const extra = await readFixture('pool-subprocess.bpmn');
  for (const input of [diagram, extra]) {
    const pool = input.figures.find(({ kind }) => kind === 'pool');
    pool.box = { ...pool.box, x: 40.1, y: 40.3 };
  }
  for (const frame of extra.figures.filter((figure) => figure.kind === 'pool' || figure.expanded)) {
    frame.box = { ...frame.box, width: 4200, height: 2400 };
  }
  const stages = [];
  const first = await planGraphLayout(diagram, graphGaps, stages);
  verify(diagram, first, stages);
  const next = await planGraphLayout(extra, graphGaps);
  assert.equal(next.reason, undefined);
  assert.deepEqual(normalized(diagram, first), normalized(extra, next));
  const pool = diagram.figures.find(({ kind }) => kind === 'pool');
  assert.equal(boxOf(first, pool).x, 40.1);
  assert.equal(boxOf(first, pool).y, 40.3);
  apply(diagram, first);
  const repeated = await planGraphLayout(diagram, graphGaps);
  assert.equal(repeated.boxes.size + repeated.routes.size, 0);
});

test('claims the planned routes when an endpoint moves back to a route that already matches', async () => {
  const diagram = await readFixture('vertical-pool.bpmn');
  apply(diagram, await planGraphLayout(diagram, graphGaps));
  const task = diagram.figures.find(({ id }) => id === 'Work');
  task.box = { ...task.box, x: task.box.x + 15 };
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  assert.ok(plan.boxes.has(task));
  assert.equal(plan.routes.size, 2);
  for (const edge of diagram.edges) assert.deepEqual(plan.routes.get(edge), edge.points);
});

test('checks the same obstacle clearance for straight, elbow and grid routes in either direction', () => {
  for (const vertical of [false, true]) {
    const turn = ({ x, y, width, height }) => vertical ? { x: y, y: x, width: height, height: width } :
      { x, y, width, height };
    const source = turn({ x: 0, y: 0, width: 40, height: 40 });
    const target = turn({ x: 160, y: 0, width: 40, height: 40 });
    const bounds = { left: -40, top: -40, right: 240, bottom: 240 };
    const flow = { source, target, vertical, id: 'default', isDefault: true };
    const options = { margin: 16, clearance: 16, minimumClearance: 8, reserveStraight: true, preventReversals: true };
    for (const distance of [0, 7, 8]) {
      const foreign = turn({ x: 80, y: 20 + distance, width: 40, height: 30 });
      const obstacles = [source, target, foreign];
      const path = routeFlows([flow], bounds, obstacles, [], options).get(flow.id);
      assert.ok(acceptsRoute(path, flow, bounds, obstacles, 8));
      assert.equal(path.length === 2, distance === 8);
    }
  }
});

test('lets a boundary event leave locally and rejects a later pass through the host halo', () => {
  const sourceHost = { x: 0, y: 0, width: 100, height: 60 };
  const source = { x: 58, y: 42, width: 36, height: 36 };
  const target = { x: 170, y: 42, width: 50, height: 36 };
  const flow = { id: 'boundary', source, target, sourceHost };
  const bounds = { left: -80, top: -80, right: 260, bottom: 160 };
  const obstacles = [sourceHost, source, target];
  const path = routeFlows([flow], bounds, obstacles, [], {
    margin: 16, clearance: 16, minimumClearance: 8, reserveStraight: true, preventReversals: true
  }).get(flow.id);
  assert.deepEqual(path, [{ x: 94, y: 60 }, { x: 170, y: 60 }]);
  assert.ok(acceptsRoute(path, flow, bounds, obstacles, 8));
  assert.equal(acceptsRoute([
    { x: 76, y: 78 }, { x: 76, y: 96 }, { x: 104, y: 96 },
    { x: 104, y: 60 }, { x: 170, y: 60 }
  ], flow, bounds, obstacles, 8), false);
});

test('preserves offsets for reversed associations and finds the nearest free note position', async () => {
  const diagram = await readFixture('annotation.bpmn');
  const [link] = diagram.auxiliary;
  const { source: task, target: note } = link;
  [link.source, link.target] = [note, task];
  note.box = { ...note.box, y: task.box.y - note.box.height - 5 };
  const plan = await planGraphLayout(diagram, graphGaps);
  assert.equal(plan.reason, undefined);
  assert.deepEqual(
    [boxOf(plan, note).x - boxOf(plan, task).x, boxOf(plan, note).y - boxOf(plan, task).y],
    [note.box.x - task.box.x, note.box.y - task.box.y]
  );

  const nextTask = diagram.figures.find(({ id }) => id === 'Next');
  note.box = { ...note.box, x: task.box.x + boxOf(plan, nextTask).x - boxOf(plan, task).x + 75,
    y: task.box.y + boxOf(plan, nextTask).y - boxOf(plan, task).y + 5 };
  const displaced = await planGraphLayout(diagram, graphGaps);
  assert.equal(displaced.reason, undefined);
  assert.equal(boxOf(displaced, note).x, boxOf(displaced, nextTask).x + nextTask.box.width);
  assert.equal(boxOf(displaced, note).y, boxOf(displaced, nextTask).y + 5);
  apply(diagram, displaced);
  const repeat = await planGraphLayout(diagram, graphGaps);
  assert.equal(repeat.boxes.size + repeat.routes.size, 0);
});

test('opens local room for a long gateway label and verifies the routes again', async () => {
  const diagram = await readFixture('tight-pool.bpmn');
  const gateway = diagram.figures.find(({ id }) => id === 'Decision');
  const baseline = await planGraphLayout(diagram, graphGaps);
  const lane = gateway.lane;
  gateway.labels = [{ x: gateway.box.x - 120, y: gateway.box.y - 28, width: 500, height: 20 }];
  const stages = [];
  const plan = await planGraphLayout(diagram, graphGaps, stages);
  verify(diagram, plan, stages);
  const [label] = plan.labels.get(gateway);
  assert.ok(boxOf(plan, lane).width > boxOf(baseline, lane).width);
  assert.ok(contains(boxOf(plan, lane), label));
  const padded = expandObstacle(label, 8);
  for (const edge of diagram.edges) {
    const path = pathOf(plan, edge);
    assert.ok(!path.slice(1).some((point, index) => cutsInterior(path[index], point, padded)), edge.id);
  }
  apply(diagram, plan);
  const repeat = await planGraphLayout(diagram, graphGaps);
  assert.equal(repeat.reason, undefined);
  assert.equal(repeat.boxes.size + repeat.routes.size, 0);
  assert.deepEqual(repeat.labels.get(gateway), [label]);

  gateway.labels = [{ ...label, width: 50000 }];
  const refused = await planGraphLayout(diagram, graphGaps);
  assert.equal(refused.reason, 'graphGatewayLabel');
  assert.equal(refused.elementId, gateway.id);
  assert.equal(refused.boxes.size + refused.routes.size, 0);
});
