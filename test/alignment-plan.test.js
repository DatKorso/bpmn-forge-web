import assert from 'node:assert/strict';
import test from 'node:test';
import { alignmentSelection, planAlignment, planSelection } from '../src/alignment-plan.js';
import { boundsOf, center, intersects, layoutProcess, translate } from '../src/layout.js';
import { compareCosts, ROUTE_MARGIN, routeCost, routeFlows } from '../src/route-flows.js';

const gaps = { x: 40, y: 30 };
const box = (x, y, width = 100, height = 60) => ({ x, y, width, height });
const point = (x, y) => ({ x, y });

function diagram() {
  const root = { id: 'root', kind: 'root', header: 0, horizontal: true };
  const figures = [];
  const edges = [];

  function add(id, bounds, options = {}) {
    const scope = options.scope ?? root;
    const figure = { id, element: { id }, kind: 'node', type: 'bpmn:Task', box: bounds, scope, parent: scope, header: 0, ...options };
    figures.push(figure);
    return figure;
  }

  function connect(source, target, isDefault = false) {
    const edge = { id: source.id + '-' + target.id, source, target, isDefault };
    edges.push(edge);
    return edge;
  }

  return { root, figures, edges, add, connect };
}

function finalBox(plan, figure) {
  return plan.boxes.get(figure) ?? figure.box;
}

function apply(plan) {
  for (const [figure, next] of plan.boxes) figure.box = next;
  for (const [edge, points] of plan.routes) edge.points = points;
}

test('distinguishes interior crossings, shared lengths and connections meeting at an endpoint', () => {
  const first = [point(0, 0), point(20, 0)];
  assert.deepEqual(routeCost([first, [point(10, -10), point(10, 10)]]), [1, 0, 0, 40]);
  assert.deepEqual(routeCost([first, [point(10, 0), point(30, 0)]]), [0, 10, 0, 40]);
  assert.deepEqual(routeCost([first, [point(20, 0), point(20, 10)]]), [0, 0, 0, 30]);
});

test('routes around an obstacle and gives a self-loop separate entry and exit points', () => {
  const a = box(20, 40, 40, 40);
  const b = box(180, 40, 40, 40);
  const obstacle = box(95, 25, 50, 70);
  const routed = routeFlows([
    { id: 'forward', source: a, target: b },
    { id: 'loop', source: a, target: a, back: true }
  ], { left: 0, top: 0, right: 240, bottom: 120 }, [a, b, obstacle]);
  assert.ok(routed);
  assert.ok(routed.get('forward').some(({ y }) => y < obstacle.y || y > obstacle.y + obstacle.height));
  const loop = routed.get('loop');
  assert.notDeepEqual(loop[0], loop.at(-1));
  assert.ok(loop.length >= 4);
});

test('keeps a straight connection across a gap narrower than the usual routing margin', () => {
  const a = box(0, 0, 40, 40);
  const b = box(42, 0, 40, 40);
  const route = routeFlows([{ id: 'short', source: a, target: b }],
    { left: -10, top: -10, right: 92, bottom: 50 }, [a, b]);
  assert.deepEqual(route.get('short'), [point(40, 20), point(42, 20)]);
});

test('keeps the main row straight and connects bypass branches with one bend each', () => {
  const split = box(65, 155, 50, 50);
  const lower = box(220, 280, 100, 80);
  const middle = box(400, 140, 100, 80);
  const upper = box(580, 0, 100, 80);
  const merge = box(775, 155, 50, 50);
  const flows = [
    { id: '1-split-middle', source: split, target: middle },
    { id: '2-split-lower', source: split, target: lower },
    { id: '3-middle-upper', source: middle, target: upper },
    { id: '4-middle-merge', source: middle, target: merge },
    { id: '5-upper-merge', source: upper, target: merge },
    { id: '6-lower-middle', source: lower, target: middle }
  ];
  const routes = routeFlows(flows, { left: 0, top: -20, right: 960, bottom: 380 },
    [split, lower, middle, upper, merge]);

  assert.deepEqual(routes.get('1-split-middle'), [point(115, 180), point(400, 180)]);
  assert.deepEqual(routes.get('4-middle-merge'), [point(500, 180), point(775, 180)]);
  for (const id of ['2-split-lower', '3-middle-upper', '5-upper-merge', '6-lower-middle']) {
    assert.equal(routes.get(id).length, 3, id);
  }
  assert.deepEqual(routeCost(routes.values()).slice(0, 3), [0, 0, 4]);
});

