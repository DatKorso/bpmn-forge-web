import assert from 'node:assert/strict';
import test from 'node:test';
import { alignmentSelection, planAlignment, planSelection } from '../src/alignment-plan.js';
import { boundsOf, center, intersects, layoutProcess, translate } from '../src/layout.js';
import { collaboration, routeMessages } from '../src/pool-layout.js';
import { compareCosts, cutsInterior, ROUTE_MARGIN, routeCost, routeFlows } from '../src/route-flows.js';

const gaps = { x: 40, y: 30 };
const box = (x, y, width = 100, height = 60) => ({ x, y, width, height });
const point = (x, y) => ({ x, y });

function diagram() {
  const root = { id: 'root', kind: 'root', header: 0, horizontal: true };
  const figures = [];
  const edges = [];
  const messageFlows = [];

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

  function message(source, target, points) {
    const edge = { id: source.id + '-' + target.id, source, target, points };
    messageFlows.push(edge);
    return edge;
  }

  return { root, figures, edges, messageFlows, add, connect, message };
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

test('aligns a vertical process and keeps the final node bounds inside their lanes', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 400, 550), { kind: 'pool', horizontal: false, header: 30 });
  const left = d.add('Left', box(0, 30, 200, 520), { kind: 'lane', scope: pool, horizontal: false, header: 30 });
  const right = d.add('Right', box(200, 30, 200, 520), { kind: 'lane', scope: pool, horizontal: false, header: 30 });
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
  assertInside(plan, pool, [a, b, c], 40);
  assertInside(plan, left, [a]);
  assertInside(plan, right, [b, c]);
  apply(plan);
  assert.equal(planAlignment(d, gaps).boxes.size, 0);
});

test('grows a tight pool and lane to keep 40 units around a task and its boundary event', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 145, 85), { kind: 'pool', horizontal: true, header: 30 });
  const lane = d.add('Lane', box(30, 0, 115, 85), { kind: 'lane', scope: pool, header: 30 });
  const task = d.add('Task', box(60, 12, 70, 50), { scope: pool, lane });
  const event = d.add('Boundary', box(112, 44, 36, 36), { kind: 'artifact', scope: pool, host: task });
  const plan = planAlignment(d, gaps);

  assert.deepEqual(plan.skipped, []);
  const frame = finalBox(plan, pool);
  assertInside(plan, pool, [task, event], 40);
  assertInside(plan, lane, [task, event]);
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
  assert.notDeepEqual(delta(plan, neighbor), { x: 0, y: 0 });
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
  assert.equal(finalBox(plan, pool).height, 280);
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

