import { boundsOf, center, intersects } from './layout.js';
import { acceptsRoute, compareCosts, cutsInterior, ROUTE_MARGIN, routeCost, routeFlow } from './route-flows.js';

const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const far = (box, axis) => box[axis] + box[axis === 'x' ? 'width' : 'height'];
const middle = (box) => ({ x: center(box, 'x'), y: center(box, 'y') });
const segments = (points) => points.slice(1).map((point, i) => [points[i], point]);
const samePoints = (a, b) => b && a.length === b.length &&
  a.every((point, index) => point.x === b[index].x && point.y === b[index].y);

function ancestors(figure) {
  const chain = [];
  for (let current = figure; current; current = current.parent) chain.push(current);
  return chain;
}

const inFrame = (point, frame) => point.x >= frame.x && point.x <= far(frame, 'x') &&
  point.y >= frame.y && point.y <= far(frame, 'y');

function passageBetween(source, target) {
  // The route progresses from the source interior (0) to the exterior (1) to the target interior (2).
  return (phase, a, b) => {
    if (a.x === b.x && a.y === b.y) return phase;
    const crossesSource = source && cutsInterior(a, b, source);
    const crossesTarget = target && cutsInterior(a, b, target);
    if (crossesSource && (phase !== 0 || !inFrame(a, source))) return -1;
    if ((crossesTarget && !inFrame(b, target)) || (phase === 2 && !crossesTarget)) return -1;
    if (crossesTarget) return 2;
    return crossesSource && inFrame(b, source) ? 0 : 1;
  };
}

function headerBox(figure, box) {
  return figure.horizontal === false
    ? { ...box, height: Math.min(box.height, figure.header) }
    : { ...box, width: Math.min(box.width, figure.header) };
}

export function collaboration(figures, messageFlows, pending = new Set()) {
  const pools = figures.filter(({ kind }) => kind === 'pool').sort(byId);
  const chain = new Map(figures.map((figure) => [figure, ancestors(figure)]));
  const owner = new Map(figures.map((figure) =>
    [figure, chain.get(figure).find(({ kind }) => kind === 'pool')]));
  const members = Map.groupBy(figures, (figure) => owner.get(figure));
  const messages = [...messageFlows].sort(byId).map((edge) => ({
    edge, sourcePool: owner.get(edge.source), targetPool: owner.get(edge.target)
  }));
  const incident = new Map(pools.map((pool) => [pool, messages.filter(({ sourcePool, targetPool }) =>
    sourcePool !== targetPool && (sourcePool === pool || targetPool === pool))]));
  const activity = new Map(pools.map((pool) => [pool, members.get(pool).filter(({ type }) =>
    /(?:Task|Event)$/.test(type ?? '')).length]));
  const anchor = [...pools].sort((a, b) =>
    activity.get(b) - activity.get(a) || incident.get(b).length - incident.get(a).length || byId(a, b))[0];
  return { pools, messages, members, chain, incident, anchor, pending, figures };
}

function messageGeometry({ pools, members, chain, pending, figures }, boxes, { edge, sourcePool, targetPool }) {
  if (!sourcePool || !targetPool || sourcePool === targetPool) return null;
  const { source, target } = edge;
  const sourceFrame = boxes.get(sourcePool);
  const targetFrame = boxes.get(targetPool);
  const from = boxes.get(source);
  const to = boxes.get(target);
  const fromFrame = source === sourcePool;
  const toFrame = target === targetPool;
  if ((!fromFrame && !inFrame(middle(from), sourceFrame)) ||
      (!toFrame && !inFrame(middle(to), targetFrame))) return null;
  const obstacles = [from, to];
  for (const pool of pools) {
    const box = boxes.get(pool);
    if (pool !== sourcePool && pool !== targetPool) {
      obstacles.push(box);
      continue;
    }
    const endpoint = pool === sourcePool ? source : target;
    for (const figure of members.get(pool)) {
      if (figure.kind === 'group' || pending.has(figure)) continue;
      const bounds = boxes.get(figure);
      if (figure.kind === 'pool' || figure.kind === 'lane') {
        if (figure.header) obstacles.push(headerBox(figure, bounds));
      } else if (!chain.get(endpoint).includes(figure)) {
        obstacles.push(bounds);
      }
    }
  }
  for (const figure of figures) {
    if (figure.type === 'bpmn:TextAnnotation' && !pending.has(figure) &&
        !members.get(sourcePool).includes(figure) && !members.get(targetPool).includes(figure)) {
      obstacles.push(boxes.get(figure));
    }
  }
  const passage = passageBetween(fromFrame ? null : sourceFrame, toFrame ? null : targetFrame);
  const startPhase = fromFrame ? 1 : 0;
  return { source: from, target: to, obstacles, passage, startPhase, frames: [sourceFrame, targetFrame],
    sourceProjection: fromFrame ? middle(to) : undefined, targetProjection: toFrame ? middle(from) : undefined };
}