test('keeps both straight branches when an exclusive gateway also bypasses a lower task', () => {
  for (const spacing of [{ x: 60, y: 40, maxX: 120, maxY: 80 }, { x: 80, y: 80, maxX: 80, maxY: 80 }]) {
    const d = diagram();
    const pool = d.add('Pool', box(0, 0, 720, 405), { kind: 'pool', horizontal: true, header: 30 });
    const add = (id, bounds, type = 'bpmn:Task') => d.add(id, bounds, { scope: pool, type });
    const start = add('Start', box(52, 182, 36, 36), 'bpmn:StartEvent');
    const split = add('Split', box(155, 175, 50, 50), 'bpmn:ExclusiveGateway');
    const middleFirst = add('MiddleFirst', box(270, 160, 100, 80));
    const middleLast = add('MiddleLast', box(430, 160, 100, 80));
    const upper = add('Upper', box(430, 20, 100, 80));
    const lowerFirst = add('LowerFirst', box(270, 265, 100, 80));
    const lowerLast = add('LowerLast', box(430, 265, 100, 80));
    const end = add('End', box(592, 182, 36, 36), 'bpmn:EndEvent');
    const straight = [
      d.connect(start, split), d.connect(split, middleFirst), d.connect(middleFirst, middleLast),
      d.connect(middleLast, end), d.connect(upper, middleLast), d.connect(lowerFirst, lowerLast)
    ];
    d.connect(split, upper);
    d.connect(split, lowerFirst);
    d.connect(lowerLast, end);
    d.connect(split, lowerLast);

    const plan = planAlignment(d, spacing);
    assert.deepEqual(plan.skipped, []);
    for (const flow of straight) {
      assert.equal(plan.routes.get(flow).length, 2, flow.id);
    }
    for (const { source, target } of d.edges) {
      const from = finalBox(plan, source);
      const to = finalBox(plan, target);
      if (source === upper) {
        assert.equal(center(from, 'x'), center(to, 'x'));
      } else {
        assert.ok(to.x - (from.x + from.width) >= spacing.x, source.id + '-' + target.id);
      }
    }
    for (const [flow, points] of plan.routes) {
      assert.ok(points.slice(1).every((point, index) => point.x >= points[index].x), flow.id);
    }
    assert.ok(finalBox(plan, upper).y < finalBox(plan, middleLast).y);
    assert.ok(finalBox(plan, lowerLast).y > finalBox(plan, middleLast).y);

    apply(plan);
    const repeated = planAlignment(d, spacing);
    assert.deepEqual(repeated.skipped, []);
    assert.equal(repeated.boxes.size, 0);
    assert.deepEqual(repeated.routes, plan.routes);
  }
});

test('straightens a chaotically placed default path and reduces crossings at a split and merge', () => {
  const d = diagram();
  const split = d.add('Split', box(260, 160, 50, 50));
  const a = d.add('A', box(500, 120));
  const b = d.add('B', box(10, 360));
  const merge = d.add('Merge', box(10, 170, 50, 50));
  const main = d.connect(split, a, true);
  d.connect(a, merge);
  d.connect(split, b);
  d.connect(b, merge);
  const initial = [
    [point(285, 160), point(285, 150), point(500, 150)],
    [point(550, 180), point(550, 200), point(60, 200)],
    [point(285, 210), point(285, 350), point(60, 350), point(60, 360)],
    [point(110, 390), point(190, 390), point(190, 185), point(60, 185)]
  ];
  const plan = planAlignment(d, gaps);
  assert.deepEqual(plan.skipped, []);
  assert.ok(routeCost(plan.routes.values())[0] < routeCost(initial)[0]);
  assert.ok(finalBox(plan, split).x < finalBox(plan, a).x);
  assert.ok(finalBox(plan, a).x < finalBox(plan, merge).x);
  assert.equal(plan.routes.get(main).length, 2);
  apply(plan);
  const repeated = planAlignment(d, gaps);
  assert.equal(repeated.boxes.size, 0);
  assert.deepEqual(repeated.routes, plan.routes);
});

