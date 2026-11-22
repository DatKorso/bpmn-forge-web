import { adjacentBranches, boundsOf, ceilGrid, center, compactLoops, forwardFlows, layoutProcess, snap, translate } from './layout.js';
import { acceptsRoute, compareCosts, ROUTE_MARGIN, routeCost, routeFlows, simplifyRoute } from './route-flows.js';
import { byId, right, bottom, sameBox, transpose, localSpacing, descendantOf, validBox, clone, moveTree, attachments, offsets } from './alignment-state.js';
import { usableArea, resize, makeRoom, fitLanes, fitSelectedFrame, scopeCollisions } from './container-fit.js';

export function hasClearance(a, b, gaps) {
  const dx = Math.max(a.x - right(b), b.x - right(a));
  const dy = Math.max(a.y - bottom(b), b.y - bottom(a));
  return dx >= gaps.x || dy >= gaps.y;
}

export function respectsGaps(units, state, gaps, toLocal, includeAttachments = false) {
  const boxes = units.map(({ figure, parts, lane }) => ({
    lane, box: toLocal(includeAttachments
      ? boundsOf(parts.map((part) => state.boxes.get(part)))
      : state.boxes.get(figure))
  }));
  return boxes.every(({ lane, box }, index) => boxes.slice(index + 1).every(({ lane: otherLane, box: other }) =>
    lane !== otherLane || hasClearance(box, other, gaps)));
}

export function routingBounds(scope, plan, lanes, toLocal, obstacles) {
  for (const lane of lanes) {
    const box = toLocal(plan.boxes.get(lane));
    if (lane.header) obstacles.push(toLocal({ ...box, width: Math.min(lane.header, box.width) }));
  }
  const frame = plan.boxes.get(scope);
  const pad = frame ? 0 : ROUTE_MARGIN * 2;
  const content = frame ? toLocal(usableArea(scope, toLocal(frame), false))
    : boundsOf([...obstacles, ...lanes.map((lane) => plan.boxes.get(lane))]);
  return { left: content.x - pad, top: content.y - pad,
    right: right(content) + pad, bottom: bottom(content) + pad };
}

export function spacingLayouts(units, graph, spacing, options) {
  const { x, y, maxX, maxY } = spacing;
  const limits = [];
  const seen = new Set();
  const track = (axis, maximum) => maximum === undefined ? undefined : (before, after) => {
    const ids = (group) => group.map(({ figure }) => figure.id).sort();
    const key = JSON.stringify([axis, ids(before), ids(after)]);
    if (seen.has(key)) return;
    seen.add(key);
    limits.push({ axis, maximum, before, after });
  };
  const neighbors = { x: track('x', maxX), y: track('y', maxY) };
  const layouts = [layoutProcess(units, graph, spacing, { ...options, neighbors })];
  if (maxX !== undefined && maxY !== undefined) {
    layouts.push(layoutProcess(units, graph, { x, y, maxX }, options),
      layoutProcess(units, graph, { x, y, maxY }, options));
  }

  function excess(state, toLocal) {
    const areas = new Map(units.map((unit) => [
      unit, toLocal(boundsOf(unit.parts.map((figure) => state.boxes.get(figure))))
    ]));
    return limits.reduce((total, { axis, maximum, before, after }) => {
      const end = axis === 'x' ? right : bottom;
      const start = Math.min(...after.map((unit) => areas.get(unit)[axis]));
      const gap = start - Math.max(...before.map((unit) => end(areas.get(unit))));
      return total + Math.max(0, gap - maximum);
    }, 0);
  }

  return { layouts, excess };
}

function spacingCost({ cost, excess }) {
  return [...cost.slice(0, 3), excess, ...cost.slice(3)];
}

export function preferSpacing(candidate, base, best) {
  return candidate.excess < base.excess &&
    compareCosts(candidate.cost.slice(0, 3), base.cost.slice(0, 3)) <= 0 &&
    compareCosts(spacingCost(candidate), spacingCost(best)) < 0;
}

