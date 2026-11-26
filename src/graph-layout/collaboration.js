import { boundsOf, center, translate, translateWaypoints } from '../layout.js';
import { bottom, contains, indexDiagram, right, validBox } from '../alignment-state.js';
import { isAnnotation } from '../annotation-layout.js';
import { fixedLabels, placeNotes } from './decorations.js';
import { arrangeScope } from './arrange.js';
import { finishCollaborationRoutes } from './collaboration-routes.js';
import { modelOf, typeIs } from './model-order.js';

export const isDataFlow = (edge) => ['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation'].includes(edge.type);

export function isPassivePool(figures, { nodes, edges }) {
  return !edges.length && nodes.every((node) => typeIs(node, 'bpmn:DataObject')) &&
    figures.every((figure) => figure.kind === 'pool' || figure.kind === 'lane' || isAnnotation(figure));
}

export function localizePassivePool(pool, figures, state) {
  const delta = { x: -pool.box.x, y: -pool.box.y };
  for (const figure of figures) {
    if (!isAnnotation(figure)) state.boxes.set(figure, translate(figure.box, delta));
  }
}

export async function arrangeCollaboration(diagram, collaboration, structures, gaps, diagnostics, timing, room) {
  const localStart = performance.now();
  const { pools, owner, messages, auxiliary, order } = collaboration;
  const state = { boxes: new Map(diagram.figures.map((figure) => [figure, figure.box])), routes: new Map(), routing: new Map(), room };
  const figures = diagram.figures.toSorted((a, b) => order.get(a) - order.get(b));
  const members = Map.groupBy(figures.filter((figure) => !isAnnotation(figure)), (figure) => owner.get(figure));
  const edges = Map.groupBy(diagram.edges, ({ source }) => owner.get(source));
  const data = Map.groupBy(auxiliary.filter(isDataFlow), ({ source }) => owner.get(source));

  for (const pool of pools) {
    const poolFigures = members.get(pool);
    const poolEdges = edges.get(pool) ?? [];
    if (isPassivePool(poolFigures, structures.get(pool))) {
      const outside = poolFigures.find((figure) => !contains(pool.box, figure.box));
      if (outside) {
        return { reason: 'graphOwnership', scope: pool, elementId: outside.id };
      }
      localizePassivePool(pool, poolFigures, state);
      continue;
    }
    const indexed = {
      ...indexDiagram(poolFigures, poolEdges, []),
      data: data.get(pool) ?? [],
      structures,
      sequenceByModel: new Map(poolEdges.map((edge) => [modelOf(edge), edge]))
    };
    const failure = await arrangeScope(pool, indexed, state, gaps, diagnostics);
    if (failure) return failure;
  }

  timing('local', localStart);
  const poolsStart = performance.now();
  const verticalCount = pools.filter(({ horizontal }) => horizontal === false).length;
  const axis = verticalCount > pools.length / 2 ? 'x' : 'y';
  const span = axis === 'x' ? 'width' : 'height';
  const row = pools.toSorted((a, b) => center(a.box, axis) - center(b.box, axis));
  const index = new Map(row.map((pool, rank) => [pool, rank]));
  const reserved = new Set();
  for (const { source, target } of messages) {
    const a = index.get(owner.get(source));
    const b = index.get(owner.get(target));
    for (let i = Math.min(a, b); i < Math.max(a, b); i++) reserved.add(i);
  }
  const anchor = boundsOf(pools.map(({ box }) => box));
  const gapAfter = (rank) => Math.max(reserved.has(rank) ? 80 : 0, gaps[axis]);
  let offset = 0;
  for (const [rank, pool] of row.entries()) {
    const delta = { x: anchor.x, y: anchor.y, [axis]: anchor[axis] + offset };
    for (const figure of members.get(pool)) state.boxes.set(figure, translate(state.boxes.get(figure), delta));
    for (const edge of edges.get(pool) ?? []) {
      const path = state.routes.get(edge);
      if (!path) return { reason: 'graphIncomplete', scope: pool, elementId: edge.id };
      state.routes.set(edge, translateWaypoints(path, delta));
    }
    offset += state.boxes.get(pool)[span] + gapAfter(rank);
  }
  if ([...state.boxes.values()].some((box) => !validBox(box) || box.width <= 0 || box.height <= 0)) {
    return { reason: 'bounds', scope: diagram.root };
  }
  for (const [rank, pool] of row.entries()) {
    const box = state.boxes.get(pool);
    if (right(box) <= box.x || bottom(box) <= box.y) return { reason: 'bounds', scope: pool };
    if (rank === 0) continue;
    const previous = state.boxes.get(row[rank - 1]);
    const gap = box[axis] - (previous[axis] + previous[span]);
    if (center(box, axis) <= center(previous, axis) || Math.abs(gap - gapAfter(rank - 1)) >= 1e-7) {
      return { reason: 'bounds', scope: pool };
    }
  }
  timing('pools', poolsStart);
  const notesStart = performance.now();
  const solids = figures.filter((figure) => !isAnnotation(figure));
  const fixed = fixedLabels(solids, state);
  if (fixed.reason) return fixed;
  const { labels, obstacles } = fixed;
  const blocked = placeNotes(diagram, collaboration, state, figures, obstacles);
  timing('notes', notesStart);
  if (blocked) return blocked;

  const routesStart = performance.now();
  const routed = finishCollaborationRoutes(diagram, collaboration, state, obstacles, axis, timing);
  timing('routes', routesStart);
  if (routed.reason) return routed;
  return { boxes: state.boxes, routes: new Map([...state.routes, ...routed.routes]),
    labels: new Map([...labels, ...routed.labels]) };
}