test('aligns a vertical process across lanes and keeps its original lane assignments', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 400, 550), { kind: 'pool', horizontal: false, header: 30 });
  const left = d.add('Left', box(0, 30, 200, 520), { kind: 'lane', scope: pool, header: 30 });
  const right = d.add('Right', box(200, 30, 200, 520), { kind: 'lane', scope: pool, header: 30 });
  const a = d.add('A', box(30, 100), { scope: pool, lane: left });
  const b = d.add('B', box(250, 190), { scope: pool, lane: right });
  const c = d.add('C', box(240, 330), { scope: pool, lane: right });
  const cross = d.connect(a, b);
  d.connect(b, c);
  const plan = planAlignment(d, gaps);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.routes.get(cross).length, 2);
  assert.equal(center(finalBox(plan, a), 'y'), center(finalBox(plan, b), 'y'));
  assert.ok(finalBox(plan, b).y < finalBox(plan, c).y);
  assert.equal(a.lane, left);
  assert.equal(b.lane, right);
  apply(plan);
  assert.equal(planAlignment(d, gaps).boxes.size, 0);
});

for (const horizontal of [true, false]) {
  test(`keeps 20 units around figures in a ${horizontal ? 'horizontal' : 'vertical'} pool`, () => {
    const d = diagram();
    const orient = ({ x, y, width, height }) => horizontal ? box(x, y, width, height) : box(y, x, height, width);
    const pool = d.add('Pool', orient(box(50, 40, 170, 100)), { kind: 'pool', horizontal, header: 30 });
    const task = d.add('Task', orient(box(80, 40)), { scope: pool });
    const plan = planAlignment(d, gaps);

    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.boxes.has(pool), false);
    assert.deepEqual(finalBox(plan, task), orient(box(100, 60)));
    apply(plan);
    assert.equal(planAlignment(d, gaps).boxes.size, 0);
  });
}

test('grows a tight pool and lane to keep padding around a task and its boundary event', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 145, 85), { kind: 'pool', horizontal: true, header: 30 });
  const lane = d.add('Lane', box(30, 0, 115, 85), { kind: 'lane', scope: pool, header: 30 });
  const task = d.add('Task', box(60, 12, 70, 50), { scope: pool, lane });
  const event = d.add('Boundary', box(112, 44, 36, 36), { kind: 'artifact', scope: pool, host: task });
  const plan = planAlignment(d, gaps);

  assert.deepEqual(plan.skipped, []);
  const frame = finalBox(plan, pool);
  const area = boundsOf([finalBox(plan, task), finalBox(plan, event)]);
  assert.ok(area.x >= 50 && area.y >= 20);
  assert.ok(frame.width - (area.x + area.width) >= 20);
  assert.ok(frame.height - (area.y + area.height) >= 20);
  assert.equal(finalBox(plan, lane).height, frame.height);
  assert.ok(frame.width > pool.box.width && frame.height > pool.box.height);
  apply(plan);
  assert.equal(planAlignment(d, gaps).boxes.size, 0);
});

