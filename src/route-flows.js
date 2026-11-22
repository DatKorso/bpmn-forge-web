const EPSILON = 1e-7;
export const ROUTE_MARGIN = 8;

const right = ({ x, width }) => x + width;
const bottom = ({ y, height }) => y + height;
const length = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const horizontal = (a, b) => a.y === b.y;
const segments = (points) => points.slice(1).map((point, index) => [points[index], point]);

export function compareCosts(a, b) {
  for (let index = 0; index < a.length; index++) {
    const difference = a[index] - b[index];
    if (Math.abs(difference) > EPSILON) return difference;
  }
  return 0;
}

function interaction([a, b], [c, d], includeStart = false) {
  if (a.x !== b.x && a.y !== b.y || c.x !== d.x && c.y !== d.y) {
    // Imported connections can be diagonal. A new orthogonal segment can
    // cross one, but cannot share any of its length.
    const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return [Number(side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0), 0];
  }
  const h = horizontal(a, b);
  if (h === horizontal(c, d)) {
    const axis = h ? 'x' : 'y';
    const cross = h ? 'y' : 'x';
    if (a[cross] !== c[cross]) return [0, 0];
    return [0, Math.max(0, Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])))];
  }

  const axis = h ? 'x' : 'y';
  const cross = h ? 'y' : 'x';
  const low = Math.min(a[axis], b[axis]);
  const crosses = (includeStart ? c[axis] >= low : c[axis] > low) &&
    c[axis] < Math.max(a[axis], b[axis]) &&
    a[cross] > Math.min(c[cross], d[cross]) && a[cross] < Math.max(c[cross], d[cross]);
  return [Number(crosses), 0];
}

function interactionCost(segment, otherSegments, includeStart) {
  let crossings = 0;
  let overlap = 0;
  for (const other of otherSegments) {
    const [count, shared] = interaction(segment, other, includeStart);
    crossings += count;
    overlap += shared;
  }
  return [crossings, overlap];
}

function lowerBound(levels, value) {
  let start = 0;
  let end = levels.length;
  while (start < end) {
    const middle = (start + end) >>> 1;
    if (levels[middle] < value) start = middle + 1;
    else end = middle;
  }
  return start;
}

function occupiedIndex(segments) {
  const horizontalLines = { levels: [], spans: new Map() };
  const verticalLines = { levels: [], spans: new Map() };
  const diagonals = [];
  const all = [];

  function add(segment) {
    const [a, b] = segment;
    all.push(segment);
    const h = horizontal(a, b);
    if (!h && a.x !== b.x) {
      diagonals.push(segment);
      return;
    }
    const lines = h ? horizontalLines : verticalLines;
    const level = h ? a.y : a.x;
    const start = h ? a.x : a.y;
    const end = h ? b.x : b.y;
    if (!lines.spans.has(level)) {
      lines.levels.splice(lowerBound(lines.levels, level), 0, level);
      lines.spans.set(level, []);
    }
    lines.spans.get(level).push([Math.min(start, end), Math.max(start, end)]);
  }

  function cost(a, b, includeStart) {
    const h = horizontal(a, b);
    if (!h && a.x !== b.x) return interactionCost([a, b], all, includeStart);
    const parallel = h ? horizontalLines : verticalLines;
    const perpendicular = h ? verticalLines : horizontalLines;
    const level = h ? a.y : a.x;
    const start = h ? a.x : a.y;
    const end = h ? b.x : b.y;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    let overlap = 0;
    // Preserve insertion order when summing fractional overlaps.
    for (const [from, to] of parallel.spans.get(level) ?? []) {
      overlap += Math.max(0, Math.min(high, to) - Math.max(low, from));
    }
    let crossings = 0;
    const { levels, spans } = perpendicular;
    for (let i = lowerBound(levels, low); i < levels.length && levels[i] < high; i++) {
      if (!includeStart && levels[i] === low) continue;
      for (const [from, to] of spans.get(levels[i])) {
        if (from < level && level < to) crossings++;
      }
    }
    for (const diagonal of diagonals) crossings += interaction([a, b], diagonal, includeStart)[0];
    return [crossings, overlap];
  }

  for (const segment of segments) add(segment);
  return { add, cost };
}

