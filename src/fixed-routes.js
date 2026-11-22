import { boundsOf, center } from './layout.js';
import { acceptsRoute, compareCosts, cutsInterior, ROUTE_MARGIN, routeCost, routeFlows, translatedRouteIsClear } from './route-flows.js';
import { right, bottom, transpose, contains } from './alignment-state.js';
import { usableArea } from './container-fit.js';

export function fixedRoutes(diagram, state, boxes, movable, finalAnnotations = false, fitted = new Set()) {
  const edgesToRoute = fitted.size
    ? diagram.internalEdges.filter((edge) => !diagram.notes.associations.includes(edge) && edge.source.scope === edge.target.scope)
    : diagram.edges;
  const resizedFrames = [...boxes].filter(([figure]) => figure.expanded);
  const affected = edgesToRoute.filter(({ source, target, points }) =>
    boxes.has(source) || boxes.has(target) || movable?.has(source) || movable?.has(target) || fitted.has(source.scope) ||
    points?.slice(1).some((point, index) => resizedFrames.some(([figure, box]) =>
      figure.scope === source.scope &&
      cutsInterior(points[index], point, box) && !cutsInterior(points[index], point, figure.box))));
  const result = new Map();
  for (const [scope, edges] of Map.groupBy(affected, ({ source }) => source.scope)) {
    const flip = scope.horizontal === false;
    const local = flip ? transpose : (box) => box;
    const members = diagram.scopes.get(scope) ?? [];
    const frame = state.boxes.get(scope);
    const obstacles = members.filter((figure) => figure.kind !== 'lane' && figure.kind !== 'group' &&
      (finalAnnotations || !diagram.followers.has(figure))).map((figure) => state.boxes.get(figure));
    if (finalAnnotations && frame) {
      for (const note of diagram.notes.annotations) {
        const box = state.boxes.get(note);
        if (note.scope !== scope && contains(frame, box)) obstacles.push(box);
      }
    }
    for (const lane of members.filter((figure) => figure.kind === 'lane')) {
      const box = local(state.boxes.get(lane));
      obstacles.push(local({ ...box, width: lane.header }));
    }
    const drawing = frame ?? boundsOf(obstacles);
    const pad = frame ? 0 : ROUTE_MARGIN * 2;
    const content = frame ? local(usableArea(scope, local(frame), false)) : drawing;
    const bounds = { left: content.x - pad, top: content.y - pad,
      right: right(content) + pad, bottom: bottom(content) + pad };
    const pending = [];
    const existing = new Map();
    for (const edge of edges) {
      const source = state.boxes.get(edge.source);
      const target = state.boxes.get(edge.target);
      const axis = flip ? 'y' : 'x';
      const flow = { id: edge.id, source, target, isDefault: edge.isDefault, vertical: flip,
        back: center(target, axis) < center(source, axis) };
      const translated = state.routes.get(edge);
      const clear = fitted.size ? acceptsRoute : translatedRouteIsClear;
      if (translated && clear(translated, flow, bounds, obstacles)) result.set(edge, translated);
      else {
        pending.push(flow);
        if ((movable || fitted.size) && acceptsRoute(edge.points, flow, bounds, obstacles)) existing.set(edge.id, edge.points);
      }
    }
    let routes = routeFlows(pending, bounds, obstacles);
    if ((movable || fitted.size) && existing.size === pending.length &&
        (!routes || compareCosts(routeCost(existing.values()), routeCost(routes.values())) <= 0)) routes = existing;
    if (!routes) return null;
    for (const edge of edges) {
      if (routes.has(edge.id)) result.set(edge, routes.get(edge.id));
    }
  }
  return result;
}