test('grows a nested subprocess and a lane, shifting a neighboring pool with its contents', () => {
  const d = diagram();
  const pool = d.add('A_Pool', box(0, 0, 320, 200), { kind: 'pool', horizontal: true, header: 30 });
  const lane = d.add('Lane', box(30, 0, 290, 200), { kind: 'lane', scope: pool, header: 30 });
  const sub = d.add('Sub', box(70, 35, 170, 120), { scope: pool, lane, expanded: true, horizontal: true });
  const a = d.add('A', box(80, 55), { scope: sub });
  const b = d.add('B', box(110, 70), { scope: sub });
  const c = d.add('C', box(132, 84), { scope: sub });
  const neighbor = d.add('B_Pool', box(335, 0, 260, 200), { kind: 'pool', horizontal: true, header: 30 });
  const inside = d.add('Neighbor', box(405, 60), { scope: neighbor });
  d.connect(a, b);
  d.connect(b, c);
  const plan = planAlignment(d, gaps);
  assert.deepEqual(plan.skipped, []);
  assert.ok(finalBox(plan, sub).width > sub.box.width);
  assert.ok(finalBox(plan, lane).width > lane.box.width);
  assert.ok(finalBox(plan, pool).width > pool.box.width);
  assert.equal(finalBox(plan, neighbor).x - neighbor.box.x, finalBox(plan, inside).x - inside.box.x);
  assert.ok(finalBox(plan, neighbor).x > neighbor.box.x);
  assert.ok(!intersects(finalBox(plan, neighbor), finalBox(plan, pool)));
  apply(plan);
  assert.equal(planAlignment(d, gaps).boxes.size, 0);
});

test('reuses a row for separate detours and keeps the compact layout on a second run', () => {
  const d = diagram();
  const pool = d.add('pool', box(0, 0, 600, 250), { kind: 'pool', header: 30 });
  const node = (id, bounds, type = 'Task') => d.add(id, bounds, { scope: pool, type: 'bpmn:' + type });
  const start = node('start', box(152, 32, 36, 36), 'StartEvent');
  const first = node('first', box(235, 25, 50, 50), 'ExclusiveGateway');
  const bypass = node('bypass', box(60, 120, 100, 80));
  const task = node('task', box(230, 120, 100, 80));
  const second = node('second', box(375, 135, 50, 50), 'ExclusiveGateway');
  const upper = node('upper', box(320, 10, 100, 80));
  const lower = node('lower', box(440, 120, 100, 80));
  const merge = node('merge', box(535, 45, 50, 50), 'ExclusiveGateway');
  const end = node('end', box(492, 12, 36, 36), 'EndEvent');
  const main = [d.connect(start, first), d.connect(first, task), d.connect(task, second), d.connect(second, lower)];
  d.connect(first, bypass);
  d.connect(bypass, task);
  d.connect(second, upper);
  d.connect(upper, merge);
  d.connect(lower, merge);
  d.connect(merge, end);

  const spacing = { x: 60, y: 40 };
  const plan = planAlignment(d, spacing);
  assert.deepEqual(plan.skipped, []);
  assert.equal(finalBox(plan, pool).height, 250);
  assert.equal(finalBox(plan, bypass).y, finalBox(plan, upper).y);
  assert.equal(finalBox(plan, lower).y - finalBox(plan, upper).y, 120);
  for (const edge of main) assert.equal(plan.routes.get(edge).length, 2);
  assert.deepEqual(routeCost(plan.routes.values()).slice(0, 3), [0, 0, 4]);

  apply(plan);
  const repeated = planAlignment(d, spacing);
  assert.equal(repeated.boxes.size, 0);
  assert.deepEqual(repeated.routes, plan.routes);
});

