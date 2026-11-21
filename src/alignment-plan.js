import { adjacentBranches, boundsOf, ceilGrid, center, forwardFlows, intersects, layoutProcess, translate } from './layout.js';
import { acceptsRoute, compareCosts, ROUTE_MARGIN, routeCost, routeFlows } from './route-flows.js';

const POOL_INSET = 20;

const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const right = (rect) => rect.x + rect.width;
const bottom = (rect) => rect.y + rect.height;
const sameBox = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const transpose = ({ x, y, width, height }) => ({ x: y, y: x, width: height, height: width });

function descendantOf(figure, parent) {
  for (let ancestor = figure.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor === parent) return true;
  }
  return false;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}

function containsCenter(rect, box) {
  const x = center(box, 'x');
  const y = center(box, 'y');
  return x > rect.x && x < right(rect) && y > rect.y && y < bottom(rect);
}

function validBox(rect) {
  return [rect.x, rect.y, right(rect), bottom(rect)].every((value) =>
    Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
}

function clone(state) {
  return { boxes: new Map(state.boxes), routes: new Map(state.routes) };
}

function moveTree(state, diagram, figure, delta) {
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
  for (const [edge, points] of state.routes) {
    if (moved.has(edge.source) && moved.has(edge.target)) {
      state.routes.set(edge, points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })));
    }
  }
}

function attachments(diagram, figure) {
  return diagram.attachments.get(figure) ?? [];
}

function grow(state, diagram, figure, next) {
  const old = state.boxes.get(figure);
  state.boxes.set(figure, next);

  for (const attachment of attachments(diagram, figure)) {
    const box = state.boxes.get(attachment);
    const x = center(box, 'x');
    const y = center(box, 'y');
    const distances = [Math.abs(x - old.x), Math.abs(y - old.y), Math.abs(x - right(old)), Math.abs(y - bottom(old))];
    const side = distances.indexOf(Math.min(...distances));
    moveTree(state, diagram, attachment, {
      x: side === 2 ? right(next) - right(old) : 0,
      y: side === 3 ? bottom(next) - bottom(old) : 0
    });
  }
}

function makeRoom(state, diagram, figure, old, gaps) {
  const current = state.boxes.get(figure);
  const lanes = (diagram.scopes.get(figure.scope) ?? []).filter((lane) => lane.kind === 'lane');
  const siblingLane = (other) => memberLane(other, lanes, state.boxes);
  const siblings = (diagram.children.get(figure.parent) ?? []).filter((other) =>
    other !== figure && other.kind !== 'lane' && !other.host &&
    (figure.kind === 'pool' || siblingLane(other) === (figure.lane ?? null)));
  const expanded = { ...old };

  for (const [axis, span] of [['x', 'width'], ['y', 'height']]) {
    if (current[span] === old[span]) continue;
    const before = { ...expanded };
    expanded[span] = current[span];
    const order = siblings.sort((a, b) => state.boxes.get(a)[axis] - state.boxes.get(b)[axis] || byId(a, b));
    const moved = [];
    for (const sibling of order) {
      const box = state.boxes.get(sibling);
      let edge = box[axis];
      if (intersects(expanded, box) &&
          (!intersects(before, box) || box[axis] >= before[axis] + before[span])) {
        edge = expanded[axis] + expanded[span] + gaps[axis];
      }
      for (const [previous, previousOld] of moved) {
        const next = state.boxes.get(previous);
        if (intersects(next, box) && !intersects(previousOld, box)) {
          edge = Math.max(edge, next[axis] + next[span] + gaps[axis]);
        }
      }
      if (edge === box[axis]) continue;
      moved.push([sibling, box]);
      moveTree(state, diagram, sibling, { x: 0, y: 0, [axis]: ceilGrid(edge - box[axis]) });
    }
  }
}

function memberLane(figure, lanes, boxes) {
  if (figure.lane) return figure.lane;
  if (figure.kind === 'node' || figure.host) return null;
  const box = boxes.get(figure);
  return lanes.find((lane) => contains(boxes.get(lane), box)) ?? null;
}

