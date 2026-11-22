import { boundsOf, center, intersects } from '../../src/layout.js';
import { contains } from '../../src/alignment-state.js';
import { acceptsRoute, routeCost, simplifyRoute } from '../../src/route-flows.js';

export const graphFixtures = [
  'invoice-approval', 'compact-loop', 'tight-pool', 'vertical-pool', 'pool-subprocess',
  'acyclic-reorder', 'shared-data', 'self-loop'
];

export const graphGaps = { x: 40, y: 30 };
export const boxOf = (plan, figure) => plan.boxes.get(figure) ?? figure.box;
export const pathOf = (plan, edge) => plan.routes.get(edge) ?? edge.points;
export const processFigures = (diagram) => diagram.figures.filter((figure) => figure.type !== 'bpmn:TextAnnotation');

export function normalized(diagram, plan) {
  const figures = processFigures(diagram);
  const { x, y } = boundsOf(figures.map((figure) => boxOf(plan, figure)));
  return {
    boxes: figures.map((figure) => {
      const box = boxOf(plan, figure);
      return { ...box, x: box.x - x, y: box.y - y };
    }),
    routes: diagram.edges.map((edge) => pathOf(plan, edge).map((point) => [point.x - x, point.y - y]))
  };
}

export function perturb(diagram, amount, seed) {
  let randomState = seed;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  };
  const delta = () => Math.floor(random() * (amount * 2 + 1)) - amount;
  const entries = [...diagram.figures, ...diagram.edges, ...diagram.auxiliary];
  const names = entries.map((_, i) => `Renamed_${i}`);
  for (let i = names.length - 1; i > 0; i--) {
    const index = Math.floor(random() * (i + 1));
    [names[i], names[index]] = [names[index], names[i]];
  }
  for (const [i, entry] of entries.entries()) {
    entry.id = entry.model.id = names[i];
    if (entry.box) {
      if (entry.kind !== 'pool' && entry.kind !== 'lane') entry.box = {
        ...entry.box, x: entry.box.x + delta(), y: entry.box.y + delta()
      };
    } else {
      entry.points = Array.from({ length: 2 + Math.floor(random() * 5) },
        () => ({ x: delta(), y: delta() }));
    }
  }
  return diagram;
}

const unlimited = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };

export function measure(diagram, plan, diagnostics = []) {
  const figures = processFigures(diagram).filter((figure) => figure.kind !== 'group');
  const solids = figures.filter((figure) => !['pool', 'lane'].includes(figure.kind));
  const placed = (figure) => boxOf(plan, figure);
  const route = (edge) => pathOf(plan, edge);
  const local = new Map(diagnostics.flatMap(({ flows }) => flows.map((flow) => [flow.edge, flow])));
  const r1 = solids.flatMap((figure, index) => solids.slice(index + 1)
    .filter((other) => figure.scope === other.scope && figure.host !== other && other.host !== figure &&
      intersects(placed(figure), placed(other)))
    .map((other) => [figure.id, other.id]));
  const r2 = figures.filter((figure) => {
    const lane = figure.lane ?? figure.host?.lane;
    return ![lane, figure.scope].filter((frame) => frame && frame.kind !== 'root' && frame !== figure)
      .every((frame) => contains(placed(frame), placed(figure)));
  }).map(({ id }) => id);
  const r3 = [];
  const r4 = [];
  let localRetreat = 0;
  for (const edge of diagram.edges) {
    const { source, target } = edge;
    const vertical = local.get(edge)?.vertical ?? source.scope.horizontal === false;
    const axis = vertical ? 'y' : 'x';
    const flow = { source: placed(source), target: placed(target) };
    const points = route(edge);
    const obstacles = solids.filter((figure) => figure.scope === source.scope).map(placed);
    if (!acceptsRoute(points, flow, unlimited, obstacles)) r3.push(edge.id);
    if (!local.get(edge)?.back && (source.host ?? source) !== (target.host ?? target)) {
      if (center(flow.source, axis) >= center(flow.target, axis)) r4.push(edge.id);
      localRetreat += points.slice(1).reduce((sum, point, i) => sum + Math.max(0, points[i][axis] - point[axis]), 0);
    }
  }
  const defaults = diagram.edges.filter((edge) => edge.isDefault);
  const { width, height } = boundsOf(figures.map(placed));
  return {
    r1, r2, r3, r4, localRetreat, routeCost: routeCost(diagram.edges.map(route)),
    straightDefaults: [defaults.filter((edge) => simplifyRoute(route(edge)).length === 2).length, defaults.length],
    area: width * height
  };
}

export function elkPath(edge) {
  const section = edge?.sections?.[0];
  return section && [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

export function straightPassage(flow, limits, obstacles) {
  const { source, target, vertical } = flow;
  const start = vertical ? 'y' : 'x';
  const cross = vertical ? 'x' : 'y';
  const length = vertical ? 'height' : 'width';
  const thickness = vertical ? 'width' : 'height';
  const low = Math.max(source[cross], target[cross]);
  const high = Math.min(source[cross] + source[thickness], target[cross] + target[thickness]);
  if (high <= low) return false;
  const cuts = [...new Set([low, high, ...obstacles.flatMap((box) => [box[cross], box[cross] + box[thickness]])
    .filter((value) => value > low && value < high)])].sort((a, b) => a - b);
  return cuts.slice(1).some((value, i) => {
    const level = (value + cuts[i]) / 2;
    return acceptsRoute([{ [start]: source[start] + source[length], [cross]: level },
      { [start]: target[start], [cross]: level }], flow, limits, obstacles);
  });
}
