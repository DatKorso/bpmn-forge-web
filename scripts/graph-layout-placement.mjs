import { readdir } from 'node:fs/promises';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { boxOf, graphGaps } from '../test/helpers/layout-metrics.js';
import { graphWorkloadXml, graphWorkloads } from '../test/helpers/graph-quality-workloads.js';
import { readDiagram, readFixture } from '../test/helpers/read-fixture.js';

const fixtures = (await readdir(new URL('../test/fixtures/', import.meta.url))).filter((file) => file.endsWith('.bpmn'));
const inputs = [
  ...fixtures.map((filename) => [filename.slice(0, -5), () => readFixture(filename)]),
  ...graphWorkloads.map((name) => [name, () => readDiagram(graphWorkloadXml(name))])
];
const center = (box, vertical) => vertical ? box.x + box.width / 2 : box.y + box.height / 2;

for (const [name, load] of inputs) {
  const diagram = await load();
  const stages = [];
  const plan = await planGraphLayout(diagram, graphGaps, stages);
  if (plan.reason) continue;
  const orientations = new Map(stages.flatMap(({ flows }) => flows.map(({ edge, vertical }) => [edge, vertical])));
  const order = { agrees: 0, inverted: 0, tied: 0 };
  // Compare authored branch order with target centers across the flow axis.
  for (const [source, flows] of Map.groupBy(diagram.edges, ({ source }) => source)) {
    const model = source.scope.model.processRef ?? source.scope.model;
    const authored = source.model.outgoing?.length ? source.model.outgoing : model.flowElements;
    const branches = flows.toSorted((a, b) => authored.indexOf(a.model) - authored.indexOf(b.model));
    for (const [index, a] of branches.entries()) {
      for (const b of branches.slice(index + 1)) {
        const vertical = orientations.get(a);
        const delta = center(boxOf(plan, b.target), vertical) - center(boxOf(plan, a.target), vertical);
        order[delta > 0 ? 'agrees' : delta < 0 ? 'inverted' : 'tied']++;
      }
    }
  }
  let localEdit;
  if (graphWorkloads.includes(name)) {
    const edited = await readDiagram(graphWorkloadXml(name, { localEdit: true }));
    const next = await planGraphLayout(edited, graphGaps);
    if (next.reason) throw new Error(`${name}: edited case rejected (${next.reason})`);
    const former = new Map(diagram.figures.filter(({ kind }) => kind === 'node').map((figure) => [figure.id, boxOf(plan, figure)]));
    const shifts = edited.figures.filter(({ id }) => former.has(id)).map((figure) => {
      const a = former.get(figure.id);
      const b = boxOf(next, figure);
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    localEdit = {
      moved: shifts.filter(Boolean).length,
      compared: shifts.length,
      medianShift: shifts.toSorted((a, b) => a - b)[Math.floor(shifts.length / 2)],
      maxShift: Math.max(...shifts)
    };
  }
  if (localEdit || Object.values(order).some(Boolean)) console.log(JSON.stringify({ name, order, localEdit }));
}