test('swaps complete neighboring branches when the routed diagram scores better', () => {
  const d = diagram();
  const figures = [
    [321, 124], [43, 174], [245, 144], [335, 82], [217, 4],
    [311, 294], [397, 312], [199, 282], [129, 284], [299, 238]
  ].map(([x, y], index) => d.add('N' + index, index === 0 || index === 9 ? box(x, y, 50, 50) : box(x, y)));
  for (const [first, second] of [[1, 2], [3, 4], [5, 6], [7, 8]]) {
    d.connect(figures[0], figures[first], first === 1);
    d.connect(figures[first], figures[second]);
    d.connect(figures[second], figures[9]);
  }
  // Measure the same routing cost with the original branch order.
  const units = figures.map((figure) => ({ shape: { ...figure.box, id: figure.id }, area: figure.box }));
  const unitByFigure = new Map(figures.map((figure, index) => [figure, units[index]]));
  const graph = d.edges.map((edge) => ({ ...edge, source: unitByFigure.get(edge.source), target: unitByFigure.get(edge.target) }));
  const deltas = layoutProcess(units, graph, gaps);
  const baselineBoxes = new Map(units.map((unit) => [unit, translate(unit.shape, deltas.get(unit))]));
  const obstacles = [...baselineBoxes.values()];
  const area = boundsOf(obstacles);
  const pad = 2 * ROUTE_MARGIN;
  const baseline = routeFlows(graph.map((edge) => ({
    ...edge, source: baselineBoxes.get(edge.source), target: baselineBoxes.get(edge.target)
  })), {
    left: area.x - pad, top: area.y - pad, right: area.x + area.width + pad, bottom: area.y + area.height + pad
  }, obstacles);

  const plan = planAlignment(d, gaps);
  assert.deepEqual(plan.skipped, []);
  assert.ok(compareCosts(routeCost(plan.routes.values()), routeCost(baseline.values())) < 0);
  assert.ok(finalBox(plan, figures[5]).y < finalBox(plan, figures[7]).y);
  assert.equal(finalBox(plan, figures[5]).y, finalBox(plan, figures[6]).y);
  assert.equal(finalBox(plan, figures[7]).y, finalBox(plan, figures[8]).y);
  apply(plan);
  const repeated = planAlignment(d, gaps);
  assert.equal(repeated.boxes.size, 0);
  assert.deepEqual(repeated.routes, plan.routes);
});

test('grows a nested lane and shifts lower lanes and their contents together', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 520, 310), { kind: 'pool', horizontal: true, header: 30 });
  const parent = d.add('Parent lane', box(30, 0, 490, 210), { kind: 'lane', scope: pool, header: 30 });
  const first = d.add('First lane', box(60, 0, 460, 100), { kind: 'lane', scope: pool, parent, header: 30 });
  const second = d.add('Second lane', box(60, 100, 460, 110), { kind: 'lane', scope: pool, parent, header: 30 });
  const lower = d.add('Lower lane', box(30, 210, 490, 100), { kind: 'lane', scope: pool, header: 30 });
  d.add('A', box(100, 10), { scope: pool, lane: first });
  d.add('B', box(100, 35), { scope: pool, lane: first });
  const bottomTask = d.add('C', box(100, 230), { scope: pool, lane: lower });

  const plan = planAlignment(d, gaps);
  assert.deepEqual(plan.skipped, []);
  const firstBox = finalBox(plan, first);
  const secondBox = finalBox(plan, second);
  const parentBox = finalBox(plan, parent);
  const lowerBox = finalBox(plan, lower);
  assert.ok(firstBox.height > first.box.height);
  assert.equal(firstBox.y + firstBox.height, secondBox.y);
  assert.equal(secondBox.y + secondBox.height, parentBox.y + parentBox.height);
  assert.equal(parentBox.y + parentBox.height, lowerBox.y);
  assert.equal(lowerBox.y - lower.box.y, finalBox(plan, bottomTask).y - bottomTask.box.y);
  apply(plan);
  assert.equal(planAlignment(d, gaps).boxes.size, 0);
});