function fitLanes(state, diagram, scope, members, lanes, original, frame, toLocal, toWorld) {
  const bounds = (figure) => toLocal(state.boxes.get(figure));
  const boxes = members.filter((figure) => !figure.host).map((figure) =>
    [figure, memberLane(figure, lanes, original.boxes)]);
  const byLane = Map.groupBy(boxes, ([, lane]) => lane);
  const children = Map.groupBy(lanes, (lane) => lane.parent);
  const unitArea = (figure) => boundsOf([figure, ...attachments(diagram, figure)].map(bounds));
  const inset = scope.kind === 'pool' ? POOL_INSET : 0;
  const scopeLeft = frame ? frame.x + scope.header + inset : -Infinity;
  const scopeRight = frame ? right(frame) - Math.max(ROUTE_MARGIN, inset) : Infinity;
  const scopeTop = frame ? frame.y + inset : -Infinity;
  const scopeBottom = frame ? bottom(frame) - Math.max(ROUTE_MARGIN, inset) : Infinity;
  const leftEdge = (lane) => lane ? Math.max(scopeLeft, bounds(lane).x + lane.header) : scopeLeft;
  const rightEdge = (lane) => lane ? Math.min(scopeRight, right(bounds(lane)) - ROUTE_MARGIN) : scopeRight;
  let xGrowth = 0;

  // Fit lanes to a common longitudinal envelope so cross-lane columns stay aligned.
  const nodes = boxes.filter(([figure]) => figure.kind === 'node');
  const minOffset = nodes.reduce((offset, [figure, lane]) =>
    Math.max(offset, ceilGrid(leftEdge(lane) - unitArea(figure).x)), -Infinity);
  const maxOffset = nodes.reduce((offset, [figure, lane]) =>
    Math.min(offset, -ceilGrid(right(unitArea(figure)) - rightEdge(lane))), Infinity);
  const dx = Math.max(minOffset, Math.min(0, maxOffset));

  for (const [figure, lane] of nodes) {
    if (dx) moveTree(state, diagram, figure, toWorld({ x: dx, y: 0 }));
    xGrowth = Math.max(xGrowth, ceilGrid(right(unitArea(figure)) - rightEdge(lane)));
  }

  function fitRows(parent, shift) {
    let growth = 0;
    const ordered = (children.get(parent) ?? []).sort((a, b) => bounds(a).y - bounds(b).y || byId(a, b));
    for (const lane of ordered) {
      const rect = bounds(lane);
      const offset = shift + growth;
      const occupants = byLane.get(lane) ?? [];
      const content = occupants.filter(([figure]) => figure.kind === 'node').map(([figure]) => unitArea(figure));
      let dy = 0;
      let extra = fitRows(lane, offset);
      if (content.length) {
        const area = boundsOf(content);
        const top = Math.max(rect.y, scopeTop - offset);
        const end = Math.min(bottom(rect) - ROUTE_MARGIN, scopeBottom);
        dy = Math.max(ceilGrid(top - area.y), Math.min(0, -ceilGrid(bottom(area) - end)));
        extra = Math.max(extra, ceilGrid(bottom(area) + dy - end));
      }

      for (const [figure] of occupants) {
        const amount = offset + (figure.kind === 'node' ? dy : 0);
        if (amount) moveTree(state, diagram, figure, toWorld({ x: 0, y: amount }));
      }
      state.boxes.set(lane, toLocal({ ...rect, y: rect.y + offset, height: rect.height + extra, width: rect.width + xGrowth }));
      growth += extra;
    }
    return growth;
  }

  let yGrowth = fitRows(scope, 0);
  const free = (byLane.get(null) ?? []).filter(([figure]) => figure.kind === 'node');
  if (frame && free.length) {
    const area = boundsOf(free.map(([figure]) => unitArea(figure)));
    const dy = Math.max(ceilGrid(scopeTop - area.y), Math.min(0, -ceilGrid(bottom(area) - scopeBottom)));
    for (const [figure] of free) {
      if (dy) moveTree(state, diagram, figure, toWorld({ x: 0, y: dy }));
    }
    yGrowth = Math.max(yGrowth, ceilGrid(bottom(area) + dy - scopeBottom));
  }
  return { xGrowth, yGrowth };
}