function improveSingleNodeBranches(best, context) {
  const { units, diagram, scope, frame, toLocal, toWorld, minimums: spacing, obstaclesInScope, lanes } = context;
  const incoming = diagram.incoming;
  const outgoing = diagram.outgoing;
  const byFigure = new Map(units.map((unit) => [unit.figure, unit]));
  const local = (plan, figure) => toLocal(plan.boxes.get(figure));
  const bends = (plan, edge) => Math.max(0, simplifyRoute(plan.routes.get(edge) ?? edge.points ?? []).length - 2);
  const gap = (plan, entry, exit) => {
    const [upper, lower] = [local(plan, entry.source), local(plan, exit.target)].sort((a, b) => a.y - b.y);
    return [bottom(upper), lower.y];
  };
  const candidates = [];
  for (const { figure, lane, parts } of units) {
    const inputs = incoming.get(figure) ?? [];
    const outputs = outgoing.get(figure) ?? [];
    if (inputs.length !== 1 || outputs.length !== 1) continue;
    const [entry] = inputs;
    const [exit] = outputs;
    const previous = byFigure.get(entry.source);
    const next = byFigure.get(exit.target);
    if (!previous || !next || previous === next || previous.figure === figure || next.figure === figure ||
        previous.lane !== lane || next.lane !== lane || outgoing.get(previous.figure).length < 2 ||
        incoming.get(next.figure).length < 2) continue;
    const turns = [bends(best.plan, entry), bends(best.plan, exit)];
    const [start, end] = gap(best.plan, entry, exit);
    const box = local(best.plan, figure);
    if (Math.max(...turns) > 1 && start < end && (box.y < start || bottom(box) > end)) {
      candidates.push({ figure, lane, parts, entry, exit, turns: turns[0] + turns[1] });
    }
  }

  for (const { figure, lane, parts, entry, exit } of candidates.sort((a, b) =>
    b.turns - a.turns || byId(a.figure, b.figure)).slice(0, 9)) {
    const { plan } = best;
    const [start, end] = gap(plan, entry, exit);
    const box = local(plan, figure);
    if (start >= end || box.y >= start && bottom(box) <= end ||
        Math.max(bends(plan, entry), bends(plan, exit)) <= 1) continue;
    const origin = frame?.y ?? 0;
    const dy = origin + snap((start + end) / 2 - origin) - center(box, 'y');
    const area = boundsOf(parts.map((part) => translate(local(plan, part), { x: 0, y: dy })));
    const limits = [scope, lane].filter((container) => plan.boxes.has(container))
      .map((container) => usableArea(container, local(plan, container)));
    if (limits.some((limit) => area.x < limit.x || right(area) > right(limit))) continue;
    limits.push({ y: start, height: end - start });
    const neighbors = units.filter((unit) => unit.figure !== figure && unit.lane === lane)
      .map((unit) => boundsOf(unit.parts.map((part) => local(plan, part))));
    // If the midpoint is too close to a neighboring row, try the nearest grid
    // position beyond its clearance while keeping the branch's column.
    const blockers = neighbors.filter((neighbor) => Math.max(area.x - right(neighbor), neighbor.x - right(area)) < spacing.x)
      .map(({ y, height }) => ({ y: y - spacing.y, height: height + 2 * spacing.y }));
    const offset = offsets([{ box: area, limits }], 'y', blockers).find((shift) =>
      neighbors.every((neighbor) => hasClearance(translate(area, { x: 0, y: shift }), neighbor, spacing)));
    if (offset === undefined) continue;

    const moved = clone(plan);
    moveTree(moved, diagram, figure, toWorld({ x: 0, y: dy + offset }));
    if (scopeCollisions(moved, plan, [...new Set([...obstaclesInScope, ...parts])], lanes, scope)) continue;
    const tested = evaluateCandidate({ ...best, plan: moved }, context);
    if (!tested || tested.cost.slice(0, 3).some((value, index) => value > best.cost[index]) ||
        bends(tested.plan, entry) + bends(tested.plan, exit) >= bends(plan, entry) + bends(plan, exit) ||
        incoming.get(exit.target).some((edge) => bends(plan, edge) === 0 && bends(tested.plan, edge) > 0)) continue;
    best = tested;
  }
  return best;
}

export function planScope(diagram, state, scope, gaps, fitSelection) {
  const figures = diagram.scopes.get(scope) ?? [];
  const members = figures.filter((figure) => figure.kind !== 'lane' && figure.kind !== 'group');
  const boxes = members.filter((figure) => figure.kind === 'node');
  const obstaclesInScope = members.filter((figure) => !diagram.followers.has(figure));
  if (!boxes.length) return { state };
  const lanes = figures.filter((figure) => figure.kind === 'lane')
    .sort((a, b) => descendantOf(a, b) ? -1 : descendantOf(b, a) ? 1 : byId(a, b));
  const flip = scope.horizontal === false;
  const toLocal = flip ? transpose : (rect) => rect;
  const toWorld = flip ? ({ x, y }) => ({ x: y, y: x }) : (delta) => delta;
  const frame = state.boxes.has(scope) ? toLocal(state.boxes.get(scope)) : null;
  const units = buildUnits(boxes, diagram, state, toLocal, frame);
  const graph = buildGraph(units, diagram.edges);
  const forward = new Set(forwardFlows(units, graph));
  const spacing = localSpacing(gaps, flip);
  const minimums = { x: spacing.x, y: spacing.y };
  const context = { diagram, state, scope, gaps, fitSelection, members, lanes, flip, toLocal, toWorld, frame,
    obstaclesInScope, units, graph, forward, spacing, minimums };

  if (fitSelection) return planFittedScope(context);
  const initial = initialCandidate(context);
  if (initial.reason) return initial;
  const { compact } = initial;
  const incoming = Map.groupBy([...forward], (flow) => flow.target);
  const outgoing = Map.groupBy([...forward], (flow) => flow.source);
  let best = retainCurrentLayout(initial.best, context, incoming, outgoing);
  best = refineBySwaps(best, context);
  best = packRows(best, context, compact, outgoing);
  const spaced = applyMaxSpacing(best, context, compact);
  return finalizeScope(spaced.best, context, spaced.measureExcess);
}