test('rejects a mixed subprocess selection and moves the subprocess intact with its lane', () => {
  const d = diagram();
  const pool = d.add('pool', box(0, 0, 700, 420), { kind: 'pool', horizontal: true, header: 30 });
  const lane = d.add('lane', box(30, 0, 670, 420), { kind: 'lane', scope: pool, header: 30 });
  const a = d.add('a', box(86, 130, 80, 50), { scope: pool, lane });
  const sub = d.add('sub', box(282, 105, 260, 180), { scope: pool, lane, expanded: true, type: 'bpmn:SubProcess' });
  const start = d.add('start', box(307, 141, 36, 36), { scope: sub, type: 'bpmn:StartEvent' });
  const task = d.add('task', box(412, 177, 80, 60), { scope: sub });
  d.connect(a, sub);
  const inside = d.connect(start, task);
  inside.points = [point(343, 159), point(412, 207)];

  assert.deepEqual(alignmentSelection(d, [a.element, sub.element]), {
    reason: 'Выберите один контейнер или несколько отдельных фигур.'
  });
  const plan = planSelection(d, alignmentSelection(d, [lane.element]), gaps);
  assert.equal(plan.reason, undefined);
  const movement = delta(plan, sub);
  assert.notDeepEqual(movement, point(0, 0));
  for (const figure of [sub, start, task]) {
    assert.deepEqual(finalBox(plan, figure), translate(figure.box, movement));
  }
  assert.deepEqual(plan.routes.get(inside), inside.points.map(({ x, y }) => point(x + movement.x, y + movement.y)));
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

for (const horizontal of [true, false]) {
  test(`aligns message endpoints around a ${horizontal ? 'horizontal' : 'vertical'} anchor and preserves its top-left`, () => {
    const d = diagram();
    const world = ([x, y, width, height]) => horizontal ? box(x, y, width, height) : box(y, x, height, width);
    const pool = (id, ...rect) => d.add(id, world(rect), { kind: 'pool', horizontal, header: 30 });
    const task = (id, scope, ...rect) => d.add(id, world(rect), { scope });
    const anchor = pool('Anchor', 100, 400, 600, 200);
    const above = pool('Above', 900, 140, 350, 140);
    const empty = pool('Empty', 700, 660, 350, 140);
    const a = task('A', anchor, 170, 460, 100, 60);
    const b = task('B', anchor, 340, 460, 100, 60);
    const c = task('C', above, 1000, 200, 100, 60);
    const message = d.message(c, a);
    const toFrame = d.message(b, empty);
    const spacing = { x: 110, y: 110, maxX: 120, maxY: 120 };
    const plan = planAlignment(d, spacing);
    assert.deepEqual(plan.skipped, []);
    assert.equal(center(finalBox(plan, a), horizontal ? 'x' : 'y'), center(finalBox(plan, c), horizontal ? 'x' : 'y'));
    assert.deepEqual(finalBox(plan, anchor), anchor.box);
    const cross = horizontal ? 'y' : 'x';
    const dimension = horizontal ? 'height' : 'width';
    assert.ok(anchor.box[cross] - finalBox(plan, above)[cross] - finalBox(plan, above)[dimension] >= 110);
    assert.ok(finalBox(plan, empty)[cross] - anchor.box[cross] - anchor.box[dimension] >= 110);
    assert.equal(plan.routes.get(message).length, 2);
    assert.equal(plan.routes.get(toFrame).at(-1)[cross], finalBox(plan, empty)[cross]);
    apply(plan);
    const repeat = planAlignment(d, spacing);
    assert.equal(repeat.boxes.size, 0);
    assert.deepEqual(repeat.routes.get(message), message.points);
    assert.deepEqual(repeat.routes.get(toFrame), toFrame.points);
  });
}

test('routes around a third pool and docks to the projected position on an empty pool', () => {
  const d = diagram();
  const pool = (id, bounds) => d.add(id, bounds, { kind: 'pool', horizontal: true, header: 30 });
  const a = pool('A', box(0, 0, 440, 180));
  const b = pool('B', box(0, 480, 440, 180));
  const obstacle = pool('Obstacle', box(0, 250, 440, 120));
  const source = d.add('Source', box(250, 60), { scope: a });
  const flow = d.message(source, b);
  const spectator = pool('Spectator', box(520, 250, 440, 120));
  const selection = alignmentSelection(d, [a.element, spectator.element]);
  const plan = planSelection(d, selection, gaps);
  assert.equal(plan.reason, undefined);
  assert.deepEqual(finalBox(plan, a), a.box);
  assert.deepEqual(finalBox(plan, b), b.box);
  const points = plan.routes.get(flow);
  assert.ok(points.length >= 3);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y);
    assert.ok(!cutsInterior(points[i - 1], points[i], finalBox(plan, obstacle)));
  }

  const clear = diagram();
  const from = clear.add('From', a.box, { kind: 'pool', horizontal: true, header: 30 });
  const to = clear.add('To', b.box, { kind: 'pool', horizontal: true, header: 30 });
  const node = clear.add('Node', source.box, { scope: from });
  const direct = clear.message(node, to);
  const result = planSelection(clear, alignmentSelection(clear, [from.element, to.element]), gaps);
  assert.deepEqual(result.routes.get(direct), [point(300, 120), point(300, finalBox(result, to).y)]);
});

test('moves selected pools and their descendants rigidly and leaves stationary participants in place', () => {
  const d = diagram();
  const pool = (id, bounds) => d.add(id, bounds, { kind: 'pool', horizontal: true, header: 30 });
  const a = pool('A', box(0, 0, 600, 200));
  const b = pool('B', box(700, 300, 450, 200));
  const c = pool('C', box(0, 650, 600, 200));
  const node = (id, scope, x, y) => d.add(id, box(x, y), { scope });
  const start = node('Start', a, 200, 60);
  node('Other', a, 350, 60);
  node('Last', a, 480, 60);
  const target = node('Target', b, 810, 360);
  const nested = node('Nested', b, 975, 360);
  const sequence = d.connect(target, nested);
  sequence.points = [point(910, 390), point(975, 390)];
  const message = d.message(start, target);
  const original = target.box;
  const selection = alignmentSelection(d, [a.element, b.element]);
  assert.equal(alignmentSelection(d, [a.element, target.element]).reason, 'Выберите только пулы или фигуры одного процесса');
  const plan = planSelection(d, selection, gaps);
  assert.ok(plan.boxes.has(b));
  assert.ok(!plan.boxes.has(a) && !plan.boxes.has(c) && !plan.boxes.has(start));
  const delta = { x: finalBox(plan, b).x - b.box.x, y: finalBox(plan, b).y - b.box.y };
  assert.deepEqual(finalBox(plan, target), translate(original, delta));
  assert.deepEqual(plan.routes.get(sequence), sequence.points.map(({ x, y }) => point(x + delta.x, y + delta.y)));
  assert.equal(plan.routes.get(message).length, 2);
  apply(plan);
  assert.equal(planSelection(d, selection, gaps).boxes.size, 0);
});

