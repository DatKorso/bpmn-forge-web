import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { planAlignment } from '../src/alignment-plan.js';
import { planGraphLayout } from '../src/graph-layout/index.js';
import { boundsOf, intersects } from '../src/layout.js';
import { routeCost, simplifyRoute } from '../src/route-flows.js';
import { readDiagram, readFixture } from '../test/helpers/read-fixture.js';
import { graphWorkloads, graphWorkloadXml } from '../test/helpers/graph-quality-workloads.js';
import { straightExceptions, straightFlows } from '../test/helpers/graph-straight-flows.js';
import { elkPath, graphFixtures, graphGaps, measure, normalized, pathOf, perturb,
  straightPassage } from '../test/helpers/layout-metrics.js';

const fixtureFiles = (await readdir(new URL('../test/fixtures/', import.meta.url))).filter((file) => file.endsWith('.bpmn'));
const fixtures = [
  ...fixtureFiles.map((file) => [file.slice(0, -5), () => readFixture(file)]),
  ...graphWorkloads.map((name) => [name, () => readDiagram(graphWorkloadXml(name))])
];
const hard = [];
const review = [];
const exact = {};
const cases = {};
const collaborations = new Set(['collaboration', 'order-fulfilment']);
const messagePaths = (diagram, plan) => diagram.messageFlows.map((edge) => pathOf(plan, edge)
  .map(({ x, y }) => [x, y]));

function digest(diagram, plan) {
  const edges = [...diagram.edges, ...diagram.auxiliary, ...diagram.messageFlows];
  const routes = edges.map((edge) => [edge.id, pathOf(plan, edge).map(({ x, y }) => [x, y])]);
  return createHash('sha256').update(JSON.stringify(routes)).digest('hex');
}

function sharedSegments(diagram, plan) {
  return diagram.edges.flatMap((a, i) => diagram.edges.slice(i + 1).flatMap((b) => {
    if (a.source === b.source || a.target === b.target) return [];
    const pa = simplifyRoute(pathOf(plan, a));
    const pb = simplifyRoute(pathOf(plan, b));
    const shared = [];
    for (const [i, start] of pa.slice(0, -1).entries()) {
      const end = pa[i + 1];
      const axis = start.y === end.y ? 'x' : 'y';
      const cross = axis === 'x' ? 'y' : 'x';
      for (const [j, other] of pb.slice(0, -1).entries()) {
        const stop = pb[j + 1];
        if (start[cross] !== other[cross] || start[cross] !== stop[cross]) continue;
        const low = Math.max(Math.min(start[axis], end[axis]), Math.min(other[axis], stop[axis]));
        const high = Math.min(Math.max(start[axis], end[axis]), Math.max(other[axis], stop[axis]));
        if (high - low >= 1) shared.push({ axis, level: start[cross], low, high });
      }
    }
    return shared.length ? [{ flows: [a.id, b.id], segments: shared }] : [];
  }));
}

function exactPlans(diagram, graph, legacy) {
  return {
    graph: { reason: graph.reason ?? null, routes: digest(diagram, graph) },
    legacy: { reason: legacy.reason ?? null, skipped: legacy.skipped, routes: digest(diagram, legacy) }
  };
}

function summarizeStages(stages, plan) {
  const area = (boxes) => {
    const { width, height } = boundsOf(boxes);
    return width * height;
  };
  return stages.map(({ scope, elk, positioned, laneBoxes, flows, limits, obstacles }) => {
    const elkRoutes = (elk.edges ?? []).filter(({ id }) => !id.startsWith('d')).map(elkPath).filter(Boolean);
    const packed = [...positioned];
    return {
      scope: scope.id,
      elk: {
        area: area(elk.children ?? []),
        routeCost: routeCost(elkRoutes),
        routedFlows: elkRoutes.length
      },
      packed: {
        area: area([...positioned.values(), ...laneBoxes.values()]),
        overlaps: packed.flatMap(([figure, box], index) => packed.slice(index + 1)
          .filter(([other, otherBox]) => figure.host !== other && other.host !== figure && intersects(box, otherBox))
          .map(([other]) => [figure.id, other.id])),
        straightPassage: flows.filter((flow) => !flow.back && straightPassage(flow, limits, obstacles))
          .map(({ edge }) => edge.id)
      },
      routed: { routeCost: routeCost(flows.map(({ edge }) => pathOf(plan, edge))) }
    };
  });
}

const baselineUrl = new URL('../test/fixtures/graph-layout-baseline.json', import.meta.url);
const currentUrl = new URL('../test/fixtures/graph-layout-current.json', import.meta.url);
const reference = process.argv.includes('--capture') ? null : JSON.parse(await readFile(baselineUrl, 'utf8'));

