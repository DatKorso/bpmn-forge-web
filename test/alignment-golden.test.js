import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { readFixture } from './helpers/read-fixture.js';
import { planAlignment } from '../src/alignment-plan.js';

const fixtures = new URL('./fixtures/', import.meta.url);

for (const file of (await readdir(fixtures)).filter((name) => name.endsWith('.golden.json')).sort().map((name) => name.replace('.golden.json', '.bpmn'))) {
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
