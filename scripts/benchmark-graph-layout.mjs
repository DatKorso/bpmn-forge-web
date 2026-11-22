import assert from 'node:assert/strict';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { graphBenchmarkWorkload } from './graph-benchmark-workload.js';

const { diagram } = graphBenchmarkWorkload();
const timings = [];
for (let run = 0; run < 6; run++) {
  const start = performance.now();
  const plan = await planGraphLayout(diagram, { x: 60, y: 40 });
  timings.push(Math.round(performance.now() - start));
  assert.equal(plan.reason, undefined);
  assert.equal(plan.routes.size, diagram.edges.length);
}
const [cold, ...warm] = timings;
console.log(JSON.stringify({ nodes: diagram.figures.length, edges: diagram.edges.length, cold,
  warm, medianWarm: warm.toSorted((a, b) => a - b)[2] }));