export function simplifyRoute(points) {
  const result = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && length(last, point) < EPSILON) continue;
    const previous = result.at(-2);
    if (previous && (previous.x === point.x && point.x === last.x ||
        previous.y === point.y && point.y === last.y) &&
        length(previous, point) === length(previous, last) + length(last, point)) result.pop();
    result.push(point);
  }
  return result;
}

export function routeCost(routes, fixed = []) {
  const cost = [0, 0, 0, 0];
  const seen = fixed.flatMap((points) => segments(simplifyRoute(points)));
  for (const points of routes) {
    const path = segments(simplifyRoute(points));
    for (const segment of path) {
      const [crossings, overlap] = interactionCost(segment, seen);
      cost[0] += crossings;
      cost[1] += overlap;
      cost[3] += length(...segment);
    }
    seen.push(...path);
    cost[2] += Math.max(0, path.length - 1);
  }
  return cost;
}

function inside(point, { left, right, top, bottom }) {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

export function cutsInterior(a, b, rect) {
  if (horizontal(a, b)) {
    return a.y > rect.y && a.y < bottom(rect) &&
      Math.min(a.x, b.x) < right(rect) && Math.max(a.x, b.x) > rect.x;
  }
  if (a.x === b.x) {
    return a.x > rect.x && a.x < right(rect) &&
      Math.min(a.y, b.y) < bottom(rect) && Math.max(a.y, b.y) > rect.y;
  }
  const x = [(rect.x - a.x) / (b.x - a.x), (right(rect) - a.x) / (b.x - a.x)];
  const y = [(rect.y - a.y) / (b.y - a.y), (bottom(rect) - a.y) / (b.y - a.y)];
  return Math.max(0, Math.min(...x), Math.min(...y)) < Math.min(1, Math.max(...x), Math.max(...y));
}

// Reuse the obstacle bounds across routes in a candidate. Prefix maxima let
// the search stop even when a large frame overlaps several smaller shapes.
function obstacleIndex(obstacles) {
  const ordered = obstacles.toSorted((a, b) => a.x - b.x);
  let far = -Infinity;
  const ends = ordered.map((rect) => (far = Math.max(far, right(rect))));
  const cache = new Map();
  return (a, b) => {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const axisAligned = a.x === b.x || a.y === b.y;
    const key = axisAligned && `${minX},${maxX},${minY},${maxY}`;
    if (key && cache.has(key)) return cache.get(key);
    let low = 0;
    let high = ordered.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ordered[mid].x < maxX) low = mid + 1;
      else high = mid;
    }
    let blocked = false;
    for (let index = low - 1; index >= 0 && ends[index] > minX; index--) {
      const rect = ordered[index];
      if (rect.y < maxY && bottom(rect) > minY && cutsInterior(a, b, rect)) {
        blocked = true;
        break;
      }
    }
    if (key) {
      if (cache.size >= 8192) cache.clear();
      cache.set(key, blocked);
    }
    return blocked;
  };
}

export function translatedRouteIsClear(points, { source, target }, bounds, obstacles) {
  const others = obstacles.filter((rect) => rect !== source && rect !== target);
  return points.length >= 2 && points.every((point) => inside(point, bounds)) &&
    segments(points).every(([a, b]) => !others.some((rect) => cutsInterior(a, b, rect)));
}