test('rejects a pool selection atomically when an incident message cannot be routed', () => {
  const d = diagram();
  const a = d.add('A', box(0, 0, 450, 150), { kind: 'pool', horizontal: true });
  const b = d.add('B', box(600, 300, 450, 150), { kind: 'pool', horizontal: true });
  const source = d.add('Source', box(100, 30), { scope: a });
  const inside = d.add('Inside', box(750, 350), { scope: b });
  d.add('Blocker', box(700, 330, 220, 110), { kind: 'artifact', scope: b });
  d.message(source, inside);
  const boxes = d.figures.map((figure) => figure.box);
  const result = planSelection(d, alignmentSelection(d, [a.element, b.element]), gaps);
  assert.deepEqual(result, { reason: 'poolRouting' });
  assert.deepEqual(d.figures.map((figure) => figure.box), boxes);
  const global = planAlignment(d, gaps);
  assert.ok(global.skipped.some(({ reason }) => reason === 'poolRouting'));
  assert.equal(global.boxes.size, 0);
  assert.equal(global.routes.size, 0);
});

test('repairs a message between stationary pools when another pool moves across its path', () => {
  const d = diagram();
  const pool = (id, bounds) => d.add(id, bounds, { kind: 'pool', horizontal: true, header: 30 });
  const sender = pool('Sender', box(0, 0, 440, 150));
  const receiver = pool('Receiver', box(0, 550, 440, 150));
  const blocking = pool('Blocking', box(510, 250, 440, 150));
  const a = d.add('A', box(150, 45), { scope: sender });
  const b = d.add('B', box(150, 595), { scope: receiver });
  const message = d.message(a, b, [point(200, 105), point(200, 595)]);
  const collab = collaboration(d.figures, d.messageFlows);
  const original = { boxes: new Map(d.figures.map((figure) => [figure, figure.box])), routes: new Map() };
  const moved = box(0, 250, 440, 150);
  const planned = { boxes: new Map(original.boxes).set(blocking, moved) };
  const routes = routeMessages(collab, planned, original, { selection: true });
  const points = routes.get(message);
  assert.notDeepEqual(points, message.points);
  assert.ok(points.slice(1).every((end, i) => !cutsInterior(points[i], end, moved)));
});

test('fits one selected pool and reroutes messages while the other pool stays fixed', () => {
  const d = diagram();
  const a = d.add('A', box(0, 0, 620, 270), { kind: 'pool', horizontal: true, header: 30 });
  const b = d.add('B', box(100, 400, 430, 200), { kind: 'pool', horizontal: true, header: 30 });
  const start = d.add('Start', box(90, 120), { scope: a });
  const end = d.add('End', box(250, 60), { scope: a });
  const outside = d.add('Outside', box(170, 480), { scope: b });
  d.connect(start, end);
  const message = d.message(end, outside);
  const plan = planSelection(d, alignmentSelection(d, [a.element]), gaps);
  assert.equal(plan.reason, undefined);
  assert.ok(plan.boxes.has(start) || plan.boxes.has(end));
  assert.deepEqual(finalBox(plan, a), box(0, 0, 370, 150));
  assert.ok(!plan.boxes.has(b) && !plan.boxes.has(outside));
  assert.equal(center(finalBox(plan, start), 'y'), center(finalBox(plan, end), 'y'));
  assert.ok(plan.routes.has(message));
});

function annotate(d, id, bounds, anchor, options = {}) {
  const { reverse, ...figure } = options;
  const note = d.add(id, bounds, { kind: 'artifact', type: 'bpmn:TextAnnotation', ...figure });
  const association = associate(d, reverse ? note : anchor, reverse ? anchor : note);
  return { note, association };
}

function associate(d, source, target) {
  const edge = { id: source.id + '_' + target.id, type: 'bpmn:Association', source, target };
  (d.auxiliary ??= []).push(edge);
  return edge;
}

function delta(plan, figure) {
  const { x, y } = finalBox(plan, figure);
  return { x: x - figure.box.x, y: y - figure.box.y };
}

function assertDocked(plan, edge, obstacles = []) {
  const points = plan.routes.get(edge);
  const onBoundary = ({ x, y }, bounds) => x >= bounds.x && x <= bounds.x + bounds.width &&
    y >= bounds.y && y <= bounds.y + bounds.height &&
    (x === bounds.x || x === bounds.x + bounds.width || y === bounds.y || y === bounds.y + bounds.height);
  assert.ok(points?.length >= 2, edge.id);
  assert.ok(onBoundary(points[0], finalBox(plan, edge.source)), edge.id);
  assert.ok(onBoundary(points.at(-1), finalBox(plan, edge.target)), edge.id);
  assert.ok(obstacles.every((figure) => points.slice(1).every((point, i) =>
    !cutsInterior(points[i], point, finalBox(plan, figure)))), edge.id);
}