test('routes a return without sharing the forward sequence and preserves a boundary event attachment', () => {
  const d = diagram();
  const a = d.add('A', box(40, 45), { type: 'bpmn:StartEvent' });
  const b = d.add('B', box(280, 40));
  const c = d.add('C', box(540, 50));
  const event = d.add('Boundary', box(322, 82, 36, 36), { kind: 'artifact', host: b });
  d.connect(a, b);
  const forward = d.connect(b, c);
  const back = d.connect(c, b);
  d.connect(event, c);
  const plan = planAlignment(d, gaps);
  assert.deepEqual(plan.skipped, []);
  assert.ok(finalBox(plan, a).x < finalBox(plan, b).x && finalBox(plan, b).x < finalBox(plan, c).x);
  assert.equal(routeCost([plan.routes.get(forward), plan.routes.get(back)])[1], 0);
  assert.ok(plan.routes.get(back).length > 2);
  assert.equal(finalBox(plan, event).x - event.box.x, finalBox(plan, b).x - b.box.x);
  assert.equal(finalBox(plan, event).y - event.box.y, finalBox(plan, b).y - b.box.y);
});

test('keeps an impossible scope unchanged and reports the skipped area', () => {
  const d = diagram();
  const a = d.add('A', box(0, 0));
  const b = d.add('B', box(100, 0));
  d.connect(a, b);
  const plan = planAlignment(d, { x: Number.MAX_SAFE_INTEGER, y: 10 });
  assert.deepEqual(plan.skipped, [{ scope: d.root, reason: 'bounds' }]);
  assert.equal(plan.boxes.size, 0);
  assert.equal(plan.routes.size, 0);
});

for (const horizontal of [true, false]) {
  test(`aligns selected shapes across ${horizontal ? 'horizontal' : 'vertical'} lanes and only routes incident flows`, () => {
    const d = diagram();
    const orient = (x, y, w, h) => horizontal ? box(x, y, w, h) : box(y, x, h, w);
    const pool = d.add('pool', orient(0, 0, 640, 320), { kind: 'pool', horizontal, header: 30 });
    const top = d.add('top', orient(30, 0, 610, 160), { kind: 'lane', scope: pool, header: 30 });
    const bottom = d.add('bottom', orient(30, 160, 610, 160), { kind: 'lane', scope: pool, header: 30 });
    const a = d.add('a', orient(86, 47, 80, 50), { scope: pool, lane: top });
    const b = d.add('b', orient(255, 183, 80, 50), { scope: pool, lane: bottom });
    const fixed = d.add('fixed', orient(420, 55, 80, 50), { scope: pool, lane: top });
    const neighbor = d.add('neighbor', orient(520, 175, 80, 50), { scope: pool, lane: bottom });
    const internal = d.connect(a, b);
    const incident = d.connect(b, fixed);
    const untouched = d.connect(fixed, neighbor);
    untouched.points = [point(500, 80), point(560, 195)];

    const selected = alignmentSelection(d, [a.element, { labelTarget: b.element }]);
    assert.deepEqual(selected, { scope: pool, members: [a, b] });
    assert.ok(alignmentSelection(d, [pool.element, a.element]).reason);
    assert.deepEqual(alignmentSelection(d, [top.element]).members, [a, fixed]);
    const plan = planSelection(d, selected, gaps);
    assert.deepEqual([...plan.boxes.keys()], [a, b]);
    assert.deepEqual(new Set(plan.routes.keys()), new Set([internal, incident]));
    apply(plan);
    const repeated = planSelection(d, selected, gaps);
    assert.equal(repeated.boxes.size, 0);
    assert.equal(repeated.routes.size, 0);
  });
}

