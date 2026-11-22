import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { planAlignment } from '../src/alignment-plan.js';
import { planGraphLayout } from '../src/graph-layout/prototype.js';
import { routeCost, simplifyRoute } from '../src/route-flows.js';
import { readFixture } from '../test/helpers/read-fixture.js';
import { elkPath, graphFixtures, graphGaps, measure, normalized, pathOf, perturb, straightPassage } from '../test/helpers/layout-metrics.js';

const stops = [];
const clean = (metrics) => ['r1', 'r2', 'r3', 'r4'].every((key) => metrics[key].length === 0);
const gateFixtures = ['tight-pool', 'vertical-pool'];
for (const name of graphFixtures) {
  const load = () => readFixture(`${name}.bpmn`);
  const diagram = await load();
  const diagnostics = [];
  const graph = await planGraphLayout(diagram, graphGaps, diagnostics);
  const legacy = planAlignment(diagram, graphGaps);
  const final = measure(diagram, graph, diagnostics);
  const legacyMetrics = measure(diagram, legacy, diagnostics);
  const geometry = normalized(diagram, graph);
  const oldGeometry = normalized(diagram, legacy);
  const jitter = [];
  for (const amount of [15, 40, 120]) {
    const result = { amount, graphSuccess: 0, graphEqual: 0, graphClean: 0, legacySuccess: 0, legacyEqual: 0, legacyClean: 0 };
    for (let seed = 1; seed <= 10; seed++) {
      const input = perturb(await load(), amount, seed);
      const stages = [];
      const next = await planGraphLayout(input, graphGaps, stages);
      const old = planAlignment(input, graphGaps);
      if (!next.reason) {
        result.graphSuccess++;
        result.graphEqual += Number(isDeepStrictEqual(normalized(input, next), geometry));
        result.graphClean += Number(clean(measure(input, next, stages)));
      }
      if (!old.reason && !old.skipped.length) result.legacySuccess++;
      result.legacyEqual += Number(isDeepStrictEqual(normalized(input, old), oldGeometry));
      result.legacyClean += Number(clean(measure(input, old, stages)));
    }
    jitter.push(result);
  }
  const stages = diagnostics.map(({ scope, elk, positioned, laneBoxes, flows, limits, obstacles }) => {
    const paths = flows.map((flow) => elkPath(elk.edges?.find(({ id }) => id === flow.id))).filter(Boolean);
    const elkCost = routeCost(paths);
    const packed = flows.flatMap((flow) => {
      const points = elkPath(elk.edges?.find(({ id }) => id === flow.id));
      if (!points || simplifyRoute(points).length !== 2) return [];
      const straight = simplifyRoute(pathOf(graph, flow.edge)).length === 2;
      if (straight) return [];
      const free = straightPassage(flow, limits, obstacles);
      if (free && gateFixtures.includes(name)) stops.push(`${name}: lost straight ${flow.edge.id}`);
      return [{ edge: flow.edge.id, free, cause: free ? 'routing detour' : 'packing displaced the endpoints' }];
    });
    if (gateFixtures.includes(name) && !legacyMetrics.routeCost[0] && !elkCost[0] && final.routeCost[0]) {
      stops.push(`${name}: new route crossings`);
    }
    return {
      scope: scope.id,
      elk: { nodes: elk.children?.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), routeCost: elkCost },
      packed: { nodes: [...positioned].map(([figure, box]) => [figure.id, box]),
        lanes: [...laneBoxes].map(([figure, box]) => [figure.id, box]), lostStraight: packed,
        routeCost: routeCost(flows.map(({ edge }) => pathOf(graph, edge))) }
    };
  });
  if (gateFixtures.includes(name) && (graph.reason || !clean(final) ||
      jitter.some(({ graphClean, graphSuccess }) => graphClean !== 10 || graphSuccess !== 10))) {
    stops.push(`${name}: rejection or R1–R4 violation`);
  }
  if (graph.reason || !clean(final) || jitter.some(({ graphEqual }) => graphEqual !== 10)) process.exitCode = 1;
  console.log(JSON.stringify({ name, graph: { reason: graph.reason, ...final }, legacy: legacyMetrics, jitter, stages }));
}
console.log(JSON.stringify({ gate: stops.length ? 'STOP' : 'PASS', stops }));
if (stops.length) process.exitCode = 1;
