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

export function routeCost(routes) {
  const cost = [0, 0, 0, 0];
  const seen = [];
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

function cutsInterior(a, b, rect) {
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

export function translatedRouteIsClear(points, { source, target }, bounds, obstacles) {
  const others = obstacles.filter((rect) => rect !== source && rect !== target);
  return points.length >= 2 && points.every((point) => inside(point, bounds)) &&
    segments(points).every(([a, b]) => !others.some((rect) => cutsInterior(a, b, rect)));
}

function getPorts(rect, bounds, obstacles) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return [
    [{ x: right(rect), y }, 1, 0],
    [{ x, y: bottom(rect) }, 0, 1],
    [{ x: rect.x, y }, -1, 0],
    [{ x, y: rect.y }, 0, -1]
  ].flatMap(([anchor, dx, dy]) => {
    if (!inside(anchor, bounds)) return [];
    for (const margin of [ROUTE_MARGIN, 1]) {
      const exit = { x: anchor.x + dx * margin, y: anchor.y + dy * margin };
      if (inside(exit, bounds) && !obstacles.some((rect) => cutsInterior(anchor, exit, rect))) {
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
      if (compareCosts(items[parent].cost, entry.cost) <= 0) break;
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
      if (child + 1 < items.length && compareCosts(items[child + 1].cost, items[child].cost) < 0) child++;
      if (compareCosts(last.cost, items[child].cost) <= 0) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}

function gridCoordinates(obstacles, ports, bounds, axis) {
  const start = axis === 'x' ? bounds.left : bounds.top;
  const end = axis === 'x' ? bounds.right : bounds.bottom;
  const far = axis === 'x' ? right : bottom;
  const coordinates = [start, end, ...ports.map(([, exit]) => exit[axis])];
  for (const rect of obstacles) {
    coordinates.push(rect[axis] - ROUTE_MARGIN, far(rect) + ROUTE_MARGIN);
  }
  return [...new Set(coordinates.filter((value) => Number.isFinite(value) && value >= start && value <= end))]
    .sort((a, b) => a - b);
}

function addCost(a, b) {
  return a.map((value, index) => value + b[index]);
}

function routeFlow(flow, bounds, obstacles, occupied) {
  const { source, target } = flow;
  const starts = getPorts(source, bounds, obstacles);
  const ends = getPorts(target, bounds, obstacles);
  if (!starts.length || !ends.length) return null;

  const progressAxis = flow.vertical ? 'y' : 'x';
  const sourceEnd = flow.vertical ? bottom(source) : right(source);
  const advances = !flow.back && sourceEnd <= target[progressAxis];
  function segmentCost(a, b, bend, includeStart) {
    const [crossings, overlap] = interactionCost([a, b], occupied, includeStart);
    // Prefer a forward path even when outgoing branches need to share a stem.
    const retreat = advances ? Math.max(0, a[progressAxis] - b[progressAxis]) : 0;
    return [crossings, retreat, overlap, Number(bend), length(a, b)];
  }

  const emptyCost = [0, 0, 0, 0, 0];
  let winner;
  function consider(points) {
    if (points.length > 3 || !acceptsRoute(points, flow, bounds, obstacles)) return;
    const path = segments(points);
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
  const xs = gridCoordinates(obstacles, ports, bounds, 'x');
  const ys = gridCoordinates(obstacles, ports, bounds, 'y');
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
    const id = ((key(state.i, state.j) * 2 + state.direction) * (isLoop ? starts.length : 1)) +
      (isLoop ? state.start : 0);
    if (best.has(id) && compareCosts(best.get(id), state.cost) <= 0) return;
    best.set(id, state.cost);
    queue.push({ ...state, id });
  }

  // A small tie-break preference keeps return flows away from the main line.
  function priority(cost, point) {
    if (!flow.back || !sides.every(Number.isFinite)) return cost;
    return [...cost, Math.min(...sides.map((side) => Math.abs(point[axis] - side)))];
  }

  starts.forEach(([anchor, exit, direction], start) => enqueue({
    i: startXs.get(exit.x), j: startYs.get(exit.y), point: exit, start, direction,
    cost: priority(segmentCost(anchor, exit, false, true), exit)
  }));

  while (queue.items.length) {
    const state = queue.pop();
    const { i, j, point, start, direction } = state;
    if (best.get(state.id) !== state.cost) continue;
    const cost = state.cost.slice(0, emptyCost.length);
    if (winner && compareCosts(cost, winner.cost) >= 0) break;

    for (const [anchor, , endDirection] of exits.get(key(i, j)) ?? []) {
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
        if (!obstacles.some((rect) => cutsInterior(point, next, rect))) {
          adjacent.push({ i: ni, j: nj, point: next, direction: di ? 0 : 1 });
        }
      }
      neighbors.set(cell, adjacent);
    }

    for (const next of neighbors.get(cell)) {
      const total = addCost(cost, segmentCost(point, next.point, next.direction !== direction, true));
      enqueue({ ...next, start, previous: state, cost: priority(total, next.point) });
    }
  }

  return winner?.points ?? null;
}

export function routeFlows(flows, bounds, obstacles) {
  const routes = new Map();
  const occupied = [];
  const straight = new Set(flows.filter((flow) => !flow.back && hasStraightRoute(flow, bounds, obstacles)));
  // Reserve clear straight paths before off-row branches can occupy their ports.
  const ordered = [...flows].sort((a, b) => Number(!!a.back) - Number(!!b.back) ||
    Number(straight.has(b)) - Number(straight.has(a)) ||
    Number(!!b.isDefault) - Number(!!a.isDefault) || (a.id < b.id ? -1 : 1));

  for (const flow of ordered) {
    const route = routeFlow(flow, bounds, obstacles, occupied);
    if (!route) return null;
    routes.set(flow.id, route);
    occupied.push(...segments(route));
  }
  return routes;
}

function hasStraightRoute(flow, bounds, obstacles) {
  const { source, target } = flow;
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  if (from.y === to.y) {
    const [a, b] = from.x < to.x ? [right(source), target.x] : [source.x, right(target)];
    return (b - a) * (to.x - from.x) > 0 &&
      acceptsRoute([{ x: a, y: from.y }, { x: b, y: to.y }], flow, bounds, obstacles);
  }
  if (from.x === to.x) {
    const [a, b] = from.y < to.y ? [bottom(source), target.y] : [source.y, bottom(target)];
    return (b - a) * (to.y - from.y) > 0 &&
      acceptsRoute([{ x: from.x, y: a }, { x: to.x, y: b }], flow, bounds, obstacles);
  }
  return false;
}

function onBoundary(point, rect) {
  return point.x >= rect.x && point.x <= right(rect) && point.y >= rect.y && point.y <= bottom(rect) &&
    (point.x === rect.x || point.x === right(rect) || point.y === rect.y || point.y === bottom(rect));
}

export function acceptsRoute(points, { source, target }, bounds, obstacles) {
  if (!points || points.length < 2 || !onBoundary(points[0], source) || !onBoundary(points.at(-1), target)) {
    return false;
  }
  if (source === target && length(points[0], points.at(-1)) < EPSILON) return false;
  return points.every((point) => inside(point, bounds)) &&
    segments(points).every(([a, b]) => (a.x === b.x || a.y === b.y) &&
      !obstacles.some((rect) => cutsInterior(a, b, rect)));
}