export function routeMessages(collab, state, original, { selection = false, reference } = {}) {
  const { boxes } = state;
  const { pools, messages } = collab;
  if (!messages.length) return new Map();
  const area = boundsOf(pools.map((pool) => boxes.get(pool)));
  const margin = ROUTE_MARGIN * 2;
  const bounds = { left: area.x - margin, top: area.y - margin,
    right: far(area, 'x') + margin, bottom: far(area, 'y') + margin };
  const routes = new Map();
  const occupied = [];
  const paths = [];
  const pending = [];
  for (const message of messages) {
    const { edge } = message;
    const affected = boxes.get(edge.source) !== original.boxes.get(edge.source) ||
      boxes.get(edge.target) !== original.boxes.get(edge.target);
    const geometry = messageGeometry(collab, boxes, message);
    if (!geometry) {
      if (!selection || affected) return null;
      continue;
    }
    const { obstacles, passage, startPhase } = geometry;
    const prior = reference?.routes?.get(edge);
    const existing = prior ?? original.routes.get(edge) ?? edge.points;
    const unchanged = reference && [edge.source, edge.target].every((figure) => {
      const before = reference.state.boxes.get(figure);
      const after = boxes.get(figure);
      return before.x === after.x && before.y === after.y;
    });
    const valid = acceptsRoute(existing, geometry, bounds, obstacles) &&
      segments(existing).reduce((phase, [a, b]) => phase < 0 ? phase : passage(phase, a, b), startPhase) >= 0;
    if (valid && ((!affected && !reference) || (prior && unchanged))) {
      routes.set(edge, existing);
      occupied.push(...segments(existing));
      paths.push(existing);
      continue;
    }
    if (selection && !affected && !valid && existing?.length >= 2) {
      const before = (prior ? reference.state : original).boxes;
      const path = segments(existing);
      const crosses = (box) => path.some(([a, b]) => cutsInterior(a, b, box));
      const poolMovedAcross = pools.some((pool) => before.get(pool) !== boxes.get(pool) &&
        crosses(boxes.get(pool)) && !crosses(before.get(pool)));
      const previous = messageGeometry(collab, before, message);
      const newlyBlocked = obstacles.some(crosses) && previous && !previous.obstacles.some(crosses);
      if (!poolMovedAcross && !newlyBlocked) continue;
    }
    pending.push({ edge, geometry, valid, existing });
  }
  const separation = ({ geometry: { source, target } }) => ['x', 'y'].reduce((sum, axis) =>
    sum + Math.max(0, source[axis] - far(target, axis), target[axis] - far(source, axis)), 0);
  pending.sort((a, b) => separation(a) - separation(b) || byId(a.edge, b.edge));
  for (const { edge, geometry, valid, existing } of pending) {
    const next = routeFlow(geometry, bounds, geometry.obstacles, occupied);
    const keep = valid && (!next || compareCosts(routeCost([...paths, existing]), routeCost([...paths, next])) <= 0);
    const points = keep ? existing : next;
    if (!points) return null;
    routes.set(edge, points);
    occupied.push(...segments(points));
    paths.push(points);
  }
  return routes;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[index] : (sorted[index - 1] + sorted[index]) / 2;
}

function connectionOffsets(collab, boxes, pool, axis, onlyWith) {
  const offsets = [];
  for (const { edge, sourcePool, targetPool } of collab.incident.get(pool)) {
    if (onlyWith && sourcePool !== onlyWith && targetPool !== onlyWith) continue;
    const [endpoint, other] = sourcePool === pool ? [edge.source, edge.target] : [edge.target, edge.source];
    const box = boxes.get(endpoint);
    const target = boxes.get(other);
    let from = center(box, axis);
    let to = center(target, axis);
    if (endpoint.kind === 'pool') from = Math.max(box[axis] + ROUTE_MARGIN,
      Math.min(far(box, axis) - ROUTE_MARGIN, to));
    if (other.kind === 'pool') to = Math.max(target[axis] + ROUTE_MARGIN,
      Math.min(far(target, axis) - ROUTE_MARGIN, from));
    offsets.push(to - from);
  }
  return offsets;
}

