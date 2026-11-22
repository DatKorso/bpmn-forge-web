import assert from 'node:assert/strict';
import test from 'node:test';
import { generatedProcess } from '../scripts/alignment-workload.js';
import { planAlignment } from '../src/alignment-plan.js';
import { intersects } from '../src/layout.js';

test('generated layouts preserve lane membership, connections, clearance and repeat-run geometry', () => {
  for (let seed = 1; seed <= 32; seed++) {
    const diagram = generatedProcess(6 + seed % 14, seed, true);
    const [lane, ...nodes] = diagram.figures;
    const gaps = { x: 20 + seed % 5 * 10, y: 20 + seed % 3 * 10 };
    const relation = (edge) => [edge.id, edge.source.id, edge.target.id];
    const before = diagram.edges.map(relation);
    const first = planAlignment(diagram, gaps);
    assert.equal(first.reason, undefined, `seed ${seed}`);
    assert.deepEqual(first.skipped, [], `seed ${seed}`);
    for (const [figure, box] of first.boxes) figure.box = box;
    for (const [edge, points] of first.routes) edge.points = points;

    assert.deepEqual(diagram.edges.map(relation), before);
    assert.equal(first.routes.size, diagram.edges.length);
    for (const [i, node] of nodes.entries()) {
      assert.equal(node.lane, lane);
      const a = node.box;
      assert.ok(a.x >= lane.box.x && a.y >= lane.box.y &&
        a.x + a.width <= lane.box.x + lane.box.width && a.y + a.height <= lane.box.y + lane.box.height);
      for (const { box: b } of nodes.slice(i + 1)) {
        assert.equal(intersects(a, b), false, `seed ${seed}`);
        assert.ok(Math.max(b.x - a.x - a.width, a.x - b.x - b.width) >= gaps.x ||
          Math.max(b.y - a.y - a.height, a.y - b.y - b.height) >= gaps.y, `seed ${seed}`);
      }
    }

    const repeated = planAlignment(diagram, gaps);
    assert.deepEqual(repeated.skipped, []);
    assert.equal(repeated.boxes.size, 0, `seed ${seed}`);
    for (const [edge, points] of repeated.routes) assert.deepEqual(points, edge.points);
  }
});
