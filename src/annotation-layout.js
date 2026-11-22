import { boundsOf, center, intersects, nearestFreeBox, translate } from './layout.js';
import { acceptsRoute, cutsInterior, ROUTE_MARGIN, routeFlow } from './route-flows.js';

const right = (box) => box.x + box.width;
const bottom = (box) => box.y + box.height;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const segments = (points) => points?.slice(1).map((point, index) => [points[index], point]) ?? [];
export const isAnnotation = ({ type }) => type === 'bpmn:TextAnnotation';
export const isFrame = (figure) => figure.kind === 'pool' || figure.kind === 'lane' || figure.expanded;
const containsBox = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
const changedBox = (box, next) =>
  box.x !== next.x || box.y !== next.y || box.width !== next.width || box.height !== next.height;

function parents(figure) {
  const result = [];
  for (let parent = figure.parent; parent; parent = parent.parent) {
    if (isFrame(parent)) result.push(parent);
  }
  return result;
}

export function annotationLayout(figures, auxiliary) {
  const associations = auxiliary.filter(({ type }) => type === 'bpmn:Association');
  const annotations = figures.filter(isAnnotation).sort(byId);
  const anchors = new Map(annotations.map((note) => [note, new Set()]));
  for (const { source, target } of associations) {
    if (anchors.has(source) && !isAnnotation(target) && target.kind !== 'group') anchors.get(source).add(target);
    if (anchors.has(target) && !isAnnotation(source) && source.kind !== 'group') anchors.get(target).add(source);
  }
  const frames = figures.filter(isFrame);
  const containers = new Map(figures.map((figure) => [figure, anchors.has(figure)
    ? annotationContainers(figure, frames, [...anchors.get(figure)])
    : parents(figure)]));
  return { figures, associations, anchors, annotations, containers };
}

function distance(note, anchor) {
  return (center(note.box, 'x') - center(anchor.box, 'x')) ** 2 +
    (center(note.box, 'y') - center(anchor.box, 'y')) ** 2;
}

function annotationContainers(note, frames, anchors) {
  const structural = parents(note);
  const anchorFrames = new Set(anchors.flatMap((anchor) => [anchor, ...parents(anchor)]));
  const geometric = frames.filter((frame) => frame !== note && containsBox(frame.box, note.box) &&
    (anchorFrames.has(frame) || frame.scope === note.scope && frame.kind === 'lane' ||
      frame.kind === 'lane' && anchorFrames.has(frame.scope)));
  return [...new Set([...structural, ...geometric])].sort((a, b) =>
    Number(!containsBox(a.box, b.box)) - Number(!containsBox(b.box, a.box)) ||
    b.box.width * b.box.height - a.box.width * a.box.height ||
    Number(a.kind !== 'pool') - Number(b.kind !== 'pool') || byId(a, b));
}

function contentBox(figure, box) {
  const x = box.x + (figure.horizontal === false ? 0 : figure.header ?? 0);
  const y = box.y + (figure.horizontal === false ? figure.header ?? 0 : 0);
  return { x, y, width: right(box) - x, height: bottom(box) - y };
}

function headerBox(figure, box) {
  return figure.horizontal === false ? { ...box, height: figure.header } : { ...box, width: figure.header };
}

function intersection(boxes) {
  const x = Math.max(...boxes.map((box) => box.x));
  const y = Math.max(...boxes.map((box) => box.y));
  return { x, y, width: Math.min(...boxes.map(right)) - x, height: Math.min(...boxes.map(bottom)) - y };
}

function projectedLabels(figure, box) {
  return (figure.labels ?? []).map((label) => translate(label, { x: box.x - figure.box.x, y: box.y - figure.box.y }));
}

function flowObstacles(state, flows) {
  const boxes = [];
  const diagonals = [];
  for (const edge of flows) {
    const points = state.routes.get(edge) ?? edge.points;
    for (const [a, b] of segments(points)) {
      if (a.x !== b.x && a.y !== b.y) diagonals.push([a, b]);
      else boxes.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
    }
    boxes.push(...(edge.projectLabels?.(points) ?? []));
  }
  return { boxes, diagonals };
}