function scopeCollisions(state, original, members, lanes, scope) {
  for (const figure of members) {
    const box = state.boxes.get(figure);
    if (!validBox(box)) return true;
    const lane = figure.lane ?? figure.host?.lane;
    if (lane && !contains(state.boxes.get(lane), box)) return true;
    if (figure.kind === 'node' || figure.host) {
      for (const other of lanes) {
        if (other === lane || lane && descendantOf(lane, other)) continue;
        const originalBox = original.boxes.get(figure);
        const currentLane = state.boxes.get(other);
        const originalLane = original.boxes.get(other);
        if (containsCenter(currentLane, box) !== containsCenter(originalLane, originalBox) ||
            intersects(box, currentLane) && !intersects(originalBox, originalLane)) return true;
      }
      if (state.boxes.has(scope) && !contains(state.boxes.get(scope), box)) return true;
    }
  }

  for (let index = 0; index < members.length; index++) {
    const a = members[index];
    for (const b of members.slice(index + 1)) {
      if (a.host === b || b.host === a || a.host && a.host === b.host) continue;
      if (intersects(state.boxes.get(a), state.boxes.get(b)) &&
          (a.kind === 'node' || b.kind === 'node' || a.host || b.host)) return true;
    }
  }

  return false;
}

function respectsGaps(units, state, gaps, toLocal) {
  const boxes = units.map(({ figure, lane }) => ({ lane, box: toLocal(state.boxes.get(figure)) }));
  return boxes.every(({ lane, box }, index) => boxes.slice(index + 1).every(({ lane: otherLane, box: other }) => {
    if (lane !== otherLane) return true;
    const dx = Math.max(box.x - right(other), other.x - right(box));
    const dy = Math.max(box.y - bottom(other), other.y - bottom(box));
    return dx >= gaps.x || dy >= gaps.y;
  }));
}