for (const [name, load] of fixtures) {
  const diagram = await load();
  const stages = [];
  const graph = await planGraphLayout(diagram, graphGaps, stages);
  const legacy = planAlignment(diagram, graphGaps);
  exact[name] = { original: exactPlans(diagram, graph, legacy), perturbed: [] };
  const expectedReason = collaborations.has(name) ? null : reference?.cases[name]?.reason;
  if (reference && expectedReason !== (graph.reason ?? null)) hard.push({ name, expectedReason, actual: graph.reason });
  if (graph.reason && !['graphGroup', 'graphNestedLanes', 'graphMissingLane'].includes(graph.reason)) {
    hard.push({ name, reason: graph.reason });
  }
  const legacyMetrics = measure(diagram, legacy, stages);
  const final = graph.reason ? null : measure(diagram, graph, stages);
  const shared = graph.reason ? [] : sharedSegments(diagram, graph);
  cases[name] = { nodes: diagram.figures.filter(({ kind }) => kind === 'node').length,
    reason: graph.reason ?? null, legacy: legacyMetrics, final, shared,
    stages: summarizeStages(stages, graph), r5: { required: straightFlows[name] ?? [], exceptions: straightExceptions[name] ?? {} } };
  if (!final) continue;
  if (collaborations.has(name)) {
    const costs = (plan) => routeCost(diagram.messageFlows.map((edge) => pathOf(plan, edge)));
    cases[name].messages = { graph: costs(graph), legacy: costs(legacy) };
  }

  const crossingLimit = Math.min(reference?.cases[name]?.final?.routeCost[0] ?? final.routeCost[0], legacyMetrics.routeCost[0]);
  const bends = (plan, edge) => Math.max(0, simplifyRoute(pathOf(plan, edge)).length - 2);
  const extraBends = diagram.edges.filter((edge) => bends(graph, edge) > bends(legacy, edge))
    .map((edge) => [edge.id, bends(legacy, edge), bends(graph, edge)]);
  if (extraBends.length || final.area >= 1.2 * legacyMetrics.area) {
    review.push({ name, areaRatio: final.area / legacyMetrics.area, extraBends });
  }
  const missingStraight = cases[name].r5.required.filter((id) => {
    const edge = diagram.edges.find((entry) => entry.id === id);
    if (!edge) return true;
    const points = simplifyRoute(pathOf(graph, edge));
    return points.length !== 2 || (points[0].x !== points[1].x && points[0].y !== points[1].y);
  });
  if (['r1', 'r2', 'r3', 'r4'].some((key) => final[key].length) ||
      shared.length || final.routeCost[0] > crossingLimit || missingStraight.length) {
    hard.push({ name, r1: final.r1, r2: final.r2, r3: final.r3, r4: final.r4,
      crossings: final.routeCost[0], crossingLimit, shared, missingStraight });
  }
  const geometry = normalized(diagram, graph);
  const seeds = graphFixtures.includes(name) ? 10 : 2;
  for (const amount of [15, 40, 120]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const input = perturb(await load(), amount, seed);
      const nextLegacy = planAlignment(input, graphGaps);
      if (collaborations.has(name)) {
        for (const [index, edge] of input.messageFlows.entries()) {
          edge.points = [{ x: amount, y: seed }, { x: index, y: -amount }];
        }
        input.diElements = input.diElements.toReversed();
      }
      const diagnostics = [];
      const next = await planGraphLayout({ ...input, figures: input.figures.toReversed(), edges: input.edges.toReversed(),
        auxiliary: input.auxiliary.toReversed(), messageFlows: input.messageFlows.toReversed() }, graphGaps, diagnostics);
      if (next.reason) hard.push({ name, amount, seed, reason: next.reason });
      else {
        try {
          assert.deepEqual(normalized(input, next), geometry);
          if (collaborations.has(name)) assert.deepEqual(messagePaths(input, next), messagePaths(diagram, graph));
        } catch {
          hard.push({ name, amount, seed, r6: 'Geometry or route changed' });
        }
        const metrics = measure(input, next, diagnostics);
        const invalid = Object.fromEntries(['r1', 'r2', 'r3', 'r4'].filter((key) => metrics[key].length)
          .map((key) => [key, metrics[key]]));
        if (Object.keys(invalid).length) hard.push({ name, amount, seed, ...invalid });
      }
      exact[name].perturbed.push({ amount, seed, ...exactPlans(input, next, nextLegacy) });
    }
  }
}
for (const record of Object.values(exact)) {
  const runs = record.perturbed.length;
  record.perturbed = {
    runs,
    graph: createHash('sha256').update(JSON.stringify(record.perturbed.map(({ amount, seed, graph }) =>
      [amount, seed, graph]))).digest('hex'),
    legacy: createHash('sha256').update(JSON.stringify(record.perturbed.map(({ amount, seed, legacy }) =>
      [amount, seed, legacy]))).digest('hex')
  };
}
const report = { gaps: graphGaps, cases, hard, review, exact };
if (process.argv.includes('--check-routes')) {
  const current = JSON.parse(await readFile(currentUrl, 'utf8'));
  assert.deepEqual(exact, { ...reference.exact, ...current.exact }, 'Routes differ from the expected snapshot');
  for (const name of Object.keys(reference.exact)) {
    assert.deepEqual(exact[name].original.legacy, reference.exact[name].original.legacy, name);
    if (reference.exact[name].perturbed.runs) {
      assert.deepEqual(exact[name].perturbed.legacy, reference.exact[name].perturbed.legacy, name);
    }
  }
}
if (process.argv.includes('--quality') && hard.length) process.exitCode = 1;
if (process.argv.includes('--snapshot')) {
  for (const key of ['cases', 'exact']) {
    for (const [name, value] of Object.entries(report[key])) {
      if (JSON.stringify(value) === JSON.stringify(reference[key][name])) delete report[key][name];
    }
  }
}
console.log(JSON.stringify(report, null, 2));
