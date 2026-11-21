import assert from 'node:assert/strict';
import test from 'node:test';
import { boundsOf, center, layoutRegion, translate } from '../src/layout.js';

const unbounded = { left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity };
const gaps = { x: 80, y: 60 };

function unit(id, x, y, width = 100, height = 80, attachers = []) {
  const shape = { id, x, y, width, height };
  return { shape, area: boundsOf([shape, ...attachers]) };
}

function apply(units, layout) {
  return units.map(({ shape, area }, index) => ({
    shape: { ...shape, ...translate(shape, layout.get(units[index])) },
    area: translate(area, layout.get(units[index]))
  }));
}

function flowsFor(units, pairs) {
  const byId = new Map(units.map((node) => [node.shape.id, node]));
  return pairs.map(([from, to, isDefault = false]) => ({
    id: `${from}-${to}`,
    source: byId.get(from),
    target: byId.get(to),
    isDefault
  }));
}

test('aligns a linear process, increases tight gaps, and preserves a wide gap', () => {
  const units = [
    unit('start', 36, 82, 36, 36),
    unit('task', 91, 64),
    unit('end', 341, 86, 36, 36)
  ];
  const [start, task, end] = apply(units, layoutRegion(units, unbounded, gaps)).map(({ shape }) => shape);
  assert.deepEqual([start, task, end].map((shape) => center(shape, 'y')), [100, 100, 100]);
  assert.ok(task.x - (start.x + start.width) >= 80);
  assert.ok(end.x - (task.x + task.width) >= 150);
});

test('establishes rows and columns and keeps the result stable on a second run', () => {
  const units = [
    unit('first', 44, 66),
    unit('upper', 167, 57),
    unit('lower', 184, 199),
    unit('last', 315, 69)
  ];
  const result = apply(units, layoutRegion(units, unbounded, gaps));
  const [first, upper, lower, last] = result.map(({ shape }) => shape);
  assert.equal(center(first, 'y'), center(upper, 'y'));
  assert.equal(center(last, 'y'), center(upper, 'y'));
  assert.equal(center(upper, 'x'), center(lower, 'x'));
  assert.ok(lower.y - (upper.y + upper.height) >= 60);
  assert.ok(upper.x > first.x && last.x > upper.x);
  for (const delta of layoutRegion(result, unbounded, gaps).values()) {
    assert.deepEqual(delta, { x: 0, y: 0 });
  }
});

test('uses ID to order identical centers within a row', () => {
  const a = unit('a', 50, 50);
  const b = unit('b', 50, 50);
  const layout = layoutRegion([b, a], unbounded, { x: 0, y: 0 });
  assert.ok(layout.get(b).x - layout.get(a).x >= 100);
});

test('snaps the center of an odd-sized shape without rounding its bounds', () => {
  const units = [unit('gateway', 196, 67, 51, 51)];
  const [placed] = apply(units, layoutRegion(units, unbounded, gaps));
  assert.deepEqual(placed.shape, { id: 'gateway', x: 194.5, y: 64.5, width: 51, height: 51 });
});

test('shifts an entire layout to fit, including space for attached events', () => {
  const units = [
    unit('a', 121, 40, 100, 80, [{ x: 203, y: 76, width: 36, height: 36 }]),
    unit('b', 240, 33)
  ];
  const wide = { left: 30, right: 360, top: 0, bottom: 180 };
  const result = apply(units, layoutRegion(units, wide, gaps));
  assert.deepEqual(result.map(({ shape }) => [center(shape, 'x'), center(shape, 'y')]), [[110, 80], [310, 80]]);
  assert.ok(result[1].area.x - (result[0].area.x + result[0].area.width) >= 80);
  assert.equal(layoutRegion(units, { ...wide, right: 320 }, gaps), null);
});