test('moves a nested subprocess without flattening its internal geometry', () => {
  const d = diagram();
  const pool = d.add('pool', box(0, 0, 700, 420), { kind: 'pool', horizontal: true, header: 30 });
  const a = d.add('a', box(86, 130, 80, 50), { scope: pool });
  const sub = d.add('sub', box(282, 105, 260, 180), { scope: pool, expanded: true });
  const start = d.add('start', box(307, 141, 36, 36), { scope: sub, type: 'bpmn:StartEvent' });
  const task = d.add('task', box(412, 177, 80, 60), { scope: sub });
  d.connect(a, sub);
  const inside = d.connect(start, task);
  inside.points = [point(343, 159), point(412, 207)];

  assert.ok(alignmentSelection(d, [a.element, task.element]).reason);
  const plan = planSelection(d, alignmentSelection(d, [pool.element]), gaps);
  const moved = plan.boxes.get(sub);
  const delta = { x: moved.x - sub.box.x, y: moved.y - sub.box.y };
  assert.deepEqual(plan.boxes.get(start), translate(start.box, delta));
  assert.deepEqual(plan.boxes.get(task), translate(task.box, delta));
  assert.deepEqual(plan.routes.get(inside), inside.points.map(({ x, y }) => point(x + delta.x, y + delta.y)));
  assert.equal(plan.boxes.has(pool), false);
});

test('declines a fixed selection atomically if spacing or routing cannot fit', () => {
  const d = diagram();
  const pool = d.add('pool', box(0, 0, 500, 300), { kind: 'pool', horizontal: true, header: 30 });
  const top = d.add('top', box(30, 0, 470, 150), { kind: 'lane', scope: pool, header: 30 });
  const bottom = d.add('bottom', box(30, 150, 470, 150), { kind: 'lane', scope: pool, header: 30 });
  const a = d.add('a', box(86, 47, 80, 50), { scope: pool, lane: top });
  const b = d.add('b', box(195, 42, 80, 50), { scope: pool, lane: top });
  const target = d.add('target', box(360, 180, 80, 50), { scope: pool, lane: bottom });
  d.add('wall', box(20, 140, 500, 20), { scope: pool, kind: 'artifact', type: 'bpmn:TextAnnotation' });
  const flow = d.connect(b, target);
  flow.points = [point(275, 67), point(360, 205)];
  const before = d.figures.map((figure) => ({ ...figure.box }));
  const selected = alignmentSelection(d, [top.element]);

  assert.deepEqual(planSelection(d, selected, { x: 800, y: 300 }), { reason: 'collisions' });
  assert.deepEqual(planSelection(d, selected, gaps), { reason: 'routing' });
  assert.deepEqual(d.figures.map((figure) => figure.box), before);
  assert.deepEqual(flow.points, [point(275, 67), point(360, 205)]);
});

test('caps straight flows on each axis and leaves their routes stable on repeated alignment', () => {
  for (const axis of ['x', 'y']) {
    const d = diagram();
    const a = d.add('a', box(0, 0));
    const b = d.add('b', axis === 'x' ? box(400, 0) : box(0, 400));
    const flow = d.connect(a, b);
    const limits = { x: 60, y: 40, maxX: 120, maxY: 80 };
    const plan = planAlignment(d, limits);
    assert.deepEqual(plan.skipped, []);
    assert.equal(finalBox(plan, b)[axis], axis === 'x' ? 220 : 140);
    assert.equal(plan.routes.get(flow).length, 2);
    apply(plan);
    const repeat = planAlignment(d, limits);
    assert.equal(repeat.boxes.size, 0);
    assert.deepEqual(repeat.routes, plan.routes);
  }
});

test('uses world-axis maximums in a vertical pool with a lane', () => {
  const d = diagram();
  const pool = d.add('pool', box(0, 0, 380, 750), { kind: 'pool', horizontal: false, header: 30 });
  const lane = d.add('lane', box(0, 30, 380, 720), { kind: 'lane', scope: pool, header: 30 });
  const a = d.add('a', box(100, 110), { scope: pool, lane });
  const b = d.add('b', box(100, 510), { scope: pool, lane });
  const flow = d.connect(a, b);
  const limits = { x: 60, y: 40, maxX: 120, maxY: 80 };
  for (const plan of [planAlignment(d, limits), planSelection(d, { scope: pool, members: [a, b] }, limits)]) {
    assert.equal(finalBox(plan, b).y - finalBox(plan, a).y - a.box.height, 80);
    assert.equal(plan.routes.get(flow).length, 2);
    assert.equal(plan.boxes.has(pool), false);
    assert.equal(plan.boxes.has(lane), false);
  }
});