test('moves an annotation by its anchor delta and leaves an unrelated annotation in place', () => {
  const d = diagram();
  const a = d.add('A', box(103, 103));
  const b = d.add('B', box(373, 133));
  d.connect(a, b);
  const { note, association } = annotate(d, 'Note', box(90, 10, 100, 40), a);
  const fixed = d.add('Unlinked', box(250, -50, 100, 40), { kind: 'artifact', type: 'bpmn:TextAnnotation' });

  const plan = planAlignment(d, gaps);
  assert.equal(plan.reason, undefined);
  assert.notDeepEqual(delta(plan, a), { x: 0, y: 0 });
  assert.deepEqual(delta(plan, note), delta(plan, a));
  assert.equal(plan.boxes.has(fixed), false);
  assertDocked(plan, association, [b]);
  apply(plan);
  const repeated = planAlignment(d, gaps);
  assert.equal(repeated.boxes.size, 0);
  assert.deepEqual(repeated.routes.get(association), undefined);
});

test('places nearby annotations in order around labels, figures and each other', () => {
  const d = diagram();
  const a = d.add('A', box(103, 103));
  const b = d.add('B', box(373, 133));
  d.connect(a, b);
  const { note: first, association } = annotate(d, 'First', box(100, 20, 60, 40), a);
  const { note: second } = annotate(d, 'Second', box(112, 30, 60, 40), a);
  const plain = planAlignment({ ...d, figures: [a, b], auxiliary: [] }, gaps);
  const target = translate(first.box, delta(plain, a));
  const obstacle = d.add('Obstacle', box(target.x + 45, target.y, 60, 40), { kind: 'artifact',
    labels: [box(target.x + 45, target.y - 40, 60, 35)] });

  const plan = planAlignment(d, gaps);
  assert.equal(plan.reason, undefined);
  assert.deepEqual(finalBox(plan, first), translate(target, { x: -23, y: 0 }));
  assert.equal(intersects(finalBox(plan, first), finalBox(plan, second)), false);
  assert.equal(intersects(finalBox(plan, second), obstacle.labels[0]), false);
  assertDocked(plan, association, [obstacle, second]);
});

test('uses the nearest moving anchor for reverse and multiple associations, breaking ties by BPMN ID', () => {
  const d = diagram();
  const left = d.add('Z', box(103, 103));
  const right = d.add('A', box(367, 103));
  d.connect(left, right);
  const { note, association } = annotate(d, 'Note', box(255, 10, 60, 40), left, { reverse: true });
  const other = associate(d, right, note);

  const plan = planAlignment(d, gaps);
  assert.equal(plan.reason, undefined);
  assert.notDeepEqual(delta(plan, left), delta(plan, right));
  assert.deepEqual(delta(plan, note), delta(plan, right));
  assertDocked(plan, association);
  assertDocked(plan, other);
});

test('keeps a collaboration annotation within the pool and subprocess of its anchor', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 550, 420), { kind: 'pool', header: 30, horizontal: true });
  const subprocess = d.add('Subprocess', box(60, 50, 440, 300), { scope: pool, expanded: true });
  const a = d.add('A', box(103, 173), { scope: subprocess });
  const b = d.add('B', box(365, 193), { scope: subprocess });
  d.connect(a, b);
  const { note, association } = annotate(d, 'CollaborationNote', box(110, 85, 70, 50), a);

  const plan = planAlignment(d, gaps);
  assert.equal(plan.reason, undefined);
  assert.notDeepEqual(delta(plan, note), { x: 0, y: 0 });
  const rect = finalBox(plan, subprocess);
  assert.deepEqual(boundsOf([rect, finalBox(plan, note)]), rect);
  assert.equal(note.parent, d.root);
  assertDocked(plan, association);
});

for (const horizontal of [true, false]) {
  test(`grows the ${horizontal ? 'bottom of a horizontal' : 'right of a vertical'} lane and shifts its neighbor with its contents`, () => {
    const d = diagram();
    const orient = (x, y, width, height) => horizontal ? box(x, y, width, height) : box(y, x, height, width);
    const pool = d.add('Pool', orient(0, 0, 420, 300), { kind: 'pool', header: 30, horizontal });
    const lane = d.add('Lane', orient(30, 0, 390, 150), { kind: 'lane', scope: pool, header: 30, horizontal });
    const neighbor = d.add('Neighbor', orient(30, 150, 390, 150), {
      kind: 'lane', scope: pool, header: 30, horizontal
    });
    const a = d.add('A', orient(87, 38, 100, 70), { scope: pool, lane });
    const b = d.add('B', orient(250, 50, 100, 70), { scope: pool, lane });
    const fixed = d.add('Fixed', orient(100, 190, 80, 60), { scope: pool, lane: neighbor });
    d.connect(a, b);
    const crossLane = d.connect(b, fixed);
    const { note, association } = annotate(d, 'Note', orient(72, 12, 300, 110), a, { scope: pool });

    const plan = planAlignment(d, gaps);
    assert.equal(plan.reason, undefined);
    const span = horizontal ? 'height' : 'width';
    const axis = horizontal ? 'y' : 'x';
    assert.ok(finalBox(plan, lane)[span] > lane.box[span]);
    assert.ok(finalBox(plan, pool)[span] > pool.box[span]);
    assert.ok(delta(plan, neighbor)[axis] > 0);
    assert.equal(delta(plan, neighbor)[axis], delta(plan, fixed)[axis]);
    assert.equal(intersects(finalBox(plan, a), finalBox(plan, note)), false);
    assertDocked(plan, association, [b]);
    assertDocked(plan, crossLane, [note, a]);
    apply(plan);
    const repeated = planAlignment(d, gaps);
    assert.equal(repeated.reason, undefined);
    assert.equal(repeated.boxes.size, 0);
    for (const [edge, points] of repeated.routes) assert.deepEqual(points, edge.points);
  });
}