test('straightens a staggered main sequence and leaves its bypass on a separate row', () => {
  const units = [
    unit('start', 64, 232, 36, 36),
    unit('task', 232, 130),
    unit('gateway', 477, 335, 50, 50),
    unit('optional', 662, 90),
    unit('join', 854, 342, 36, 36)
  ];
  const pairs = [
    ['start', 'task'], ['task', 'gateway'], ['gateway', 'optional'],
    ['optional', 'join'], ['gateway', 'join']
  ];
  const result = apply(units, layoutRegion(units, unbounded, gaps, flowsFor(units, pairs)));
  const [start, task, gateway, optional, join] = result.map(({ shape }) => shape);
  const main = [start, task, gateway, join];
  assert.ok(main.every((node) => center(node, 'y') === center(gateway, 'y')));
  assert.ok(gateway.y - optional.y - optional.height >= gaps.y);
  assert.ok(main.slice(1).every((node, index) => node.x - main[index].x - main[index].width >= gaps.x));
  for (const delta of layoutRegion(result, unbounded, gaps, flowsFor(result, pairs)).values()) {
    assert.deepEqual(delta, { x: 0, y: 0 });
  }
});

test('prefers an explicit default branch and keeps a vertical sequence in its column', () => {
  const units = [
    unit('gateway', 100, 50, 50, 50),
    unit('near', 300, 36),
    unit('default', 300, 210),
    unit('vertical', 307, 390)
  ];
  const flows = flowsFor(units, [
    ['gateway', 'near'], ['gateway', 'default', true], ['default', 'vertical']
  ]);
  const [gateway, near, fallback, vertical] =
    apply(units, layoutRegion(units, unbounded, gaps, flows)).map(({ shape }) => shape);
  assert.equal(center(gateway, 'y'), center(fallback, 'y'));
  assert.ok(center(near, 'y') < center(fallback, 'y'));
  assert.equal(center(fallback, 'x'), center(vertical, 'x'));
  assert.ok(vertical.y - fallback.y - fallback.height >= gaps.y);
});

test('makes room between the gateways for a branch drawn beyond its merge', () => {
  const units = [
    unit('start', 70, 340, 36, 36),
    unit('task', 288, 208),
    unit('split', 433, 333, 50, 50),
    unit('side', 658, 98),
    unit('merge', 623, 393, 50, 50),
    unit('end', 1030, 250, 36, 36)
  ];
  const pairs = [
    ['start', 'task'], ['task', 'split'], ['split', 'merge'],
    ['split', 'side'], ['side', 'merge'], ['merge', 'end']
  ];
  const result = apply(units, layoutRegion(units, unbounded, gaps, flowsFor(units, pairs)));
  const [start, task, split, side, merge, end] = result.map(({ shape }) => shape);
  assert.ok([start, task, split, merge, end].every((node) => center(node, 'y') === center(split, 'y')));
  assert.ok(side.y + side.height < split.y);
  assert.ok(side.x - (split.x + split.width) >= gaps.x);
  assert.ok(merge.x - (side.x + side.width) >= gaps.x);
  assert.ok(Math.abs(center(side, 'x') - (center(split, 'x') + center(merge, 'x')) / 2) <= 5);
  assert.ok(end.x - (merge.x + merge.width) >= 357);

  for (const delta of layoutRegion(result, unbounded, gaps, flowsFor(result, pairs)).values()) {
    assert.deepEqual(delta, { x: 0, y: 0 });
  }
  assert.equal(layoutRegion(units, { ...unbounded, left: 0, right: 1000 }, gaps, flowsFor(units, pairs)), null);
});