function planScope(diagram, state, scope, gaps) {
  const figures = diagram.scopes.get(scope) ?? [];
  const members = figures.filter((figure) => figure.kind !== 'lane');
  const boxes = members.filter((figure) => figure.kind === 'node');
  if (!boxes.length) return { state };
  const lanes = figures.filter((figure) => figure.kind === 'lane')
    .sort((a, b) => descendantOf(a, b) ? -1 : descendantOf(b, a) ? 1 : byId(a, b));
  const flip = scope.horizontal === false;
  const toLocal = flip ? transpose : (rect) => rect;
  const toWorld = flip ? ({ x, y }) => ({ x: y, y: x }) : (delta) => delta;
  const frame = state.boxes.has(scope) ? toLocal(state.boxes.get(scope)) : null;
  // The grid moves with a subprocess or pool, even if its top-left is fractional.
  const relative = (figure) => {
    const box = toLocal(state.boxes.get(figure));
    return frame ? translate(box, { x: -frame.x, y: -frame.y }) : box;
  };
  const area = (figure) => boundsOf([figure, ...attachments(diagram, figure)].map(relative));
  const units = boxes.map((figure) => ({
    figure, lane: figure.lane, shape: { ...relative(figure), id: figure.id, type: figure.type },
    area: area(figure)
  }));
  const unitByFigure = new Map(units.map((unit) => [unit.figure, unit]));
  const graph = diagram.edges.filter(({ source, target }) =>
    unitByFigure.has(source.host ?? source) && unitByFigure.has(target.host ?? target))
    .map((edge) => ({
      id: edge.id, edge, source: unitByFigure.get(edge.source.host ?? edge.source),
      target: unitByFigure.get(edge.target.host ?? edge.target), isDefault: edge.isDefault
    }));
  const forward = new Set(forwardFlows(units, graph));
  const spacing = flip ? { x: gaps.y, y: gaps.x } : gaps;

  function prepare(deltas) {
    if (!deltas) return null;
    const plan = clone(state);
    for (const [unit, delta] of deltas) moveTree(plan, diagram, unit.figure, toWorld(delta));
    const { xGrowth, yGrowth } = fitLanes(plan, diagram, scope, members, lanes, state, frame, toLocal, toWorld);
    if (scope.kind !== 'root' && (xGrowth || yGrowth)) {
      const bounds = toLocal({ ...frame, width: frame.width + xGrowth, height: frame.height + yGrowth });
      if (!validBox(bounds)) return null;
      grow(plan, diagram, scope, bounds);
    }
    if (scopeCollisions(plan, state, members, lanes, scope)) return null;
    if ([...plan.boxes.values()].some((box) => !validBox(box))) return null;
    return { plan, deltas, growth: xGrowth + yGrowth };
  }

  function evaluate(candidate) {
    if (!candidate) return null;
    const { plan } = candidate;
    const obstacles = members.map((figure) => plan.boxes.get(figure));
    for (const lane of lanes) {
      const box = toLocal(plan.boxes.get(lane));
      if (lane.header) obstacles.push(toLocal({ ...box, width: Math.min(lane.header, box.width) }));
    }
    const f = plan.boxes.get(scope);
    const drawing = f ?? boundsOf(lanes.length ? [...obstacles, ...lanes.map((lane) => plan.boxes.get(lane))] : obstacles);
    const pad = f ? 0 : ROUTE_MARGIN * 2;
    const bounds = {
      left: drawing.x - pad + (f && !flip ? scope.header : 0),
      top: drawing.y - pad + (f && flip ? scope.header : 0),
      right: right(drawing) + pad,
      bottom: bottom(drawing) + pad
    };
    const flows = graph.map((flow) => ({
      ...flow,
      source: plan.boxes.get(flow.edge.source),
      target: plan.boxes.get(flow.edge.target),
      back: !forward.has(flow),
      vertical: flip
    }));
    const existing = flows.every((flow) => acceptsRoute(flow.edge.points, flow, bounds, obstacles))
      ? new Map(flows.map(({ id, edge }) => [id, edge.points.map(({ x, y }) => ({ x, y }))]))
      : null;
    let routes = routeFlows(flows, bounds, obstacles);
    if (existing && (!routes || compareCosts(routeCost(existing.values()), routeCost(routes.values())) <= 0)) {
      routes = existing;
    }
    if (!routes) return null;

    for (const { id, edge } of graph) plan.routes.set(edge, routes.get(id));
    const movement = units.reduce((sum, { figure }) => {
      const after = plan.boxes.get(figure);
      const before = state.boxes.get(figure);
      return sum + Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    }, 0);
    return { ...candidate, cost: [...routeCost(routes.values()), movement] };
  }

  const regular = layoutProcess(units, graph, spacing);
  const base = prepare(regular);
  let best = base && !base.growth ? evaluate(base) : null;
  if (!best) {
    const compact = layoutProcess(units, graph, spacing, { compact: true });
    const compressed = prepare(compact);
    const preferCompact = compressed && (!base || compressed.growth < base.growth);
    best = !base || base.growth
      ? evaluate(preferCompact ? compressed : base) ?? evaluate(preferCompact ? base : compressed)
      : evaluate(compressed);
    if (!best) return { reason: base || compressed ? 'routing' : regular || compact ? 'collisions' : 'bounds' };
  }
  const compact = best.deltas !== regular;

  const incoming = Map.groupBy([...forward], (flow) => flow.target);
  const outgoing = Map.groupBy([...forward], (flow) => flow.source);
  const aligned = units.every(({ shape }) => ['x', 'y'].every((axis) =>
    Math.abs(center(shape, axis) - ceilGrid(center(shape, axis))) < 1e-7)) &&
    [...forward].every(({ source, target }) => {
      const dx = center(target.shape, 'x') - center(source.shape, 'x');
      const dy = center(target.shape, 'y') - center(source.shape, 'y');
      const inline = source.lane === target.lane &&
        outgoing.get(source).length === 1 && incoming.get(target).length === 1;
      return dx >= 0 && (!inline || !dx || !dy);
    });
  if (aligned) {
    const current = prepare(new Map());
    if (current && !current.growth && units.every(({ figure }) =>
      sameBox(current.plan.boxes.get(figure), state.boxes.get(figure))) &&
      respectsGaps(units, current.plan, spacing, toLocal)) {
      const tested = evaluate(current);
      if (tested && compareCosts(tested.cost, best.cost) <= 0) best = tested;
    }
  }

  // Try each neighboring swap from the current best result. A new order can
  // expose another useful swap, so share one budget across all passes.
  let remaining = 9;
  while (remaining) {
    const previous = best;
    const centers = new Map(units.map((unit) => [unit, toLocal(previous.plan.boxes.get(unit.figure))]));
    const swaps = adjacentBranches(units, graph, centers).slice(0, remaining);
    for (const swap of swaps) {
      remaining--;
      const deltas = new Map(previous.deltas);
      for (const [unit, dy] of swap) {
        const delta = deltas.get(unit) ?? { x: 0, y: 0 };
        deltas.set(unit, { x: delta.x, y: delta.y + dy });
      }
      const candidate = prepare(deltas);
      if (!candidate || candidate.growth > best.growth ||
          !respectsGaps(units, candidate.plan, spacing, toLocal)) continue;
      const tested = evaluate(candidate);
      if (tested && compareCosts(tested.cost, best.cost) < 0) best = tested;
    }
    if (best === previous) break;
  }

  const height = ({ plan }) => boundsOf(members.filter((figure) => figure.kind === 'node' || figure.host)
    .map((figure) => toLocal(plan.boxes.get(figure)))).height;
  const packed = [...outgoing.values()].some((flows) => flows.length > 1)
    ? prepare(layoutProcess(units, graph, spacing, { compact, reuseBranchRows: true }))
    : null;
  if (packed && packed.growth <= best.growth && height(packed) < height(best) &&
      respectsGaps(units, packed.plan, spacing, toLocal)) {
    const tested = evaluate(packed);
    // A shorter drawing is worthwhile when crossings, shared lines and bends
    // are at least as good by the usual routing priorities.
    if (tested && compareCosts(tested.cost.slice(0, 3), best.cost.slice(0, 3)) <= 0) best = tested;
  }

  const oldScope = state.boxes.get(scope);
  if (oldScope && !sameBox(oldScope, best.plan.boxes.get(scope))) {
    makeRoom(best.plan, diagram, scope, oldScope, gaps);
  }
  return { state: best.plan };
}