function getPorts(rect, bounds, blocked, projection) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const ports = [
    [{ x: right(rect), y }, 1, 0],
    [{ x, y: bottom(rect) }, 0, 1],
    [{ x: rect.x, y }, -1, 0],
    [{ x, y: rect.y }, 0, -1]
  ];
  if (projection) {
    const insetX = Math.min(ROUTE_MARGIN, rect.width / 2);
    const insetY = Math.min(ROUTE_MARGIN, rect.height / 2);
    const px = Math.max(rect.x + insetX, Math.min(right(rect) - insetX, projection.x));
    const py = Math.max(rect.y + insetY, Math.min(bottom(rect) - insetY, projection.y));
    ports.unshift([{ x: right(rect), y: py }, 1, 0], [{ x: px, y: bottom(rect) }, 0, 1],
      [{ x: rect.x, y: py }, -1, 0], [{ x: px, y: rect.y }, 0, -1]);
  }
  return ports.flatMap(([anchor, dx, dy]) => {
    if (!inside(anchor, bounds)) return [];
    for (const margin of [ROUTE_MARGIN, 1]) {
      const exit = { x: anchor.x + dx * margin, y: anchor.y + dy * margin };
      if (inside(exit, bounds) && !blocked(anchor, exit)) {
        return [[anchor, exit, dx ? 0 : 1]];
      }
    }
    return [];
  });
}

class Queue {
  items = [];