test('shortens a selected gap and reroutes its incident flow to a fixed task', () => {
  const d = diagram();
  const a = d.add('a', box(0, 0));
  const b = d.add('b', box(400, 0));
  const fixed = d.add('fixed', box(780, 0));
  const internal = d.connect(a, b);
  const incident = d.connect(b, fixed);
  const selected = { scope: d.root, members: [a, b] };
  const limits = { x: 60, y: 40, maxX: 120, maxY: 80 };
  const plan = planSelection(d, selected, limits);
  assert.equal(finalBox(plan, b).x, 220);
  assert.equal(plan.boxes.has(fixed), false);
  assert.deepEqual(plan.routes.get(internal), [point(100, 30), point(220, 30)]);
  assert.deepEqual(plan.routes.get(incident), [point(320, 30), point(780, 30)]);
  apply(plan);
  const repeat = planSelection(d, selected, limits);
  assert.equal(repeat.boxes.size, 0);
  assert.equal(repeat.routes.size, 0);
});

test('keeps a larger selected gap when shortening would bend a straight flow to a fixed task', () => {
  const d = diagram();
  const a = d.add('a', box(0, 0));
  const b = d.add('b', box(400, 0));
  const fixed = d.add('fixed', box(400, 220));
  d.connect(a, b);
  const incident = d.connect(b, fixed);
  const selected = { scope: d.root, members: [a, b] };
  const limits = { x: 60, y: 40, maxX: 120 };
  const plan = planSelection(d, selected, limits);
  assert.equal(plan.boxes.size, 0);
  assert.equal(plan.routes.size, 0);
  assert.equal(finalBox(plan, b).x, 400);
  assert.equal(incident.points, undefined);
});

test('shortens only the vertical gap when horizontal compression collides with a route obstacle', () => {
  const d = diagram();
  const a = d.add('a', box(0, 0));
  const b = d.add('b', box(400, 0));
  const c = d.add('c', box(0, 400));
  const obstacle = d.add('obstacle', box(230, -10, 60, 80), { kind: 'artifact' });
  const flow = d.connect(a, b);
  const vertical = d.connect(a, c);
  const limits = { x: 60, y: 40, maxX: 120, maxY: 80 };
  const plan = planAlignment(d, limits);
  assert.deepEqual(plan.skipped, []);
  assert.deepEqual([...plan.boxes.keys()], [c]);
  assert.equal(finalBox(plan, c).y, 140);
  assert.ok(plan.routes.get(flow).some(({ y }) => y < obstacle.box.y || y > obstacle.box.y + obstacle.box.height));
  assert.equal(plan.routes.get(vertical).length, 2);
  apply(plan);
  const repeat = planAlignment(d, limits);
  assert.equal(repeat.boxes.size, 0);
  assert.deepEqual(repeat.routes, plan.routes);
});

test('keeps the default branch straight and repeats a compact split and merge without changes', () => {
  const d = diagram();
  const split = d.add('split', box(0, 100, 50, 50));
  const main = d.add('main', box(350, 85, 100, 80));
  const side = d.add('side', box(350, 350, 100, 80));
  const merge = d.add('merge', box(700, 100, 50, 50));
  const direct = d.connect(split, main, true);
  d.connect(main, merge);
  d.connect(split, side);
  d.connect(side, merge);
  const limits = { x: 60, y: 40, maxX: 120, maxY: 80 };
  const plan = planAlignment(d, limits);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.routes.get(direct).length, 2);
  assert.equal(finalBox(plan, side).y - finalBox(plan, main).y - main.box.height, 80);
  assert.ok(finalBox(plan, merge).x - finalBox(plan, split).x < merge.box.x - split.box.x);
  apply(plan);
  const repeat = planAlignment(d, limits);
  assert.equal(repeat.boxes.size, 0);
  assert.deepEqual(repeat.routes, plan.routes);
});