test('orders all 15 transitions from the supplied diagram inside its pool', () => {
  const units = [
    unit('firstTask', 760, 1920),
    unit('firstSplit', 1045, 1935, 50, 50),
    unit('lowerSplit', 1045, 2195, 50, 50),
    unit('nextGateway', 1175, 2095, 50, 50),
    unit('lastTask', 1730, 2080),
    unit('start', 672, 1942, 36, 36),
    unit('upperTask', 1140, 1980),
    unit('firstMerge', 1775, 2285, 50, 50),
    unit('middleTask', 1880, 1950),
    unit('lastMerge', 2065, 2275, 50, 50),
    unit('end', 2072, 1982, 36, 36),
    unit('lowerMerge', 1250, 2220),
    unit('sideTask', 870, 2340)
  ];
  units.find(({ shape }) => shape.id === 'end').shape.type = 'bpmn:EndEvent';
  const pairs = [
    ['firstTask', 'firstSplit'], ['firstSplit', 'lowerSplit'], ['firstSplit', 'upperTask'],
    ['lowerSplit', 'lowerMerge'], ['lowerSplit', 'sideTask'], ['lowerMerge', 'middleTask'],
    ['middleTask', 'firstMerge'], ['upperTask', 'firstMerge'], ['firstMerge', 'nextGateway'],
    ['nextGateway', 'lastTask'], ['lastTask', 'lastMerge'], ['sideTask', 'lowerMerge'],
    ['lastMerge', 'end'], ['start', 'firstTask'], ['lowerMerge', 'lastMerge']
  ];
  const pool = { left: 610, right: 3730, top: 1810, bottom: 3490 };
  const gaps = { x: 40, y: 20 };
  const original = flowsFor(units, pairs);
  assert.equal(original.filter(({ source, target }) => center(source.shape, 'x') > center(target.shape, 'x')).length, 3);
  const aligned = apply(units, layoutRegion(units, pool, gaps, original));
  const shapes = Object.fromEntries(aligned.map(({ shape }) => [shape.id, shape]));
  assert.equal(center(shapes.start, 'y'), center(shapes.firstTask, 'y'));
  assert.equal(center(shapes.firstTask, 'y'), center(shapes.firstSplit, 'y'));
  assert.equal(center(shapes.lastMerge, 'y'), center(shapes.end, 'y'));

  const alignedFlows = flowsFor(aligned, pairs);
  for (const { id, source, target } of alignedFlows) {
    if (id === 'firstSplit-lowerSplit') {
      assert.equal(center(source.shape, 'x'), center(target.shape, 'x'));
      assert.ok(target.area.y - source.area.y - source.area.height >= gaps.y);
    } else {
      assert.ok(target.area.x - source.area.x - source.area.width >= gaps.x, id);
    }
  }
  for (const { shape, area } of aligned) {
    assert.equal(center(shape, 'x') % 10, 0);
    assert.equal(center(shape, 'y') % 10, 0);
    assert.ok(area.x >= pool.left && area.x + area.width <= pool.right);
    assert.ok(area.y >= pool.top && area.y + area.height <= pool.bottom);
  }
  for (const delta of layoutRegion(aligned, pool, gaps, alignedFlows).values()) {
    assert.deepEqual(delta, { x: 0, y: 0 });
  }
});

test('exempts only the deterministic back edge and self-loop from a cyclic layout', () => {
  const units = [
    unit('start', 40, 100, 36, 36),
    unit('a', 460, 100),
    unit('b', 280, 110, 100, 80, [{ x: 365, y: 160, width: 36, height: 36 }]),
    unit('c', 200, 120),
    unit('end', 620, 100, 36, 36)
  ];
  const pairs = [['start', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'a'], ['b', 'b'], ['c', 'end']];
  const flows = flowsFor(units, pairs);
  const layout = layoutRegion(units, unbounded, gaps, flows);
  assert.deepEqual(layoutRegion([...units].reverse(), unbounded, gaps, [...flows].reverse()), layout);

  const aligned = apply(units, layout);
  const alignedFlows = flowsFor(aligned, pairs);
  for (const { id, source, target } of alignedFlows) {
    if (id === 'c-a') assert.ok(target.area.x < source.area.x);
    else if (id === 'b-b') assert.equal(target, source);
    else assert.ok(target.area.x - source.area.x - source.area.width >= gaps.x, id);
  }
  for (const delta of layoutRegion(aligned, unbounded, gaps, alignedFlows).values()) {
    assert.deepEqual(delta, { x: 0, y: 0 });
  }
});

test('moves a near-vertical bypass right when its alternate path needs more columns', () => {
  const units = [
    unit('split', 100, 100, 50, 50),
    unit('side', 260, 180, 51, 80),
    unit('merge', 115, 350, 50, 50)
  ];
  const pairs = [['split', 'side'], ['side', 'merge'], ['split', 'merge']];
  const result = apply(units, layoutRegion(units, unbounded, gaps, flowsFor(units, pairs)));
  const [split, side, merge] = result.map(({ shape }) => shape);
  assert.equal(center(split, 'y'), center(merge, 'y'));
  assert.ok(side.x - split.x - split.width >= gaps.x);
  assert.ok(merge.x - side.x - side.width >= gaps.x);
  assert.ok(Math.abs(center(side, 'x') - (center(split, 'x') + center(merge, 'x')) / 2) <= 5);
  for (const delta of layoutRegion(result, unbounded, gaps, flowsFor(result, pairs)).values()) {
    assert.deepEqual(delta, { x: 0, y: 0 });
  }
});