  push(entry) {
    const { items } = this;
    let index = items.length;
    while (index) {
      const parent = (index - 1) >> 1;
      if (compareCosts(items[parent].priority, entry.priority) <= 0) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = entry;
  }

  pop() {
    const { items } = this;
    const first = items[0];
    const last = items.pop();
    if (!items.length) return first;
    let index = 0;
    while (index * 2 + 1 < items.length) {
      let child = index * 2 + 1;
      if (child + 1 < items.length && compareCosts(items[child + 1].priority, items[child].priority) < 0) child++;
      if (compareCosts(last.priority, items[child].priority) <= 0) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}

function gridCoordinates(obstacles, ports, bounds, axis, frames) {
  const start = axis === 'x' ? bounds.left : bounds.top;
  const end = axis === 'x' ? bounds.right : bounds.bottom;
  const far = axis === 'x' ? right : bottom;
  const coordinates = [start, end, ...ports.map(([, exit]) => exit[axis])];
  for (const rect of obstacles) {
    coordinates.push(rect[axis] - ROUTE_MARGIN, far(rect) + ROUTE_MARGIN);
  }
  for (const frame of frames) {
    coordinates.push(frame[axis], far(frame));
  }
  return [...new Set(coordinates.filter((value) => Number.isFinite(value) && value >= start && value <= end))]
    .sort((a, b) => a - b);
}

function addCost(a, b) {
  return a.map((value, index) => value + b[index]);
}

export function routeFlow(flow, bounds, obstacles, occupied = []) {
  return findRoute(flow, bounds, obstacles, occupiedIndex(occupied).cost, obstacleIndex(obstacles));
}

function findRoute(flow, bounds, obstacles, occupiedCost, blocked) {
  const { passage, frames = [], startPhase = 0, sourceProjection, targetProjection } = flow;
  const advance = passage ?? ((phase) => phase);
  const { source, target } = flow;
  const starts = getPorts(source, bounds, blocked, sourceProjection);
  const ends = getPorts(target, bounds, blocked, targetProjection);
  if (!starts.length || !ends.length) return null;

  const progressAxis = flow.vertical ? 'y' : 'x';
  const sourceEnd = flow.vertical ? bottom(source) : right(source);
  const advances = !passage && !flow.back && sourceEnd <= target[progressAxis];
  function segmentCost(a, b, bend, includeStart) {
    const [crossings, overlap] = occupiedCost(a, b, includeStart);
    // Prefer a forward path even when outgoing branches need to share a stem.
    const retreat = advances ? Math.max(0, a[progressAxis] - b[progressAxis]) : 0;
    return [crossings, retreat, overlap, Number(bend), length(a, b)];
  }

  const emptyCost = [0, 0, 0, 0, 0];
  let winner;
  function consider(points) {
    if (points.length > (passage ? 4 : 3) || !routeIsClear(points, flow, bounds, blocked)) return;
    const path = segments(points);
    if (passage && path.reduce((phase, [a, b]) => phase < 0 ? phase : advance(phase, a, b), startPhase) < 0) return;
    const score = path.reduce((cost, [a, b], index) =>
      addCost(cost, segmentCost(a, b, index > 0, false)), emptyCost);
    if (!winner || compareCosts(score, winner.cost) < 0) winner = { points, cost: score };
  }

  for (const [a, exit] of starts) {
    for (const [b, entry] of ends) {
      if (length(a, b) < EPSILON) continue;
      if ((a.x === b.x || a.y === b.y) &&
          length(exit, b) < length(a, b) && length(entry, a) < length(a, b)) consider([a, b]);
      for (const elbow of [{ x: exit.x, y: entry.y }, { x: entry.x, y: exit.y }]) {
        consider(simplifyRoute([a, exit, elbow, entry, b]));
      }
    }
  }
  // A clear path with at most one bend already meets the lower bound.
  if (winner && winner.cost.slice(0, 3).every((value) => value === 0)) return winner.points;

  const ports = [...starts, ...ends];
  const xs = gridCoordinates(obstacles, ports, bounds, 'x', frames);
  const ys = gridCoordinates(obstacles, ports, bounds, 'y', frames);
  if (passage) {
    for (const [a, exit, fromDirection] of starts) {
      for (const [b, entry, toDirection] of ends) {
        if (fromDirection !== toDirection) continue;
        const axis = fromDirection ? 'y' : 'x';
        const channels = fromDirection ? ys : xs;
        for (const value of channels) {
          consider(simplifyRoute([a, exit, { ...exit, [axis]: value }, { ...entry, [axis]: value }, entry, b]));
        }
      }
    }
    if (winner && winner.cost.slice(0, 3).every((value) => value === 0)) return winner.points;
  }

  const startXs = new Map(xs.map((value, index) => [value, index]));
  const startYs = new Map(ys.map((value, index) => [value, index]));
  const queue = new Queue();
  const best = new Map();
  const neighbors = new Map();
  const isLoop = source === target;
  const axis = flow.vertical ? 'x' : 'y';
  const sides = axis === 'y' ? [bounds.top, bounds.bottom] : [bounds.left, bounds.right];
  const key = (i, j) => i * ys.length + j;
  const exits = Map.groupBy(ends, (port) => key(startXs.get(port[1].x), startYs.get(port[1].y)));

  function enqueue(state) {
    if (state.phase < 0) return;
    const id = (((key(state.i, state.j) * 3 + state.phase) * 2 + state.direction) * (isLoop ? starts.length : 1)) +
      (isLoop ? state.start : 0);
    if (best.has(id) && compareCosts(best.get(id), state.cost) <= 0) return;
    best.set(id, state.cost);
    queue.push({ ...state, id, priority: priority(state) });
  }

  function priority({ cost, point, direction }) {
    if (passage) {
      // Lower bounds on the remaining turns and length keep the search near useful corridors.
      let bends = Infinity;
      let distance = Infinity;
      for (const [anchor, port, endDirection] of ends) {
        const x = point.x !== port.x;
        const y = point.y !== port.y;
        let turns = Number(direction !== endDirection);
        if (x && y) turns = 1 + Number(direction === endDirection);
        else if (x || y) turns = Number(direction !== Number(y)) + Number(endDirection !== Number(y));
        bends = Math.min(bends, turns);
        distance = Math.min(distance, length(point, port) + length(port, anchor));
      }
      return [...cost.slice(0, 3), cost[3] + bends, cost[4] + distance];
    }
    // A small tie-break preference keeps return flows away from the main line.
    if (!flow.back || !sides.every(Number.isFinite)) return cost;
    return [...cost, Math.min(...sides.map((side) => Math.abs(point[axis] - side)))];
  }

  starts.forEach(([anchor, exit, direction], start) => enqueue({
    i: startXs.get(exit.x), j: startYs.get(exit.y), point: exit, start, direction, phase: advance(startPhase, anchor, exit),
    cost: segmentCost(anchor, exit, false, true)
  }));

  while (queue.items.length) {
    const state = queue.pop();
    const { i, j, point, start, direction } = state;
    if (best.get(state.id) !== state.cost) continue;
    const { cost } = state;
    if (winner && compareCosts(state.priority.slice(0, emptyCost.length), winner.cost) >= 0) break;

    for (const [anchor, , endDirection] of exits.get(key(i, j)) ?? []) {
      if (advance(state.phase, point, anchor) < 0) continue;
      if (isLoop && length(anchor, starts[start][0]) < EPSILON) continue;
      const final = addCost(cost, segmentCost(point, anchor, endDirection !== direction, true));
      if (!winner || compareCosts(final, winner.cost) < 0) {
        const points = [anchor];
        for (let step = state; step; step = step.previous) points.push(step.point);
        points.push(starts[start][0]);
        winner = { points: simplifyRoute(points.reverse()), cost: final };
      }
    }

    const cell = key(i, j);
    if (!neighbors.has(cell)) {
      const adjacent = [];
      for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || ni >= xs.length || nj < 0 || nj >= ys.length) continue;
        const next = { x: xs[ni], y: ys[nj] };
        if (!blocked(point, next)) {
          adjacent.push({ i: ni, j: nj, point: next, direction: di ? 0 : 1 });
        }
      }
      neighbors.set(cell, adjacent);
    }

    for (const next of neighbors.get(cell)) {
      const total = addCost(cost, segmentCost(point, next.point, next.direction !== direction, true));
      enqueue({ ...next, start, previous: state, phase: advance(state.phase, point, next.point),
        cost: total });
    }
  }

  return winner?.points ?? null;
}

export function routeFlows(flows, bounds, obstacles, fixed = []) {
  const routes = new Map();
  const occupied = occupiedIndex(fixed.flatMap((points) => segments(simplifyRoute(points))));
  const blocked = obstacleIndex(obstacles);
  const straight = new Set(flows.filter((flow) => !flow.back && hasStraightRoute(flow, bounds, blocked)));
  // Reserve clear straight paths before off-row branches can occupy their ports.
  const ordered = [...flows].sort((a, b) => Number(!!a.back) - Number(!!b.back) ||
    Number(straight.has(b)) - Number(straight.has(a)) ||
    Number(!!b.isDefault) - Number(!!a.isDefault) || (a.id < b.id ? -1 : 1));

  for (const flow of ordered) {
    const route = findRoute(flow, bounds, obstacles, occupied.cost, blocked);
    if (!route) return null;
    routes.set(flow.id, route);
    for (const segment of segments(route)) occupied.add(segment);
  }
  return routes;
}

function hasStraightRoute(flow, bounds, blocked) {
  const { source, target } = flow;
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  if (from.y === to.y) {
    const [a, b] = from.x < to.x ? [right(source), target.x] : [source.x, right(target)];
    return (b - a) * (to.x - from.x) > 0 &&
      routeIsClear([{ x: a, y: from.y }, { x: b, y: to.y }], flow, bounds, blocked);
  }
  if (from.x === to.x) {
    const [a, b] = from.y < to.y ? [bottom(source), target.y] : [source.y, bottom(target)];
    return (b - a) * (to.y - from.y) > 0 &&
      routeIsClear([{ x: from.x, y: a }, { x: to.x, y: b }], flow, bounds, blocked);
  }
  return false;
}

function onBoundary(point, rect) {
  return point.x >= rect.x && point.x <= right(rect) && point.y >= rect.y && point.y <= bottom(rect) &&
    (point.x === rect.x || point.x === right(rect) || point.y === rect.y || point.y === bottom(rect));
}

export function acceptsRoute(points, flow, bounds, obstacles) {
  return routeIsClear(points, flow, bounds, (a, b) => obstacles.some((rect) => cutsInterior(a, b, rect)));
}

function routeIsClear(points, { source, target }, bounds, blocked) {
  if (!points || points.length < 2 || !onBoundary(points[0], source) || !onBoundary(points.at(-1), target)) {
    return false;
  }
  if (source === target && length(points[0], points.at(-1)) < EPSILON) return false;
  return points.every((point) => inside(point, bounds)) &&
    segments(points).every(([a, b]) => (a.x === b.x || a.y === b.y) &&
      !blocked(a, b));
}