function lateralOverlap(a, b, axis) {
  return a[axis] < far(b, axis) && b[axis] < far(a, axis);
}

export function placePools(collab, initial, original, gaps, moveTree, selected) {
  const { pools, incident, anchor } = collab;
  if (!anchor) return { reason: 'routing' };
  const cross = anchor.horizontal === false ? 'x' : 'y';
  const along = cross === 'x' ? 'y' : 'x';
  const gap = Math.max(80, gaps[cross]);
  const start = original.boxes.get(anchor);
  const sides = new Map(pools.map((pool) => [pool, center(original.boxes.get(pool), cross) < center(start, cross) ? -1 : 1]));
  const movable = pools.filter((pool) => pool !== anchor && (!selected || selected.has(pool)));
  // Pools on one side can share several messages. Moving that group together preserves
  // their channels while letting the whole group line up with the anchor.
  const ungrouped = new Set(movable);
  const groups = [];
  for (const first of movable) {
    if (!ungrouped.delete(first)) continue;
    const group = [first];
    for (const pool of group) {
      for (const { sourcePool, targetPool } of incident.get(pool)) {
        const neighbor = sourcePool === pool ? targetPool : sourcePool;
        if (sides.get(neighbor) === sides.get(pool) && ungrouped.delete(neighbor)) group.push(neighbor);
      }
    }
    if (group.length > 1) groups.push(group.sort(byId));
  }
  const hasOverlap = (boxes) => pools.some((pool, index) => pools.slice(index + 1)
    .some((other) => intersects(boxes.get(pool), boxes.get(other))));
  const canPlace = (pool, box) => {
    const frame = initial.boxes.get(anchor);
    return [box.x, box.y, far(box, 'x'), far(box, 'y')].every((value) =>
      Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) &&
      (center(box, cross) - center(frame, cross)) * sides.get(pool) >= 0;
  };
  const reroute = (state, reference) => routeMessages(collab, state, original, {
    selection: Boolean(selected), reference
  });

  function placements(state, pool, resolveOverlap) {
    const { boxes } = state;
    const box = boxes.get(pool);
    const side = sides.get(pool);
    const frame = boxes.get(anchor);
    const linked = incident.get(pool).length;
    const clearance = linked || selected ? gap : 0;
    const thickness = far(box, cross) - box[cross];
    const width = far(box, along) - box[along];
    const border = side < 0 ? frame[cross] - thickness - clearance : far(frame, cross) + clearance;
    const at = (column, row) => ({ ...box, [along]: column, [cross]: row });
    const spacingFor = (other) => clearance && (incident.get(other).length || other === anchor || selected?.has(other)) ? gap : 0;
    const aligns = connectionOffsets(collab, boxes, pool, along);
    const desired = [box[along], ...aligns.map((shift) => box[along] + shift)];
    if (aligns.length) desired.push(box[along] + median(aligns));
    const columns = new Set(desired);
    const searchRow = resolveOverlap && !clearance ? box[cross] : border;
    const blockers = pools.filter((other) => {
      if (other === pool) return false;
      const rect = boxes.get(other);
      const spacing = spacingFor(other);
      return searchRow < far(rect, cross) + spacing && searchRow + thickness + spacing > rect[cross];
    }).map((other) => boxes.get(other));
    const free = (column) => blockers.every((rect) =>
      column + width <= rect[along] || column >= far(rect, along));
    const alongGap = clearance ? gaps[along] : 0;
    const edges = blockers.flatMap((rect) => [rect[along] - width - alongGap, far(rect, along) + alongGap])
      .filter(free).sort((a, b) => a - b);
    for (const column of desired) {
      if (free(column)) continue;
      const left = edges.findLast((value) => value < column);
      const right = edges.find((value) => value > column);
      if (left !== undefined) columns.add(left);
      if (right !== undefined) columns.add(right);
    }
    const results = [];
    for (const column of columns) {
      const neighbors = pools.filter((other) => other !== pool && lateralOverlap(at(column, border), boxes.get(other), along));
      const rows = new Set([border, box[cross]]);
      for (const other of neighbors) {
        const rect = boxes.get(other);
        const spacing = spacingFor(other);
        rows.add(rect[cross] - thickness - spacing);
        rows.add(far(rect, cross) + spacing);
      }
      const available = [...rows].filter((row) => {
        const candidate = at(column, row);
        if (!canPlace(pool, candidate)) return false;
        if (clearance && (row - border) * side < 0) return false;
        return neighbors.every((other) => {
          const rect = boxes.get(other);
          const spacing = spacingFor(other);
          return far(candidate, cross) + spacing <= rect[cross] || far(rect, cross) + spacing <= row;
        });
      }).sort((a, b) => Math.abs(a - border) - Math.abs(b - border) || a - b);
      if (available.length) results.push(at(column, available[0]));
      if (available.includes(box[cross]) && available[0] !== box[cross]) results.push(at(column, box[cross]));
    }
    return results;
  }

  const shifted = (state, pool, box) => {
    const before = state.boxes.get(pool);
    const next = { boxes: new Map(state.boxes), routes: new Map(state.routes) };
    moveTree(next, pool, { x: box.x - before.x, y: box.y - before.y });
    return next;
  };
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  function pass(previous) {
    let state = previous.state;
    // Establish a collision-free baseline and enforce the cross-axis clearance where relevant.
    for (const pool of movable) {
      const box = state.boxes.get(pool);
      const collides = pools.some((other) => other !== pool && intersects(box, state.boxes.get(other)));
      if (!collides && !incident.get(pool).length && !selected) continue;
      const candidates = placements(state, pool, collides);
      if (!candidates.some((candidate) => !distance(box, candidate))) {
        const next = candidates.sort((a, b) => distance(a, box) - distance(b, box))[0];
        if (next) state = shifted(state, pool, next);
      }
    }
    if (hasOverlap(state.boxes)) return null;
    let routes = state === previous.state ? previous.routes : reroute(state, previous);
    if (!collab.messages.length && !selected) return { state, routes };
    const cost = (candidate, paths) => paths && [...routeCost(paths.values()),
      movable.reduce((sum, pool) => sum + distance(candidate.boxes.get(pool), original.boxes.get(pool)), 0)];
    let score = cost(state, routes);
    function consider(next, reference) {
      const paths = reroute(next, reference);
      const nextScore = cost(next, paths);
      if (nextScore && (!score || compareCosts(nextScore, score) < 0)) {
        state = next;
        routes = paths;
        score = nextScore;
      }
    }
    for (const pool of movable) {
      if (!selected && !incident.get(pool).length) continue;
      const box = state.boxes.get(pool);
      const candidates = placements(state, pool, false);
      const reference = { state, routes };
      for (const candidate of candidates) {
        if (!distance(box, candidate)) continue;
        const next = shifted(reference.state, pool, candidate);
        consider(next, reference);
      }
    }
    for (const group of groups) {
      const reference = { state, routes };
      const offsets = group.flatMap((pool) => connectionOffsets(collab, reference.state.boxes, pool, along, anchor));
      if (offsets.length) offsets.push(median(offsets));
      for (const offset of new Set(offsets)) {
        if (!offset) continue;
        const next = { boxes: new Map(reference.state.boxes), routes: new Map(reference.state.routes) };
        for (const pool of group) moveTree(next, pool, { x: 0, y: 0, [along]: offset });
        if (hasOverlap(next.boxes) || group.some((pool) => !canPlace(pool, next.boxes.get(pool)))) continue;
        consider(next, reference);
      }
    }
    return routes && { state, routes };
  }

  let previous = { state: initial, routes: reroute(initial) };
  // The final pass only confirms that a fourth arrangement would make no changes.
  const maxPasses = 3;
  for (let attempt = 0; attempt <= maxPasses; attempt++) {
    const next = pass(previous);
    if (!next) return { reason: 'routing' };
    if (pools.every((pool) => !distance(previous.state.boxes.get(pool), next.state.boxes.get(pool))) &&
        previous.routes && next.routes.size === previous.routes.size &&
        [...next.routes].every(([edge, points]) => samePoints(points, previous.routes.get(edge)))) return next;
    previous = next;
  }
  return { reason: 'stability' };
}
