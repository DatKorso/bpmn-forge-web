import { ceilGrid, intersects } from './layout.js';
import { ROUTE_MARGIN } from './route-flows.js';
import { collaboration, placePools, routeMessages } from './pool-layout.js';
import { isAnnotation, isFrame, obstructedFlows, placeAnnotations, routeAssociations } from './annotation-layout.js';
import { byId, right, bottom, sameBox, descendantOf, contains, validBox, clone, moveTree } from './alignment-state.js';
import { CONTAINER_INSET, resize, makeRoom, memberLane, newOverlap } from './container-fit.js';
import { fixedRoutes } from './fixed-routes.js';

function growAnnotationArea(diagram, state, { note, containers }, gaps, selection) {
  const frame = containers.at(-1);
  if (!frame || (selection && !selection.owned?.(frame) && !selection.pools?.has(frame))) return false;
  const cross = frame.horizontal === false ? 'x' : 'y';
  const span = cross === 'x' ? 'width' : 'height';
  const end = cross === 'x' ? right : bottom;

  function extend(container, amount) {
    const old = state.boxes.get(container);
    const next = { ...old, [span]: old[span] + amount };
    if (!validBox(next)) return false;
    let required = end(next);

    if (container.kind === 'lane') {
      const siblings = (diagram.scopes.get(container.scope) ?? []).filter((lane) =>
        lane.kind === 'lane' && lane !== container && lane.parent === container.parent)
        .sort((a, b) => state.boxes.get(a)[cross] - state.boxes.get(b)[cross] || byId(a, b));
      for (const lane of siblings) {
        const box = state.boxes.get(lane);
        if (box[cross] < end(old) || box[cross] >= required) continue;
        if (selection && !selection.owned?.(lane)) return false;
        shiftLane(diagram, state, lane, { x: 0, y: 0, [cross]: ceilGrid(required - box[cross]) });
        required = end(state.boxes.get(lane));
      }
    }

    const parent = container.kind === 'lane' ? (container.parent?.kind === 'lane' ? container.parent : container.scope)
      : container.expanded ? (container.lane ?? container.scope) : null;
    if (state.boxes.has(parent)) {
      const margin = container.expanded ? CONTAINER_INSET : 0;
      const extra = ceilGrid(required + margin - end(state.boxes.get(parent)));
      if (extra > 0 && (selection && !selection.owned?.(parent) || !extend(parent, extra))) return false;
    }

    resize(state, diagram, container, next);
    if ((!selection || selection.owned?.(container.scope)) && container.expanded) {
      makeRoom(state, diagram, container, old, gaps);
    }
    return true;
  }

  return extend(frame, ceilGrid(note.box[span] + ROUTE_MARGIN * 2));
}

function shiftLane(diagram, state, lane, delta) {
  const scoped = diagram.scopes.get(lane.scope);
  const lanes = scoped.filter((figure) => figure.kind === 'lane')
    .sort((a, b) => descendantOf(a, b) ? -1 : descendantOf(b, a) ? 1 : byId(a, b));
  const members = scoped.filter((figure) => figure.kind !== 'lane' && !figure.host)
    .filter((figure) => {
      const owner = memberLane(figure, lanes, state.boxes);
      return owner && (owner === lane || descendantOf(owner, lane)) && !descendantOf(figure, lane);
    });
  moveTree(state, diagram, lane, delta);
  for (const figure of members) moveTree(state, diagram, figure, delta);
}

