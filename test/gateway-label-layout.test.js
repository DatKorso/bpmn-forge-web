import assert from 'node:assert/strict';
import test from 'node:test';
import { placeGatewayLabel } from '../src/gateway-label-layout.js';
import { cutsInterior } from '../src/route-flows.js';

const gateway = { x: 100, y: 100, width: 50, height: 50 };
const label = { x: 105, y: 74, width: 40, height: 18 };
const point = (x, y) => ({ x, y });

test('places a gateway label next to its original side clear of a straight segment', () => {
  const path = [point(60, 80), point(190, 80)];
  const moved = placeGatewayLabel(label, gateway, [], [path], []);
  assert.deepEqual(moved, { ...label, y: 54 });
});

test('places a gateway label clear of a diagonal segment with its full margin', () => {
  const path = [point(80, 45), point(172, 127)];
  const moved = placeGatewayLabel(label, gateway, [], [path], []);
  const padded = { x: moved.x - 8, y: moved.y - 8, width: moved.width + 16, height: moved.height + 16 };
  assert.ok(cutsInterior(...path, label));
  assert.notDeepEqual(moved, label);
  assert.equal(cutsInterior(...path, padded), false);
});

test('preserves a clear label even inside the bounding box of a diagonal segment', () => {
  const path = [point(20, 70), point(200, 145)];
  assert.strictEqual(placeGatewayLabel(label, gateway, [], [path], []), label);
});

test('preserves the usual label position when the lane is too tight for a clear placement', () => {
  const lane = { x: 95, y: 74, width: 60, height: 80 };
  const path = [point(95, 80), point(155, 80)];
  assert.strictEqual(placeGatewayLabel(label, gateway, [], [path], [lane]), label);
});
