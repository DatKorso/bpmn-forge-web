import { ceilGrid, translate, translateWaypoints } from './layout.js';
import { annotationLayout } from './annotation-layout.js';

export const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const right = (rect) => rect.x + rect.width;

export const bottom = (rect) => rect.y + rect.height;

export const sameBox = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

export const transpose = ({ x, y, width, height }) => ({ x: y, y: x, width: height, height: width });

export const localSpacing = (gaps, flip) => flip
  ? { x: gaps.y, y: gaps.x, maxX: gaps.maxY, maxY: gaps.maxX }
  : gaps;

export function descendantOf(figure, parent) {
  for (let ancestor = figure.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor === parent) return true;
  }
  return false;
}

export function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}

export function validBox(rect) {
  return [rect.x, rect.y, right(rect), bottom(rect)].every((value) =>
    Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
}

export function clone(state) {
  return { boxes: new Map(state.boxes), routes: new Map(state.routes) };
}

export function moveTree(state, diagram, figure, delta) {
  if (!delta.x && !delta.y) return;
  const moved = new Set();
  const pending = [figure];
  while (pending.length) {
    const member = pending.pop();
    if (moved.has(member)) continue;
    moved.add(member);
    state.boxes.set(member, translate(state.boxes.get(member), delta));
    pending.push(...(diagram.children.get(member) ?? []), ...attachments(diagram, member));
  }
  for (const edge of diagram.internalEdges) {
    const points = state.routes.get(edge) ?? edge.points;
    if (points && moved.has(edge.source) && moved.has(edge.target)) {
      state.routes.set(edge, translateWaypoints(points, delta));
    }
  }
}

export function attachments(diagram, figure) {
  return diagram.attachments.get(figure) ?? [];
}

export function indexDiagram(figures, edges, auxiliary, canMove = () => true) {
  const notes = annotationLayout(figures, auxiliary);
  const followers = new Set(notes.annotations.filter((note) => [...notes.anchors.get(note)].some(canMove)));
  return {
    notes,
    followers,
    edges,
    incoming: Map.groupBy(edges, ({ target }) => target),
    outgoing: Map.groupBy(edges, ({ source }) => source),
    internalEdges: [...edges, ...auxiliary],
    children: Map.groupBy(figures, (figure) => figure.parent),
    scopes: Map.groupBy(figures, (figure) => figure.scope),
    attachments: Map.groupBy(figures.filter((figure) => figure.host), (figure) => figure.host)
  };
}

export function changes(state) {
  const boxes = new Map([...state.boxes].filter(([figure, bounds]) => !sameBox(figure.box, bounds)));
  return { boxes, routes: state.routes };
}

export function offsets(areas, axis, obstacles) {
  const end = axis === 'x' ? right : bottom;
  let low = -Infinity;
  let high = Infinity;
  const candidates = new Set();
  for (const { box, limits } of areas) {
    for (const limit of limits) {
      low = Math.max(low, ceilGrid(limit[axis] - box[axis]));
      high = Math.min(high, -ceilGrid(end(box) - end(limit)));
    }
    for (const obstacle of obstacles) {
      candidates.add(ceilGrid(end(obstacle) - box[axis]));
      candidates.add(-ceilGrid(end(box) - obstacle[axis]));
    }
  }
  candidates.add(Math.max(low, Math.min(0, high)));
  return [...candidates].filter((value) => Number.isFinite(value) && value >= low && value <= high)
    .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
}
