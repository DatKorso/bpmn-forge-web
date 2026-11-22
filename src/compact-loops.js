import { boundsOf, center, intersects } from './layout.js';
import { cutsInterior, routeCost, routeFlows, simplifyRoute } from './route-flows.js';
import { obstructedFlows } from './annotation-layout.js';
import { right, bottom, descendantOf, contains, validBox, clone } from './alignment-state.js';
import { usableArea } from './container-fit.js';
import { hasClearance, routingBounds } from './scope-plan.js';

export function preserveCompactLoops(state, loops, diagram, messageFlows, gaps) {
  const identity = (box) => box;
  const edges = [...diagram.internalEdges, ...messageFlows];
  for (const { task, left, right: rightGateway, entry, exit, main, scope, members, units, lanes, measureExcess } of loops) {
    const route = (edge) => state.routes.get(edge) ?? edge.points ?? [];
    const mainPath = simplifyRoute(route(main));
    if (task.parts.length !== 1 || mainPath.length !== 2 ||
        mainPath[0].y !== mainPath[1].y || mainPath[0].x >= mainPath[1].x) continue;

    const { figure, lane } = task;
    const old = state.boxes.get(figure);
    const merge = state.boxes.get(left.figure);
    const split = state.boxes.get(rightGateway.figure);
    const x = center(merge, 'x');
    const box = { ...old, x: x - old.width / 2 };
    const containers = [scope, lane].filter((container) => state.boxes.has(container));
    if (!validBox(box) || bottom(box) >= merge.y || center(merge, 'y') !== center(split, 'y') ||
        containers.some((container) => !contains(usableArea(container, state.boxes.get(container)), box)) ||
        lanes.some((other) => other !== lane && !descendantOf(figure, other) &&
          !(lane && descendantOf(lane, other)) && intersects(state.boxes.get(other), box))) continue;

    const obstacles = members.filter((member) => member !== figure).map((member) => state.boxes.get(member));
    const frame = state.boxes.get(scope);
    for (const note of diagram.notes.annotations) {
      const bounds = state.boxes.get(note);
      if (note.scope !== scope && (!frame || intersects(frame, bounds))) obstacles.push(bounds);
    }
    if (obstacles.some((other) => intersects(other, box)) ||
        units.some((unit) => unit !== task && unit.lane === lane &&
          !hasClearance(box, boundsOf(unit.parts.map((part) => state.boxes.get(part))), gaps))) continue;

    const stationary = edges.filter((edge) => edge !== entry && edge !== exit);
    if (stationary.some(({ source, target }) => source === figure || target === figure)) continue;
    const fixed = stationary.map(route);
    if (fixed.some((points) => points.slice(1).some((point, index) => cutsInterior(points[index], point, box)))) continue;

    const candidate = clone(state);
    candidate.boxes.set(figure, box);
    if (measureExcess && measureExcess(candidate, identity) > measureExcess(state, identity)) continue;
    obstacles.push(box);
    const bounds = routingBounds(scope, candidate, lanes, identity, obstacles);
    const routes = routeFlows([
      { id: exit.id, source: box, target: merge, isDefault: exit.isDefault },
      { id: entry.id, source: split, target: box, isDefault: entry.isDefault, back: true }
    ], bounds, obstacles, fixed);
    if (!routes) continue;
    const outbound = routes.get(exit.id);
    const inbound = routes.get(entry.id);
    if (outbound.length !== 2 || outbound.some((point) => point.x !== x) ||
        outbound[0].y !== bottom(box) || outbound[1].y !== merge.y || inbound.length !== 3) continue;
    const before = routeCost([route(exit), route(entry)], fixed);
    const after = routeCost([outbound, inbound], fixed);
    if (after[0] > before[0] || after[1] > before[1]) continue;

    candidate.routes.set(entry, inbound);
    candidate.routes.set(exit, outbound);
    if (obstructedFlows(diagram.notes, candidate, [entry, exit]).length) continue;
    state = candidate;
  }
  return state;
}
