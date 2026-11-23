import assert from 'node:assert/strict';
import test from 'node:test';
import { BpmnModdle } from 'bpmn-moddle';
import { finishCollaborationRoutes } from '../src/graph-layout/collaboration-routes.js';
import { bottom, contains, right, transpose } from '../src/alignment-state.js';
import { intersects } from '../src/layout.js';
import { cutsInterior, routeCost } from '../src/route-flows.js';

function layout(vertical = false) {
  const moddle = new BpmnModdle();
  const root = { id: 'Collaboration', kind: 'root' };
  const figures = [];
  const order = new Map();
  const owner = new Map();
  const messages = [];
  const auxiliary = [];
  const state = { boxes: new Map(), routes: new Map() };

  function shape(id, kind, [x, y, width, height], options = {}) {
    const type = options.type ?? (kind === 'pool' ? 'bpmn:Participant' : 'bpmn:Task');
    const box = { x, y, width, height };
    const figure = { id, kind, type, model: moddle.create(type, { id }), parent: root,
      box: vertical ? transpose(box) : box, horizontal: !vertical, ...options };
    order.set(figure, figures.length);
    figures.push(figure);
    owner.set(figure, kind === 'pool' ? figure : owner.get(figure.parent));
    state.boxes.set(figure, figure.box);
    return figure;
  }

  function connect(id, source, target, extra = {}, type = 'bpmn:MessageFlow') {
    const edge = { id, source, target, type, points: [{ x: -100, y: -100 }, { x: -100, y: 500 }], ...extra };
    (type === 'bpmn:MessageFlow' ? messages : auxiliary).push(edge);
    return edge;
  }

  const run = (obstacles = []) => finishCollaborationRoutes(
    { root, figures }, { messages, auxiliary, order, owner }, state, obstacles, vertical ? 'x' : 'y');
  return { shape, connect, state, run, root };
}

const segments = (points) => points.slice(1).map((point, index) => [points[index], point]);
const crosses = (points, box) => segments(points).some(([a, b]) => cutsInterior(a, b, box));

for (const vertical of [false, true]) {
  const axis = vertical ? 'x' : 'y';
  test(`separates opposing messages directly between mixed participants along ${axis}`, () => {
    const { shape, connect, run } = layout(vertical);
    const sender = shape('Sender', 'pool', [10, 0, 300, 140], { header: 30 });
    const receiver = shape('Receiver', 'pool', [10, 240, 300, 140], { header: 30, horizontal: vertical });
    const delivered = connect('Delivered', sender, receiver);
    const accepted = connect('Accepted', receiver, sender);
    const { routes, reason } = run();
    assert.equal(reason, undefined);
    const [forward, backward] = [delivered, accepted].map((edge) => routes.get(edge));
    assert.equal(forward.length, 2);
    assert.equal(backward.length, 2);
    assert.deepEqual(routeCost([forward, backward]).slice(0, 2), [0, 0]);
    const far = vertical ? right : bottom;
    assert.equal(forward[0][axis], far(sender.box));
    assert.equal(forward.at(-1)[axis], receiver.box[axis]);
    assert.equal(backward[0][axis], receiver.box[axis]);
    assert.equal(backward.at(-1)[axis], far(sender.box));
  });

  test(`leaves nested frames once, bypasses the middle pool and docks on the event along ${axis}`, () => {
    const { shape, connect, run } = layout(vertical);
    const left = shape('Sender', 'pool', [10, 0, 360, 240], { header: 30, horizontal: vertical });
    const expanded = shape('Expanded', 'node', [70, 40, 250, 160],
      { type: 'bpmn:SubProcess', expanded: true, parent: left });
    const nested = shape('Nested', 'node', [95, 80, 180, 100],
      { type: 'bpmn:SubProcess', expanded: true, parent: expanded });
    const child = shape('Send', 'node', [135, 105, 80, 50], { type: 'bpmn:SendTask', parent: nested });
    const middle = shape('Middle', 'pool', [10, 320, 360, 130], { header: 30 });
    const right = shape('Receiver', 'pool', [10, 550, 360, 220], { header: 30 });
    const host = shape('Host', 'node', [100, 610, 130, 80], { parent: right });
    const event = shape('Event', 'artifact', [147, 674, 36, 36], { type: 'bpmn:BoundaryEvent', parent: right, host });
    const message = connect('Delivered', child, event);
    const { routes, reason } = run();
    assert.equal(reason, undefined);
    const path = routes.get(message);
    const reference = [[215, 145], [386, 145], [386, 718], [165, 718], [165, 710]];
    assert.deepEqual(path, reference.map(([x, y]) => vertical ? { x: y, y: x } : { x, y }));
    assert.ok(!crosses(path, middle.box));
    assert.ok(!crosses(path, host.box));
    const header = { ...left.box, ...(left.horizontal ? { width: 30 } : { height: 30 }) };
    assert.ok(!crosses(path, header));
    for (const frame of [left, expanded, nested]) {
      const firstOutside = path.findIndex(({ x, y }) => !contains(frame.box, { x, y, width: 0, height: 0 }));
      assert.ok(firstOutside > 0);
      assert.ok(!crosses(path.slice(firstOutside), frame.box));
    }
    const target = path.at(-1);
    assert.equal(Math.hypot(target.x - event.box.x - 18, target.y - event.box.y - 18), 18);
  });
}

