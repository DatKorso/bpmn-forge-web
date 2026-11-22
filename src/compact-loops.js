import { boundsOf, center, intersects } from './layout.js';
import { cutsInterior, routeCost, routeFlows, simplifyRoute } from './route-flows.js';
import { obstructedFlows } from './annotation-layout.js';
import { right, bottom, descendantOf, contains, validBox, clone, transpose, localSpacing } from './alignment-state.js';
import { usableArea } from './container-fit.js';
import { hasClearance, routingBounds } from './scope-plan.js';

export function preserveCompactLoops(state, loops, diagram, messageFlows, gaps) {
  const edges = [...diagram.internalEdges, ...messageFlows];
  for (const { task, left, right: rightGateway, entry, exit, main, scope, members, units, lanes, measureExcess, vertical } of loops) {
    const local = vertical ? transpose : (box) => box;
    const point = vertical ? ({ x, y }) => ({ x: y, y: x }) : (value) => value;
    const spacing = localSpacing(gaps, vertical);
    const route = (edge) => state.routes.get(edge) ?? edge.points ?? [];
    const mainPath = simplifyRoute(route(main)).map(point);
    if (task.parts.length !== 1 || mainPath.length !== 2 ||
        mainPath[0].y !== mainPath[1].y || mainPath[0].x >= mainPath[1].x) continue;

    const { figure, lane } = task;
    const old = local(state.boxes.get(figure));
    const merge = local(state.boxes.get(left.figure));
    const split = local(state.boxes.get(rightGateway.figure));
    const x = center(merge, 'x');
    const box = { ...old, x: x - old.width / 2 };
    const worldBox = local(box);
    const containers = [scope, lane].filter((container) => state.boxes.has(container));
    if (!validBox(box) || bottom(box) >= merge.y || center(merge, 'y') !== center(split, 'y') ||
        containers.some((container) => !contains(usableArea(container, local(state.boxes.get(container))), box)) ||
        lanes.some((other) => other !== lane && !descendantOf(figure, other) &&
          !(lane && descendantOf(lane, other)) && intersects(state.boxes.get(other), worldBox))) continue;

    const obstacles = members.filter((member) => member !== figure).map((member) => state.boxes.get(member));
    const frame = state.boxes.get(scope);
    for (const note of diagram.notes.annotations) {
      const bounds = state.boxes.get(note);
      if (note.scope !== scope && (!frame || intersects(frame, bounds))) obstacles.push(bounds);
    }
    if (obstacles.some((other) => intersects(other, worldBox)) ||
        units.some((unit) => unit !== task && unit.lane === lane &&
          !hasClearance(box, local(boundsOf(unit.parts.map((part) => state.boxes.get(part)))), spacing))) continue;

    const stationary = edges.filter((edge) => edge !== entry && edge !== exit);
    if (stationary.some(({ source, target }) => source === figure || target === figure)) continue;
    const fixed = stationary.map(route);
    if (fixed.some((points) => points.slice(1).some((point, index) => cutsInterior(points[index], point, worldBox)))) continue;

    const candidate = clone(state);
    candidate.boxes.set(figure, worldBox);
    if (measureExcess && measureExcess(candidate, local) > measureExcess(state, local)) continue;
    obstacles.push(worldBox);
    const bounds = routingBounds(scope, candidate, lanes, local, obstacles);
    const routes = routeFlows([
      { id: exit.id, source: worldBox, target: state.boxes.get(left.figure), isDefault: exit.isDefault, vertical },
      { id: entry.id, source: state.boxes.get(rightGateway.figure), target: worldBox, isDefault: entry.isDefault, back: true, vertical }
    ], bounds, obstacles, fixed);
    if (!routes) continue;
    const outbound = routes.get(exit.id);
    const inbound = routes.get(entry.id);
    const localExit = outbound.map(point);
    if (localExit.length !== 2 || localExit.some(({ x: coordinate }) => coordinate !== x) ||
        localExit[0].y !== bottom(box) || localExit[1].y !== merge.y || inbound.length !== 3) continue;
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