function buildUnits(boxes, diagram, state, toLocal, frame) {
  // The grid moves with a subprocess or pool, even if its top-left is fractional.
  const relative = (figure) => {
    const box = toLocal(state.boxes.get(figure));
    return frame ? translate(box, { x: -frame.x, y: -frame.y }) : box;
  };
  const area = (figure) => boundsOf([figure, ...attachments(diagram, figure)].map(relative));
  return boxes.map((figure) => ({
    figure, lane: figure.lane, parts: [figure, ...attachments(diagram, figure)],
    shape: { ...relative(figure), id: figure.id, type: figure.type },
    area: area(figure)
  }));
}

function buildGraph(units, edges) {
  const unitByFigure = new Map(units.map((unit) => [unit.figure, unit]));
  return edges.filter(({ source, target }) =>
    unitByFigure.has(source.host ?? source) && unitByFigure.has(target.host ?? target))
    .map((edge) => ({
      id: edge.id, edge, source: unitByFigure.get(edge.source.host ?? edge.source),
      target: unitByFigure.get(edge.target.host ?? edge.target), isDefault: edge.isDefault
    }));
}

function prepareCandidate(deltas, context) {
  const { state, diagram, toWorld, fitSelection, scope, members, lanes,
    frame, toLocal, flip, obstaclesInScope } = context;
  if (!deltas) return null;
  const plan = clone(state);
  for (const [unit, delta] of deltas) moveTree(plan, diagram, unit.figure, toWorld(delta));
  const { xGrowth, yGrowth } = fitSelection
    ? fitSelectedFrame(plan, diagram, scope, members, lanes, state, frame, toLocal, toWorld, flip)
    : fitLanes(plan, diagram, scope, members, lanes, state, frame, toLocal, toWorld);
  if (scope.kind !== 'root' && (xGrowth || yGrowth)) {
    const bounds = toLocal({ ...frame, width: frame.width + xGrowth, height: frame.height + yGrowth });
    if (!validBox(bounds)) return null;
    resize(plan, diagram, scope, bounds);
  }
  if (scopeCollisions(plan, state, obstaclesInScope, lanes, scope, fitSelection)) return null;
  if ([...plan.boxes.values()].some((box) => !validBox(box))) return null;
  return { plan, deltas, growth: xGrowth + yGrowth };
}

function evaluateCandidate(candidate, context) {
  const { scope, lanes, toLocal, graph, forward, flip, units, state, obstaclesInScope } = context;
  if (!candidate) return null;
  const { plan } = candidate;
  const obstacles = obstaclesInScope.map((figure) => plan.boxes.get(figure));
  const bounds = routingBounds(scope, plan, lanes, toLocal, obstacles);
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

function planFittedScope(context) {
  const { units, graph, spacing, minimums, toLocal, fitSelection, scope, state } = context;
  const candidates = [layoutProcess(units, graph, spacing),
    layoutProcess(units, graph, minimums, { compact: true, reuseBranchRows: true })];
  let best;
  let reason = 'collisions';
  for (const deltas of candidates) {
    const candidate = prepareCandidate(deltas, context);
    if (!candidate || !respectsGaps(units, candidate.plan, minimums, toLocal)) continue;
    const evaluated = evaluateCandidate(candidate, context);
    if (!evaluated) {
      reason = 'routing';
      continue;
    }
    const result = fitSelection(evaluated.plan);
    if (!result.state) {
      reason = result.reason;
      continue;
    }
    const box = result.state.boxes.get(scope);
    const movement = [...result.state.boxes].reduce((total, [figure, after]) => {
      const before = state.boxes.get(figure);
      return total + Math.abs(after.x - before.x) + Math.abs(after.y - before.y);
    }, 0);
    const cost = [...(result.cost ?? evaluated.cost).slice(0, 3), box.width * box.height, movement];
    if (!best || compareCosts(cost, best.cost) < 0) best = { state: result.state, cost };
  }
  return best ?? { reason };
}

function initialCandidate(context) {
  const { units, graph, minimums } = context;
  const regular = layoutProcess(units, graph, minimums);
  const base = prepareCandidate(regular, context);
  let best = base && !base.growth ? evaluateCandidate(base, context) : null;
  if (!best) {
    const compact = layoutProcess(units, graph, minimums, { compact: true });
    const compressed = prepareCandidate(compact, context);
    const preferCompact = compressed && (!base || compressed.growth < base.growth);
    best = !base || base.growth
      ? evaluateCandidate(preferCompact ? compressed : base, context) ?? evaluateCandidate(preferCompact ? base : compressed, context)
      : evaluateCandidate(compressed, context);
    if (!best) return { reason: base || compressed ? 'routing' : regular || compact ? 'collisions' : 'bounds' };
  }
  return { best, compact: best.deltas !== regular };
}

function retainCurrentLayout(best, context, incoming, outgoing) {
  const { units, forward, state, spacing, toLocal } = context;
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
    const current = prepareCandidate(new Map(), context);
    if (current && !current.growth && units.every(({ figure }) =>
      sameBox(current.plan.boxes.get(figure), state.boxes.get(figure))) &&
      respectsGaps(units, current.plan, spacing, toLocal)) {
      const tested = evaluateCandidate(current, context);
      if (tested && compareCosts(tested.cost, best.cost) <= 0) best = tested;
    }
  }
  return best;
}