function newOverlap(state, original, figure, others) {
  const next = state.boxes.get(figure);
  return others.some((other) => other !== figure && other.parent === figure.parent &&
    !other.host && other.kind !== 'lane' &&
    (figure.kind === 'pool' || figure.lane === other.lane) &&
    intersects(next, state.boxes.get(other)) &&
    !intersects(original.boxes.get(figure), original.boxes.get(other)));
}

export function planAlignment({ root, figures, edges }, gaps) {
  const diagram = {
    edges,
    children: Map.groupBy(figures, (figure) => figure.parent),
    scopes: Map.groupBy(figures, (figure) => figure.scope),
    attachments: Map.groupBy(figures.filter((figure) => figure.host), (figure) => figure.host)
  };
  const initial = { boxes: new Map(figures.map((figure) => [figure, figure.box])), routes: new Map() };
  const skipped = new Map();
  let state = initial;
  const pools = figures.filter((figure) => figure.kind === 'pool').sort(byId);

  function alignScope(scope, start, failures) {
    let current = start;
    for (const child of (diagram.scopes.get(scope) ?? []).filter((figure) => figure.expanded).sort(byId)) {
      current = alignScope(child, current, failures);
    }
    const result = planScope(diagram, current, scope, gaps);
    if (result.reason) {
      failures.set(scope, result.reason);
      return start;
    }
    if (scope.kind !== 'root' && newOverlap(result.state, start, scope, diagram.children.get(scope.parent) ?? [])) {
      failures.set(scope, 'collisions');
      return start;
    }
    return result.state;
  }

  for (const scope of [root, ...pools]) {
    const failures = new Map();
    const planned = alignScope(scope, state, failures);
    if ([...planned.boxes.values()].every(validBox)) state = planned;
    else failures.set(scope, 'bounds');
    for (const [region, reason] of failures) skipped.set(region, reason);
  }

  const boxes = new Map([...state.boxes].filter(([figure, bounds]) => !sameBox(figure.box, bounds)));
  return { boxes, routes: state.routes, skipped: [...skipped].map(([scope, reason]) => ({ scope, reason })) };
}