test('grows a nested subprocess to hold an annotation in a new strip', () => {
  const d = diagram();
  const outer = d.add('Outer', box(0, 0, 520, 235), { expanded: true, horizontal: true });
  const inner = d.add('Inner', box(30, 30, 420, 165), { scope: outer, expanded: true, horizontal: true });
  const a = d.add('A', box(71, 77), { scope: inner });
  const b = d.add('B', box(277, 86), { scope: inner });
  d.connect(a, b);
  const { note, association } = annotate(d, 'Note', box(51, 45, 340, 115), a, { scope: inner });

  const plan = planAlignment(d, gaps);
  assert.equal(plan.reason, undefined);
  assert.ok(finalBox(plan, inner).height > inner.box.height);
  assert.ok(finalBox(plan, outer).height > outer.box.height);
  assert.deepEqual(boundsOf([finalBox(plan, inner), finalBox(plan, note)]), finalBox(plan, inner));
  assertDocked(plan, association, [b]);
});

test('selection moves an unselected annotation and leaves neighboring figures fixed', () => {
  const d = diagram();
  const a = d.add('A', box(103, 103));
  const b = d.add('B', box(373, 133));
  const fixed = d.add('Fixed', box(400, 300));
  d.connect(a, b);
  const { note, association } = annotate(d, 'Note', box(90, 10, 100, 40), a);

  const plan = planSelection(d, alignmentSelection(d, [a.element, b.element]), gaps);
  assert.equal(plan.reason, undefined);
  assert.notDeepEqual(delta(plan, a), { x: 0, y: 0 });
  assert.deepEqual(delta(plan, note), delta(plan, a));
  assert.equal(plan.boxes.has(fixed), false);
  assertDocked(plan, association, [b, fixed]);
});

test('only an explicitly selected container can grow for its annotation', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 420, 160), { kind: 'pool', header: 30, horizontal: true });
  const a = d.add('A', box(87, 40, 100, 70), { scope: pool });
  const b = d.add('B', box(250, 52, 100, 70), { scope: pool });
  d.connect(a, b);
  const fixed = d.add('OtherPool', box(0, 320, 420, 180), { kind: 'pool', header: 30, horizontal: true });
  const { note, association } = annotate(d, 'Note', box(62, 25, 300, 100), a, { scope: pool });
  const source = d.figures.map(({ box }) => ({ ...box }));

  const refused = planSelection(d, alignmentSelection(d, [a.element, b.element]), gaps);
  assert.deepEqual(refused, { reason: 'annotations' });
  assert.deepEqual(d.figures.map(({ box }) => box), source);
  assert.equal(association.points, undefined);

  const plan = planSelection(d, alignmentSelection(d, [pool.element]), gaps);
  assert.equal(plan.reason, undefined);
  assert.ok(finalBox(plan, pool).height > pool.box.height);
  assert.equal(plan.boxes.has(fixed), false);
  assert.equal(intersects(finalBox(plan, note), finalBox(plan, a)), false);
  assertDocked(plan, association, [b]);

  fixed.box = box(0, 165, 420, 180);
  assert.deepEqual(planSelection(d, alignmentSelection(d, [pool.element]), gaps), { reason: 'annotations' });
});

test('refuses an impossible full annotation layout without applying any geometry', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 420, 160), { kind: 'pool', header: 30, horizontal: true });
  const a = d.add('A', box(87, 40, 100, 70), { scope: pool });
  const b = d.add('B', box(250, 52, 100, 70), { scope: pool });
  d.connect(a, b);
  annotate(d, 'Oversized', box(10, 25, 500, 100), a, { scope: pool });
  const plan = planAlignment(d, gaps);
  assert.equal(plan.reason, 'annotations');
  assert.equal(plan.boxes.size, 0);
  assert.equal(plan.routes.size, 0);
});