function refineBySwaps(best, context) {
  const { units, graph, spacing, toLocal } = context;

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
      const candidate = prepareCandidate(deltas, context);
      if (!candidate || candidate.growth > best.growth ||
          !respectsGaps(units, candidate.plan, spacing, toLocal)) continue;
      const tested = evaluateCandidate(candidate, context);
      if (tested && compareCosts(tested.cost, best.cost) < 0) best = tested;
    }
    if (best === previous) break;
  }
  return best;
}

function packRows(best, context, compact, outgoing) {
  const { members, toLocal, units, graph, minimums, spacing } = context;
  const height = ({ plan }) => boundsOf(members.filter((figure) => figure.kind === 'node' || figure.host)
    .map((figure) => toLocal(plan.boxes.get(figure)))).height;
  const packed = [...outgoing.values()].some((flows) => flows.length > 1)
    ? prepareCandidate(layoutProcess(units, graph, minimums, { compact, reuseBranchRows: true }), context)
    : null;
  if (packed && packed.growth <= best.growth && height(packed) < height(best) &&
      respectsGaps(units, packed.plan, spacing, toLocal)) {
    const tested = evaluateCandidate(packed, context);
    // A shorter drawing is worthwhile when crossings, shared lines and bends
    // are at least as good by the usual routing priorities.
    if (tested && compareCosts(tested.cost.slice(0, 3), best.cost.slice(0, 3)) <= 0) best = tested;
  }
  return best;
}

function applyMaxSpacing(best, context, compact) {
  const { units, graph, spacing, scope, frame, lanes, toLocal } = context;
  if (spacing.maxX === undefined && spacing.maxY === undefined) return { best };
  const { layouts, excess } = spacingLayouts(units, graph, spacing, { compact });
  const baseline = { ...best, excess: excess(best.plan, toLocal) };
  best = baseline;
  const containers = frame ? [scope, ...lanes] : lanes;
  for (const deltas of layouts) {
    const candidate = prepareCandidate(deltas, context);
    if (!candidate || !respectsGaps(units, candidate.plan, spacing, toLocal, true) ||
        containers.some((container) => {
          const before = baseline.plan.boxes.get(container);
          const after = candidate.plan.boxes.get(container);
          return after.width > before.width || after.height > before.height;
        })) continue;
    candidate.excess = excess(candidate.plan, toLocal);
    if (candidate.excess >= baseline.excess) continue;
    const tested = evaluateCandidate(candidate, context);
    if (tested && preferSpacing(tested, baseline, best)) best = tested;
  }

  return { best, measureExcess: excess };
}

function finalizeScope(best, context, measureExcess) {
  const { units, diagram, scope, lanes, state, gaps, flip, members } = context;
  best = improveSingleNodeBranches(best, context);

  const oldScope = state.boxes.get(scope);
  if (oldScope && scope.kind !== 'pool' && !sameBox(oldScope, best.plan.boxes.get(scope))) {
    makeRoom(best.plan, diagram, scope, oldScope, gaps);
  }
  const loops = compactLoops(units, diagram.incoming, diagram.outgoing, lanes.length > 0);
  return { state: best.plan, loops: loops.map((loop) =>
    ({ ...loop, scope, members, units, lanes, measureExcess, vertical: flip })) };
}
