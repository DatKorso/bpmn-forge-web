import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { generatedProcess } from './alignment-workload.js';

const moddle = new BpmnModdle();
const diagram = generatedProcess(200, 42, false, 12);
for (const figure of diagram.figures) {
  figure.model = moddle.create(figure.type, { id: figure.id });
}
for (const edge of diagram.edges) {
  edge.type = 'bpmn:SequenceFlow';
  edge.model = moddle.create(edge.type, { id: edge.id, sourceRef: edge.source.model, targetRef: edge.target.model });
}
diagram.root.model = moddle.create('bpmn:Process', {
  id: diagram.root.id,
  flowElements: [...diagram.figures, ...diagram.edges].map(({ model }) => model)
});
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