function timerBranch() {
  const d = diagram();
  const start = d.add('start', box(-18, 352, 36, 36), { type: 'bpmn:StartEvent' });
  const analysis = d.add('analysis', box(520, 330, 100, 80));
  const split = d.add('split', box(415, 55, 50, 50), { type: 'bpmn:ExclusiveGateway' });
  const timer = d.add('timer', box(452, -18, 36, 36), { type: 'bpmn:IntermediateCatchEvent' });
  const edits = d.add('edits', box(800, 40, 100, 80));
  const task0 = d.add('task0', box(530, 60, 100, 80));
  const task1 = d.add('task1', box(510, 390, 100, 80));
  const direct = d.connect(start, analysis);
  d.connect(analysis, task0);
  d.connect(task0, task1);
  d.connect(task1, split);
  d.connect(split, edits);
  const entry = d.connect(split, timer);
  const exit = d.connect(timer, analysis);
  return { d, split, timer, analysis, direct, entry, exit };
}

const timerSpacing = { x: 60, y: 40, maxX: 120, maxY: 80 };

test('routes a one-node branch between rows and preserves the straight incoming flow on repeat', () => {
  const { d, split, timer, analysis, direct, entry, exit } = timerBranch();
  const plan = planAlignment(d, timerSpacing);
  const timerBox = finalBox(plan, timer);
  assert.deepEqual(plan.skipped, []);
  assert.equal(timerBox.x, 462);
  assert.ok(timerBox.y >= finalBox(plan, split).y + split.box.height);
  assert.ok(timerBox.y + timerBox.height <= finalBox(plan, analysis).y);
  assert.equal(plan.routes.get(entry).length, 3);
  assert.equal(plan.routes.get(exit).length, 3);
  assert.equal(plan.routes.get(direct).length, 2);

  apply(plan);
  const repeated = planAlignment(d, timerSpacing);
  assert.equal(repeated.boxes.size, 0);
  for (const [edge, path] of repeated.routes) assert.deepEqual(path, edge.points);
});

test('keeps a one-node branch clear of an occupied gap and preserves the straight incoming flow', () => {
  const { d, split, timer, analysis, direct, entry, exit } = timerBranch();
  const obstacle = d.add('artifact', box(470, 190, 20, 80), { kind: 'artifact', type: 'bpmn:DataObjectReference' });
  const plan = planAlignment(d, timerSpacing);
  assert.deepEqual(plan.skipped, []);
  const node = finalBox(plan, timer);
  const splitBox = finalBox(plan, split);
  const analysisBox = finalBox(plan, analysis);
  assert.ok(node.y + node.height <= splitBox.y + splitBox.height || node.y >= analysisBox.y);
  for (const edge of [entry, exit, direct]) assertDocked(plan, edge, [obstacle]);
  const [start, end] = plan.routes.get(direct);
  assert.equal(plan.routes.get(direct).length, 2);
  assert.equal(start.y, end.y);
});

test('gives a one-node branch enough clearance from the neighboring row', () => {
  const d = diagram();
  const pool = d.add('Pool', box(10, 880, 4150, 560), { kind: 'pool', horizontal: true, header: 30 });
  const add = (id, bounds, type = 'Task', options = {}) =>
    d.add(id, bounds, { scope: pool, type: 'bpmn:' + type, ...options });
  const split = add('Review', box(3855, 1037, 50, 50), 'ExclusiveGateway');
  const edits = add('Edits', box(3960, 1022, 100, 80), 'ManualTask');
  const timer = add('Timer', box(3962, 1162, 36, 36), 'IntermediateCatchEvent');
  const start = add('Start', box(132, 1146, 36, 36), 'StartEvent');
  add('Development', box(1390, 920, 903, 262), 'SubProcess', { expanded: true });
  const prepare = add('Prepare', box(670, 1022, 100, 80));
  const send = add('Send', box(520, 1022, 100, 80));
  const analysis = add('Analysis', box(280, 1124, 100, 80));
  const next = add('Next', box(412, 1139, 50, 50), 'ExclusiveGateway');
  d.connect(send, prepare);
  d.connect(next, send);
  d.connect(analysis, next);
  const direct = d.connect(start, analysis);
  d.connect(split, edits);
  const entry = d.connect(split, timer);
  const exit = d.connect(timer, analysis);

  const spacing = { x: 90, y: 90 };
  const plan = planAlignment(d, spacing);
  const timerBox = finalBox(plan, timer);
  const editsBox = finalBox(plan, edits);
  assert.deepEqual(plan.skipped, []);
  assert.equal(timerBox.x, 1232);
  assert.ok(timerBox.y - (editsBox.y + editsBox.height) >= spacing.y);
  assert.ok(timerBox.y + timerBox.height <= finalBox(plan, analysis).y);
  assert.equal(plan.routes.get(entry).length, 3);
  assert.equal(plan.routes.get(exit).length, 3);
  assert.equal(plan.routes.get(direct).length, 2);

  apply(plan);
  const repeated = planAlignment(d, spacing);
  assert.equal(repeated.boxes.size, 0);
  for (const [edge, path] of repeated.routes) assert.deepEqual(path, edge.points);
});