test('uses fixed labels as route obstacles and places message labels from the new path', () => {
  const { shape, connect, run } = layout();
  const sender = shape('Sender', 'pool', [10, 0, 300, 140], { header: 30 });
  const receiver = shape('Receiver', 'pool', [10, 240, 300, 140], { header: 30 });
  const message = connect('Delivery', sender, receiver, { labels: [{ x: -1000, y: 1000, width: 82, height: 20 }] });
  const fixed = { x: 154, y: 170, width: 12, height: 40 };
  const first = run([fixed]);
  const path = first.routes.get(message);
  const [label] = first.labels.get(message);
  assert.ok(!crosses(path, fixed));
  assert.ok(!crosses(path, label));
  assert.ok(!intersects(label, fixed));
  assert.ok(label.y >= bottom(sender.box) && bottom(label) <= receiver.box.y);
  message.points.reverse();
  message.labels[0].x += 10000;
  message.labels[0].y -= 10000;
  assert.deepEqual(run([fixed]), first);
});

test('keeps an association between siblings inside the enclosing subprocess in either direction', () => {
  const { shape, connect, run } = layout();
  const pool = shape('Pool', 'pool', [20, 0, 440, 240], { header: 30 });
  const subprocess = shape('Subprocess', 'node', [70, 20, 360, 200],
    { type: 'bpmn:SubProcess', expanded: true, parent: pool });
  const note = shape('Note', 'artifact', [320, 120, 65, 35], { type: 'bpmn:TextAnnotation', parent: subprocess });
  const task = shape('Task', 'node', [95, 120, 75, 35], { parent: subprocess });
  const toNote = connect('ToNote', task, note, {}, 'bpmn:Association');
  const toTask = connect('ToTask', note, task, {}, 'bpmn:Association');
  const { routes, reason } = run();
  assert.equal(reason, undefined);
  for (const edge of [toNote, toTask]) {
    const path = routes.get(edge);
    assert.ok(path.every(({ x, y }) => contains(subprocess.box, { x, y, width: 0, height: 0 })));
    assert.ok(contains(edge.source.box, { ...path[0], width: 0, height: 0 }));
    assert.ok(contains(edge.target.box, { ...path.at(-1), width: 0, height: 0 }));
  }
});

test('a final association refusal discards routed messages and leaves the fixed geometry untouched', () => {
  const { shape, connect, run, state, root } = layout();
  const sender = shape('Sender', 'pool', [10, 0, 300, 140], { header: 30 });
  const receiver = shape('Receiver', 'pool', [10, 240, 300, 140], { header: 30 });
  const note = shape('Note', 'artifact', [400, 60, 65, 35], { type: 'bpmn:TextAnnotation' });
  connect('Delivery', sender, receiver);
  connect('NoteLink', note, sender, {}, 'bpmn:Association');
  const before = [...state.boxes];
  const result = run([{ x: 390, y: 50, width: 85, height: 55 }]);
  assert.deepEqual(result, { reason: 'graphAssociationRouting', scope: root, elementId: 'NoteLink' });
  assert.deepEqual([...state.boxes], before);
  assert.equal(state.routes.size, 0);
});
