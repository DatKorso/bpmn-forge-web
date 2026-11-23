import { boundsOf, center, nearestFreeBox, translate, translateWaypoints } from '../layout.js';
import { bottom, contains, indexDiagram, right, validBox } from '../alignment-state.js';
import { isAnnotation, isFrame } from '../annotation-layout.js';
import { placeGatewayLabel } from '../gateway-label-layout.js';
import { ROUTE_MARGIN } from '../route-flows.js';
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

function ancestry(figure) {
  const frames = [];
  for (let parent = figure.parent; parent; parent = parent.parent) {
    if (isFrame(parent)) frames.push(parent);
  }
  return frames;
}

function headerBox(figure, box) {
  return figure.horizontal === false ? { ...box, height: figure.header } : { ...box, width: figure.header };
}

function fixedLabels(figures, state) {
  const labels = new Map();
  for (const figure of figures) {
    const { x, y } = state.boxes.get(figure);
    const delta = { x: x - figure.box.x, y: y - figure.box.y };
    const projected = (figure.labels ?? []).map((label) => translate(label, delta));
    if (!projected.every(validBox)) return { reason: 'bounds', scope: figure.scope, elementId: figure.id };
    labels.set(figure, projected);
  }
  const paths = [...state.routes.values()];
  const sequenceLabels = [];
  for (const [edge, path] of state.routes) {
    const projected = edge.projectLabels?.(path) ?? edge.labels ?? [];
    if (!projected.every(validBox)) {
      return { reason: 'graphConnectionLabel', scope: edge.source.scope, elementId: edge.id };
    }
    sequenceLabels.push(...projected);
  }
  for (const gateway of figures.filter(({ type }) => type === 'bpmn:ExclusiveGateway')) {
    const containers = new Set(ancestry(gateway));
    for (let figure = gateway; figure; figure = figure.parent) {
      if (figure.lane) containers.add(figure.lane);
    }
    const obstacles = figures.filter((figure) => figure !== gateway).flatMap((figure) => {
      const box = state.boxes.get(figure);
      if (!isFrame(figure) || (figure.kind !== 'lane' && !containers.has(figure))) return [box];
      return figure.header ? [headerBox(figure, box)] : [];
    });
    const occupied = [...sequenceLabels, ...[...labels].filter(([figure]) => figure !== gateway).flatMap(([, boxes]) => boxes)];
    const gatewayBox = state.boxes.get(gateway);
    const limits = [...containers].map((frame) => state.boxes.get(frame));
    const placed = [];
    for (const label of labels.get(gateway)) {
      const next = placeGatewayLabel(label, gatewayBox, [...obstacles, ...occupied, ...placed], paths, limits, true);
      if (!next || !validBox(next)) return { reason: 'graphGatewayLabel', scope: gateway.scope, elementId: gateway.id };
      placed.push(next);
    }
    labels.set(gateway, placed);
  }
  return { labels, obstacles: [...sequenceLabels, ...[...labels.values()].flat()] };
}

function placeNotes(diagram, collaboration, state, figures, labels) {
  const { owner, order, auxiliary } = collaboration;
  const notes = figures.filter(isAnnotation);
  const solids = figures.filter((figure) => !isAnnotation(figure));
  const anchors = new Map(notes.map((note) => [note, new Set()]));
  for (const { type, source, target } of auxiliary) {
    if (type !== 'bpmn:Association') continue;
    if (anchors.has(source) && !anchors.has(target)) anchors.get(source).add(target);
    if (anchors.has(target) && !anchors.has(source)) anchors.get(target).add(source);
  }
  const lines = [];
  const diagonals = [];
  for (const path of state.routes.values()) {
    for (const [index, b] of path.slice(1).entries()) {
      const a = path[index];
      if (a.x !== b.x && a.y !== b.y) diagonals.push([a, b]);
      else lines.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
    }
  }
  const placed = [];
  for (const note of notes) {
    const containers = ancestry(note);
    const frame = containers[0];
    const pool = owner.get(note);
    const priority = (figure) => {
      if (figure.parent === note.parent) return 0;
      return pool && owner.get(figure) === pool ? 1 : 2;
    };
    const anchor = [...anchors.get(note)].sort((a, b) =>
      (frame ? priority(a) - priority(b) : 0) || order.get(a) - order.get(b))[0] ?? frame;
    const bounds = anchor && state.boxes.get(anchor);
    const preferred = bounds ? translate(note.box, { x: bounds.x - anchor.box.x, y: bounds.y - anchor.box.y }) : note.box;
    const obstacles = solids.flatMap((figure) => {
      const box = state.boxes.get(figure);
      if (!(containers.includes(figure) || (figure.kind === 'lane' && figure.scope === (frame ?? diagram.root)))) {
        return [box];
      }
      return figure.header ? [headerBox(figure, box)] : [];
    });
    const limit = frame && state.boxes.get(frame);
    const next = nearestFreeBox(preferred, [...obstacles, ...labels, ...lines, ...placed], limit, ROUTE_MARGIN, diagonals);
    if (!next || !validBox(next)) return { reason: 'annotations', scope: frame ?? diagram.root, elementId: note.id };
    state.boxes.set(note, next);
    placed.push(next);
  }
}

export async function arrangeCollaboration(diagram, collaboration, structures, gaps, diagnostics, timing) {
  const localStart = performance.now();
  const { pools, owner, messages, auxiliary, order } = collaboration;
  const state = { boxes: new Map(diagram.figures.map((figure) => [figure, figure.box])), routes: new Map() };
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
      labelGateways: [],
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