test('routes a one-node branch between columns in a vertical pool', () => {
  const { d, split, timer, analysis, direct, entry, exit } = timerBranch();
  const nodes = [...d.figures];
  const pool = d.add('pool', box(-100, -150, 750, 1300), { kind: 'pool', horizontal: false, header: 30 });
  for (const node of nodes) {
    const { x, y, width, height } = node.box;
    node.box = box(y, x, height, width);
    node.scope = node.parent = pool;
  }
  const plan = planAlignment(d, { x: 40, y: 60, maxX: 80, maxY: 120 });
  const timerBox = finalBox(plan, timer);
  assert.deepEqual(plan.skipped, []);
  assert.equal(timerBox.y, 462);
  assert.ok(timerBox.x >= finalBox(plan, split).x + split.box.width);
  assert.ok(timerBox.x + timerBox.width <= finalBox(plan, analysis).x);
  assert.equal(plan.routes.get(entry).length, 3);
  assert.equal(plan.routes.get(exit).length, 3);
  assert.equal(plan.routes.get(direct).length, 2);
});

test('limits gateway label placement to the selected gateways and selected container descendants', () => {
  const d = diagram();
  const pool = d.add('pool', box(0, 0, 780, 400), { kind: 'pool', horizontal: true, header: 30 });
  const inside = { scope: pool, type: 'bpmn:ExclusiveGateway' };
  const selected = d.add('selected', box(115, 65, 50, 50), inside);
  const neighbor = d.add('neighbor', box(415, 185, 50, 50), inside);
  const task = d.add('task', box(210, 60), { scope: pool });
  d.connect(selected, task);
  const outside = d.add('outside', box(815, 185, 50, 50), { type: 'bpmn:ExclusiveGateway' });

  const plan = planSelection(d, alignmentSelection(d, [selected.element, task.element]), gaps);
  assert.deepEqual(plan.labelGateways, [selected]);
  assert.ok(!plan.boxes.has(neighbor));
  const poolPlan = planSelection(d, alignmentSelection(d, [pool.element]), gaps);
  assert.deepEqual(poolPlan.labelGateways, [selected, neighbor]);
  assert.ok(!poolPlan.boxes.has(outside));
});

function assertInside(plan, frame, members, inset = 0) {
  const rect = finalBox(plan, frame);
  const area = boundsOf(members.map((member) => finalBox(plan, member)));
  assert.ok(area.x - rect.x >= inset + (frame.horizontal === false ? 0 : frame.header));
  assert.ok(area.y - rect.y >= inset + (frame.horizontal === false ? frame.header : 0));
  assert.ok(rect.x + rect.width - area.x - area.width >= inset);
  assert.ok(rect.y + rect.height - area.y - area.height >= inset);
}

function assertStableSelection(d, scope, plan) {
  apply(plan);
  const repeat = planSelection(d, alignmentSelection(d, [scope.element]), gaps);
  assert.equal(repeat.reason, undefined);
  assert.equal(repeat.boxes.size, 0);
  for (const [edge, points] of repeat.routes) assert.deepEqual(points, edge.points);
}

for (const horizontal of [true, false]) {
  test(`fits nested lanes in a selected ${horizontal ? 'horizontal' : 'vertical'} pool`, () => {
    const d = diagram();
    const orient = (x, y, w, h) => horizontal ? box(x, y, w, h) : box(y, x, h, w);
    const pool = d.add('Pool', orient(10, 20, 950, 750), { kind: 'pool', horizontal, header: 30 });
    const lane = d.add('First', orient(40, 20, 920, 500), { kind: 'lane', scope: pool, horizontal, header: 30 });
    const inner = d.add('Inner', orient(70, 20, 890, 350),
      { kind: 'lane', scope: pool, parent: lane, horizontal, header: 30 });
    const empty = d.add('Empty', orient(70, 370, 890, 150),
      { kind: 'lane', scope: pool, parent: lane, horizontal, header: 30 });
    const last = d.add('Last', orient(40, 520, 920, 250), { kind: 'lane', scope: pool, horizontal, header: 30 });
    const first = d.add('A', orient(148, 70, 100, 60), { scope: pool, lane: inner });
    const second = d.add('B', orient(500, 557, 100, 60), { scope: pool, lane: last });
    const event = d.add('Event', orient(548, 599, 36, 36), { kind: 'artifact', host: second, scope: pool });
    const edge = d.connect(first, second);
    const plan = planSelection(d, alignmentSelection(d, [pool.element]), gaps);
    assert.equal(plan.reason, undefined);
    assertInside(plan, pool, [first, second, event], 40);
    const local = ({ x, y, width, height }) => orient(x, y, width, height);
    const [p, l, i, e, b] = [pool, lane, inner, empty, last].map((figure) => local(finalBox(plan, figure)));
    assert.ok(p.width < 950 && p.height < 750);
    assert.deepEqual([p.x, p.y], [10, 20]);
    assert.equal(i.x, l.x + 30);
    assert.equal(i.y + i.height, e.y);
    assert.equal(e.y + e.height, l.y + l.height);
    assert.equal(l.y + l.height, b.y);
    assert.equal(b.y + b.height, p.y + p.height);
    assert.equal(i.x + i.width, p.x + p.width);
    assertInside(plan, inner, [first]);
    assertInside(plan, last, [second, event]);
    assertDocked(plan, edge);
    assertStableSelection(d, pool, plan);
  });
}

