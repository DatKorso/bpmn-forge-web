import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { readDiagram } from '../test/helpers/read-fixture.js';
import { collaborationBenchmarkXml, graphBenchmarkWorkload } from './graph-benchmark-workload.js';

const profiles = ['process', 'collaboration', 'late-refusal'];
const name = process.argv[2];
if (!name) {
  for (const profile of profiles) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), profile], { stdio: 'inherit' });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, `Benchmark failed: ${profile}`);
  }
  process.exit(0);
}
assert.ok(profiles.includes(name), `Unknown workload: ${name}`);
const lateRefusal = name === 'late-refusal';
const single = name === 'process';
const diagram = single ? graphBenchmarkWorkload().diagram : await readDiagram(await collaborationBenchmarkXml({ lateRefusal }));
const nodes = diagram.figures.filter(({ kind }) => kind === 'node').length;
const messages = diagram.messageFlows?.length ?? 0;
assert.equal(nodes, 200);
assert.equal(diagram.edges.length, 216);
assert.equal(messages, single ? 0 : 24);
assert.equal(diagram.figures.filter(({ type }) => type === 'bpmn:TextAnnotation').length, single ? 0 : 8);

const timings = [];
for (let run = 0; run < 6; run++) {
  performance.clearMeasures();
  const start = performance.now();
  const plan = await planGraphLayout(diagram, { x: 60, y: 40 });
  const elapsed = Math.round(performance.now() - start);
  const stages = Object.fromEntries(performance.getEntriesByType('measure')
    .filter(({ name }) => name.startsWith('bpmn:graph:'))
    .map(({ name, duration }) => [name.split(':').at(-1), Math.round(duration * 10) / 10]));
  timings.push({ elapsed, stages });
  if (lateRefusal) {
    assert.equal(plan.reason, 'annotations');
    assert.equal(plan.elementId, 'Note_3_1');
    assert.equal(plan.boxes.size + plan.routes.size, 0);
  } else {
    assert.equal(plan.reason, undefined, `${name}: ${plan.reason} (${plan.scope?.id})`);
    assert.equal([...plan.routes.keys()].filter((edge) => edge.type === 'bpmn:SequenceFlow').length, diagram.edges.length);
  }
}
const [cold, ...warm] = timings;
console.log(JSON.stringify({
  name, nodes, edges: diagram.edges.length, messages,
  cold, warm, medianWarm: warm.map(({ elapsed }) => elapsed).toSorted((a, b) => a - b)[2]
}));