export function placeAnnotations(layout, state, flows, explicit) {
  const { figures, annotations, anchors, containers } = layout;
  const placements = annotations.map((note) => {
    const candidates = [...anchors.get(note)].filter((anchor) => {
      const box = state.boxes.get(anchor);
      return anchor.box.x !== box.x || anchor.box.y !== box.y;
    }).sort((a, b) => distance(note, a) - distance(note, b) || byId(a, b));
    const anchor = candidates[0];
    return { note, anchor, containers: containers.get(note) };
  });
  const pending = new Set(placements.filter(({ note, anchor }) => anchor || explicit.has(note)).map(({ note }) => note));
  const { boxes: lines, diagonals } = flowObstacles(state, flows);
  for (const { note, anchor, containers } of placements) {
    if (!pending.delete(note)) continue;
    const preferred = anchor ? translate(note.box, {
      x: state.boxes.get(anchor).x - anchor.box.x, y: state.boxes.get(anchor).y - anchor.box.y
    }) : state.boxes.get(note);
    const limits = containers.length ? intersection(containers.map((frame) => contentBox(frame, state.boxes.get(frame)))) : null;
    const obstacles = [...lines];
    for (const figure of figures) {
      if (figure === note || pending.has(figure) || figure.kind === 'group') continue;
      const box = state.boxes.get(figure);
      if (!containers.includes(figure)) obstacles.push(box);
      else if (figure.header) obstacles.push(headerBox(figure, box));
      obstacles.push(...projectedLabels(figure, box));
    }
    const box = nearestFreeBox(preferred, obstacles, limits, ROUTE_MARGIN, diagonals);
    if (!box) return { note, containers };
    state.boxes.set(note, box);
  }

  // A stationary annotation can still be affected by a moving shape.
  for (const { note, containers } of placements) {
    const box = state.boxes.get(note);
    const wasHit = (before, after) => intersects(box, after) && !intersects(note.box, before);
    if (containers.some((frame) => containsBox(frame.box, note.box) && !containsBox(state.boxes.get(frame), box)) ||
        figures.some((figure) => figure !== note && figure.kind !== 'group' && !containers.includes(figure) &&
          (wasHit(figure.box, state.boxes.get(figure)) || projectedLabels(figure, state.boxes.get(figure))
            .some((label, index) => wasHit(figure.labels[index], label))))) return { note, containers, fixed: true };
  }
  return null;
}

export function obstructedFlows({ annotations }, state, flows) {
  return flows.filter((edge) => {
    const current = state.routes.get(edge) ?? edge.points;
    const collides = (box, points) => segments(points).some(([a, b]) => cutsInterior(a, b, box)) ||
      edge.projectLabels?.(points).some((label) => intersects(label, box));
    return annotations.some((note) => {
      const box = state.boxes.get(note);
      return collides(box, current) && (changedBox(note.box, box) || !collides(note.box, edge.points));
    });
  });
}

export function routeAssociations(layout, state) {
  const { figures, associations, containers } = layout;
  for (const edge of associations) {
    const { source, target } = edge;
    const from = state.boxes.get(source);
    const to = state.boxes.get(target);
    const containing = new Set([...containers.get(source), ...containers.get(target)]);
    const obstacles = [];
    const points = state.routes.get(edge) ?? edge.points;
    const path = segments(points);
    const oldPath = segments(edge.points);
    const crosses = (segments, box) => segments.some(([a, b]) => cutsInterior(a, b, box));
    let affected = changedBox(source.box, from) || changedBox(target.box, to);
    for (const figure of figures) {
      if (figure.kind === 'group') continue;
      const box = state.boxes.get(figure);
      const before = [...figure.labels ?? []];
      const after = projectedLabels(figure, box);
      if (figure === source || figure === target || figure.kind !== 'lane' && !containing.has(figure)) {
        before.push(figure.box);
        after.push(box);
      } else if (figure.header) {
        before.push(headerBox(figure, figure.box));
        after.push(headerBox(figure, box));
      }
      obstacles.push(...after);
      affected ||= after.some((bounds, index) => changedBox(before[index], bounds) &&
        crosses(path, bounds) && !crosses(oldPath, before[index]));
    }
    if (!affected) continue;
    const area = boundsOf(obstacles);
    const bounds = { left: area.x - ROUTE_MARGIN * 2, top: area.y - ROUTE_MARGIN * 2,
      right: right(area) + ROUTE_MARGIN * 2, bottom: bottom(area) + ROUTE_MARGIN * 2 };
    const geometry = { source: from, target: to };
    const route = acceptsRoute(points, geometry, bounds, obstacles) ? points : routeFlow(geometry, bounds, obstacles);
    if (!route || !acceptsRoute(route, geometry, bounds, obstacles)) return false;
    state.routes.set(edge, route);
  }
  return true;
}