test('fits two subprocess levels, keeps labels and annotations inside, and preserves external docking', () => {
  const d = diagram();
  const outer = d.add('Outer', box(100, 120, 860, 430), { expanded: true });
  const inner = d.add('Inner', box(200, 195, 175, 140), { scope: outer, expanded: true });
  const a = d.add('A', box(220, 220, 100, 60), { scope: inner, labels: [box(219, 285, 100, 42)] });
  const b = d.add('B', box(255, 247, 80, 60), { scope: inner });
  const inside = d.connect(a, b);
  inside.projectLabels = (points) => points?.map(({ x, y }) => box(x - 20, y - 15, 40, 12));
  const { note, association } = annotate(d, 'Note', box(250, 300, 110, 80), b, { scope: inner });
  const collapsed = d.add('Collapsed', box(570, 215, 100, 80), { scope: outer, type: 'bpmn:SubProcess' });
  const event = d.add('Boundary', box(800, 532, 36, 36), { kind: 'artifact', host: outer });
  const outside = d.add('Outside', box(1000, 700));
  const external = d.connect(event, outside);
  const fromFrame = d.connect(outer, outside);
  d.connect(inner, collapsed);

  const plan = planSelection(d, alignmentSelection(d, [outer.element]), gaps);
  assert.equal(plan.reason, undefined);
  const outerBox = finalBox(plan, outer);
  const innerBox = finalBox(plan, inner);
  assert.deepEqual([outerBox.x, outerBox.y], [100, 120]);
  assert.ok(outerBox.width < outer.box.width);
  assert.ok(innerBox.width > inner.box.width);
  assertInside(plan, outer, [inner, collapsed], 40);
  assertInside(plan, inner, [a, b], 40);
  assert.equal(finalBox(plan, event).y + 18, outerBox.y + outerBox.height);
  assert.equal(finalBox(plan, collapsed).width, collapsed.box.width);
  assert.deepEqual(boundsOf([innerBox, finalBox(plan, note), translate(a.labels[0], delta(plan, a))]), innerBox);
  for (const edge of [inside, association, external, fromFrame]) assertDocked(plan, edge);
  assert.ok(!plan.boxes.has(outside));
  a.labels = a.labels.map((label) => translate(label, delta(plan, a)));
  assertStableSelection(d, outer, plan);
});

test('grows a tight selected pool while leaving empty containers at their original size', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 180, 105), { kind: 'pool', header: 30 });
  const empty = d.add('Empty', box(61, 15, 165, 125), { scope: pool, expanded: true });
  const end = d.add('End', box(96, 35), { scope: pool });
  d.connect(empty, end);
  const plan = planSelection(d, alignmentSelection(d, [pool.element]), gaps);
  assert.equal(plan.reason, undefined);
  assertInside(plan, pool, [empty, end], 40);
  assert.ok(finalBox(plan, pool).width > pool.box.width);
  assert.equal(finalBox(plan, empty).width, empty.box.width);
  assert.equal(finalBox(plan, empty).height, empty.box.height);
  assertStableSelection(d, pool, plan);
});

test('refuses to grow a selected subprocess through its parent or a stationary sibling', () => {
  const d = diagram();
  const pool = d.add('Pool', box(0, 0, 300, 240), { kind: 'pool', header: 30 });
  const sub = d.add('Sub', box(70, 40, 140, 120), { scope: pool, expanded: true });
  const a = d.add('A', box(82, 48), { scope: sub });
  const b = d.add('B', box(90, 55), { scope: sub });
  const edge = d.connect(a, b);
  edge.points = [point(132, 48), point(140, 115)];
  const selection = alignmentSelection(d, [sub.element]);
  function assertUnchangedOnRefusal() {
    const boxes = structuredClone(d.figures.map((figure) => figure.box));
    const points = structuredClone(edge.points);
    assert.deepEqual(planSelection(d, selection, gaps), { reason: 'collisions' });
    assert.deepEqual(d.figures.map((figure) => figure.box), boxes);
    assert.deepEqual(edge.points, points);
  }
  assertUnchangedOnRefusal();
  pool.box = box(0, 0, 900, 400);
  const sibling = d.add('Sibling', box(235, 75), { scope: pool });
  assertUnchangedOnRefusal();
  sibling.box = box(650, 75);
  const plan = planSelection(d, selection, gaps);
  assert.equal(plan.reason, undefined);
  assert.ok(finalBox(plan, sub).width > sub.box.width);
  assertInside(plan, sub, [a, b], 40);
  assert.ok(!plan.boxes.has(pool) && !plan.boxes.has(sibling));
  assertStableSelection(d, sub, plan);
});