export function finishAnnotations(diagram, planned, initial, messageFlows, gaps, selection) {
  const { notes } = diagram;
  if (!notes.annotations.length && !notes.associations.length) return planned;
  const state = clone(planned);
  const explicit = new Set(selection?.members?.filter(isAnnotation));
  for (const note of notes.annotations) {
    if (diagram.followers.has(note) && notes.containers.get(note).some((frame) => selection?.owned?.(frame))) {
      explicit.add(note);
    }
  }
  const flows = [...diagram.edges, ...messageFlows, ...diagram.internalEdges.filter((edge) =>
    !diagram.edges.includes(edge) && edge.type !== 'bpmn:Association')];
  const flexible = new Set();
  for (let attempt = 0; attempt <= notes.annotations.length; attempt++) {
    let placed = clone(state);
    let blocked = placeAnnotations(notes, placed, flows, explicit);
    if (blocked && !blocked.fixed && flexible.size) {
      // A flow can run through the new strip before its annotation is placed.
      placed = clone(state);
      blocked = placeAnnotations(notes, placed, flows.filter((edge) => !flexible.has(edge)), explicit);
    }
    if (!blocked) {
      const obstructed = obstructedFlows(notes, placed, flows);
      if (obstructed.length) {
        const collab = collaboration(notes.figures, messageFlows);
        const routes = fixedRoutes({ ...diagram, edges: obstructed.filter((edge) => diagram.edges.includes(edge)) },
          placed, new Map(), new Set(obstructed.flatMap(({ source, target }) => [source, target])), true);
        const messages = obstructed.some((edge) => messageFlows.includes(edge))
          ? routeMessages(collab, placed, initial, { selection: Boolean(selection) })
          : new Map();
        if (!routes || !messages) return null;
        placed.routes = new Map([...placed.routes, ...routes, ...messages]);
        if (obstructedFlows(notes, placed, flows).length) return null;
      }
      if (!routeAssociations(notes, placed, new Set(notes.figures.filter((figure) => selection?.owned?.(figure)))) ||
          [...placed.boxes.values()].some((box) => !validBox(box)) ||
          [...placed.routes.values()].some((path) => path.some(({ x, y }) =>
            ![x, y].every((value) => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)))) return null;
      return placed;
    }
    if (blocked.fixed || attempt === notes.annotations.length) return null;
    const before = clone(state);
    if (!growAnnotationArea(diagram, state, blocked, gaps, selection)) return null;
    const collab = collaboration(notes.figures, messageFlows, diagram.followers);
    const overlaps = collab.pools.some((pool, index) => collab.pools.slice(index + 1).some((other) =>
      intersects(state.boxes.get(pool), state.boxes.get(other))));
    if (overlaps) {
      if (selection) return null;
      const next = placePools(collab, state, initial, gaps, (plan, pool, shift) => moveTree(plan, diagram, pool, shift));
      if (!next.state) return null;
      state.boxes = next.state.boxes;
      state.routes = new Map([...next.state.routes, ...next.routes]);
    }
    const modified = new Map([...state.boxes].filter(([figure, box]) => !sameBox(before.boxes.get(figure), box)));
    const frames = notes.figures.filter(isFrame);
    for (const [figure, box] of modified) {
      if (diagram.followers.has(figure)) continue;
      if (newOverlap(state, before, figure, (diagram.children.get(figure.parent) ?? [])
        .filter((other) => !diagram.followers.has(other))) ||
          frames.some((container) => (figure.scope === container || figure.lane === container ||
            descendantOf(figure, container)) && contains(before.boxes.get(container), before.boxes.get(figure)) &&
            !contains(state.boxes.get(container), box))) return null;
    }
    const affected = new Set(diagram.edges.filter(({ source, target }) => modified.has(source) || modified.has(target) ||
      [...modified.keys()].some((figure) => isFrame(figure) && (source.scope === figure || source.scope === figure.scope)))
      .flatMap(({ source, target }) => [source, target]));
    const routes = fixedRoutes(diagram, state, modified, affected);
    const messages = routeMessages(collab, state, initial, { selection: Boolean(selection) });
    if (!routes || !messages) return null;
    for (const edge of routes.keys()) flexible.add(edge);
    for (const edge of messageFlows) {
      if (modified.has(edge.source) || modified.has(edge.target)) flexible.add(edge);
    }
    state.routes = new Map([...state.routes, ...routes, ...messages]);
  }
  return null;
}
