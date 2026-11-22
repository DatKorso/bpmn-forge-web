import { adjacentBranches, boundsOf, ceilGrid, center, forwardFlows, intersects, layoutProcess, snap, translate, translateWaypoints } from './layout.js';
import { acceptsRoute, compareCosts, cutsInterior, ROUTE_MARGIN, routeCost, routeFlows, simplifyRoute, translatedRouteIsClear } from './route-flows.js';
import { collaboration, placePools, routeMessages } from './pool-layout.js';
import { annotationLayout, isAnnotation, isFrame, obstructedFlows, placeAnnotations, routeAssociations } from './annotation-layout.js';

const CONTAINER_INSET = 40;

const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const right = (rect) => rect.x + rect.width;
const bottom = (rect) => rect.y + rect.height;
const sameBox = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const transpose = ({ x, y, width, height }) => ({ x: y, y: x, width: height, height: width });
const localSpacing = (gaps, flip) => flip
  ? { x: gaps.y, y: gaps.x, maxX: gaps.maxY, maxY: gaps.maxX }
  : gaps;

function descendantOf(figure, parent) {
  for (let ancestor = figure.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor === parent) return true;
  }
  return false;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}

// Coordinates are in the direction of the process, with the header on the left.
function usableArea(container, frame, forNodes = true) {
  const inset = forNodes && container.kind !== 'lane' ? CONTAINER_INSET : 0;
  const trailing = forNodes ? Math.max(inset, ROUTE_MARGIN) : 0;
  const header = container.header ?? 0;
  return { x: frame.x + header + inset, y: frame.y + inset,
    width: frame.width - header - inset - trailing, height: frame.height - inset - trailing };
}

function geometryWithLabels(figure, box) {
  const delta = { x: box.x - figure.box.x, y: box.y - figure.box.y };
  return [box, ...(figure.labels ?? []).map((label) => translate(label, delta))];
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
  for (const edge of diagram.internalEdges) {
    const points = state.routes.get(edge) ?? edge.points;
    if (points && moved.has(edge.source) && moved.has(edge.target)) {
      state.routes.set(edge, translateWaypoints(points, delta));
    }
  }
}

function attachments(diagram, figure) {
  return diagram.attachments.get(figure) ?? [];
}

function resize(state, diagram, figure, next) {
  const old = state.boxes.get(figure);
  state.boxes.set(figure, next);

  for (const attachment of attachments(diagram, figure)) {
    const box = state.boxes.get(attachment);
    const x = center(box, 'x');
    const y = center(box, 'y');
    const distances = [Math.abs(x - old.x), Math.abs(y - old.y), Math.abs(x - right(old)), Math.abs(y - bottom(old))];
    const side = distances.indexOf(Math.min(...distances));
    const cross = ROUTE_MARGIN;
    const clamp = (value, start, end) => Math.max(start + cross, Math.min(value, end - cross)) - value;
    moveTree(state, diagram, attachment, {
      x: side === 2 ? right(next) - right(old) : side === 1 || side === 3 ? clamp(x, next.x, right(next)) : 0,
      y: side === 3 ? bottom(next) - bottom(old) : side === 0 || side === 2 ? clamp(y, next.y, bottom(next)) : 0
    });
  }
}

function makeRoom(state, diagram, figure, old, gaps) {
  const current = state.boxes.get(figure);
  const lanes = (diagram.scopes.get(figure.scope) ?? []).filter((lane) => lane.kind === 'lane');
  const siblingLane = (other) => memberLane(other, lanes, state.boxes);
  const siblings = (diagram.children.get(figure.parent) ?? []).filter((other) =>
    other !== figure && !['lane', 'group', 'pool'].includes(other.kind) && !other.host && !isAnnotation(other) &&
    siblingLane(other) === (figure.lane ?? null));
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
  const scopeArea = frame && usableArea(scope, frame);
  const scopeLeft = scopeArea?.x ?? -Infinity;
  const scopeRight = scopeArea ? right(scopeArea) : Infinity;
  const scopeTop = scopeArea?.y ?? -Infinity;
  const scopeBottom = scopeArea ? bottom(scopeArea) : Infinity;
  const leftEdge = (lane) => lane ? Math.max(scopeLeft, usableArea(lane, bounds(lane)).x) : scopeLeft;
  const rightEdge = (lane) => lane ? Math.min(scopeRight, right(usableArea(lane, bounds(lane)))) : scopeRight;
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
        const end = bottom(usableArea(lane, rect));
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
  if (frame && lanes.length) {
    yGrowth = Math.max(yGrowth, ...nodes.map(([figure]) => ceilGrid(bottom(unitArea(figure)) - scopeBottom)));
    for (const lane of lanes) {
      const box = bounds(lane);
      if (bottom(toLocal(original.boxes.get(lane))) === bottom(frame)) {
        state.boxes.set(lane, toLocal({ ...box, height: bottom(frame) + yGrowth - box.y }));
      }
    }
  }
  return { xGrowth, yGrowth };
}

function fitSelectedFrame(state, diagram, scope, members, lanes, original, frame, local, world, flip) {
  const scopeArea = usableArea(scope, frame);
  const content = usableArea(scope, frame, false);
  // Minimum dimensions from bpmn-js ResizeBehavior, in process coordinates.
  const [minWidth, minHeight] = scope.kind === 'pool' ? [300, 150] : flip ? [120, 140] : [140, 120];
  let rightEdge = frame.x + minWidth;
  let bottomEdge = frame.y + minHeight;
  const groups = Map.groupBy(members.filter((figure) => !figure.host), (figure) =>
    diagram.followers.has(figure) ? null : memberLane(figure, lanes, original.boxes));
  const children = Map.groupBy(lanes, (lane) => lane.parent);
  const laneBoxes = new Map();
  const units = (figure) => [figure, ...attachments(diagram, figure)];
  const nodeArea = (figure) => boundsOf(units(figure).map((part) => local(state.boxes.get(part))));
  const visibleArea = (figure) => boundsOf(units(figure).flatMap((part) =>
    geometryWithLabels(part, state.boxes.get(part)).map(local)));
  let dx = -Infinity;

  function placeRows(parent, x, y) {
    const lane = parent === scope ? null : parent;
    const header = lane?.header ?? 0;
    const members = groups.get(lane) ?? [];
    const nodes = members.filter((figure) => figure.kind === 'node');
    const left = x + header;
    const top = Math.max(y, scopeArea.y);
    const laneMargin = lane ? ROUTE_MARGIN : CONTAINER_INSET;
    let end = lane ? y + 60 : bottomEdge;
    if (nodes.length) {
      const dy = ceilGrid(Math.max(...nodes.map((node) =>
        Math.max(top - nodeArea(node).y, y - visibleArea(node).y))));
      for (const node of nodes) {
        moveTree(state, diagram, node, world({ x: dx, y: dy }));
        const area = nodeArea(node);
        const visible = visibleArea(node);
        end = Math.max(end, bottom(area) + laneMargin, bottom(visible));
        bottomEdge = Math.max(bottomEdge, bottom(area) + CONTAINER_INSET, bottom(visible));
        rightEdge = Math.max(rightEdge, right(area) + CONTAINER_INSET, right(visible));
      }
    }
    for (const figure of members.filter((member) => member.kind !== 'node')) {
      const box = local(state.boxes.get(figure));
      if (diagram.followers.has(figure)) {
        const owner = diagram.notes.containers.get(figure).filter((container) => container.kind === 'lane').at(-1);
        rightEdge = Math.max(rightEdge, laneLeft(owner) + box.width + ROUTE_MARGIN * 2);
        continue;
      }
      if (lane) {
        const dy = y - local(original.boxes.get(lane)).y;
        moveTree(state, diagram, figure, world({ x: 0, y: dy }));
      }
      const area = visibleArea(figure);
      end = Math.max(end, bottom(area));
      rightEdge = Math.max(rightEdge, right(area));
    }
    const rows = (children.get(parent) ?? []).toSorted((a, b) =>
      local(original.boxes.get(a)).y - local(original.boxes.get(b)).y || byId(a, b));
    let next = lane && nodes.length ? end : y;
    for (const row of rows) next = placeRows(row, left, next);
    end = Math.max(end, next);
    if (lane) {
      rightEdge = Math.max(rightEdge, x + 300);
      laneBoxes.set(lane, { x, y, width: 0, height: end - y });
    }
    return end;
  }

  function laneLeft(lane) {
    let left = content.x;
    for (let owner = lane; owner?.kind === 'lane' && owner.scope === scope; owner = owner.parent) {
      left += owner.header;
    }
    return left;
  }

  for (const [lane, figures] of groups) {
    const left = laneLeft(lane);
    for (const node of figures.filter((figure) => figure.kind === 'node')) {
      dx = Math.max(dx, ceilGrid(Math.max(Math.max(scopeArea.x, left) - nodeArea(node).x, left - visibleArea(node).x)));
    }
  }

  bottomEdge = Math.max(placeRows(scope, content.x, frame.y), bottomEdge);
  // The last lane at each level fills the rest of its parent.
  const fill = (parent, end) => {
    const rows = [...(children.get(parent) ?? [])].sort((a, b) => laneBoxes.get(a).y - laneBoxes.get(b).y);
    for (const row of rows) {
      const box = laneBoxes.get(row);
      const height = row === rows.at(-1) ? end - box.y : box.height;
      state.boxes.set(row, local({ ...box, width: rightEdge - box.x, height }));
      fill(row, box.y + height);
    }
  };
  fill(scope, bottomEdge);
  return { xGrowth: rightEdge - right(frame), yGrowth: bottomEdge - bottom(frame) };
}

function scopeCollisions(state, original, members, lanes, scope, fitted) {
  const frame = state.boxes.get(scope);
  const local = scope.horizontal === false ? transpose : (box) => box;
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
        if (fitted ? intersects(box, currentLane) :
            containsCenter(currentLane, box) !== containsCenter(originalLane, originalBox) ||
            intersects(box, currentLane) && !intersects(originalBox, originalLane)) return true;
      }
      if (frame && !contains(usableArea(scope, local(frame)), local(box))) return true;
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

function hasClearance(a, b, gaps) {
  const dx = Math.max(a.x - right(b), b.x - right(a));
  const dy = Math.max(a.y - bottom(b), b.y - bottom(a));
  return dx >= gaps.x || dy >= gaps.y;
}

function respectsGaps(units, state, gaps, toLocal, includeAttachments = false) {
  const boxes = units.map(({ figure, parts, lane }) => ({
    lane, box: toLocal(includeAttachments
      ? boundsOf(parts.map((part) => state.boxes.get(part)))
      : state.boxes.get(figure))
  }));
  return boxes.every(({ lane, box }, index) => boxes.slice(index + 1).every(({ lane: otherLane, box: other }) =>
    lane !== otherLane || hasClearance(box, other, gaps)));
}

function spacingLayouts(units, graph, spacing, options) {
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

function preferSpacing(candidate, base, best) {
  return candidate.excess < base.excess &&
    compareCosts(candidate.cost.slice(0, 3), base.cost.slice(0, 3)) <= 0 &&
    compareCosts(spacingCost(candidate), spacingCost(best)) < 0;
}

function improveSingleNodeBranches(best, { units, diagram, scope, frame, toLocal, toWorld, spacing, obstacles, lanes, evaluate }) {
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
    if (scopeCollisions(moved, plan, [...new Set([...obstacles, ...parts])], lanes, scope)) continue;
    const tested = evaluate({ ...best, plan: moved });
    if (!tested || tested.cost.slice(0, 3).some((value, index) => value > best.cost[index]) ||
        bends(tested.plan, entry) + bends(tested.plan, exit) >= bends(plan, entry) + bends(plan, exit) ||
        incoming.get(exit.target).some((edge) => bends(plan, edge) === 0 && bends(tested.plan, edge) > 0)) continue;
    best = tested;
  }
  return best;
}

function planScope(diagram, state, scope, gaps, fitSelection) {
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
  // The grid moves with a subprocess or pool, even if its top-left is fractional.
  const relative = (figure) => {
    const box = toLocal(state.boxes.get(figure));
    return frame ? translate(box, { x: -frame.x, y: -frame.y }) : box;
  };
  const area = (figure) => boundsOf([figure, ...attachments(diagram, figure)].map(relative));
  const units = boxes.map((figure) => ({
    figure, lane: figure.lane, parts: [figure, ...attachments(diagram, figure)],
    shape: { ...relative(figure), id: figure.id, type: figure.type },
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
  const spacing = localSpacing(gaps, flip);
  const minimums = { x: spacing.x, y: spacing.y };

  function prepare(deltas) {
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

  function evaluate(candidate) {
    if (!candidate) return null;
    const { plan } = candidate;
    const obstacles = obstaclesInScope.map((figure) => plan.boxes.get(figure));
    for (const lane of lanes) {
      const box = toLocal(plan.boxes.get(lane));
      if (lane.header) obstacles.push(toLocal({ ...box, width: Math.min(lane.header, box.width) }));
    }
    const f = plan.boxes.get(scope);
    const drawing = f ?? boundsOf(lanes.length ? [...obstacles, ...lanes.map((lane) => plan.boxes.get(lane))] : obstacles);
    const pad = f ? 0 : ROUTE_MARGIN * 2;
    const content = f ? toLocal(usableArea(scope, toLocal(f), false)) : drawing;
    const bounds = { left: content.x - pad, top: content.y - pad,
      right: right(content) + pad, bottom: bottom(content) + pad };
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

  if (fitSelection) {
    const candidates = [layoutProcess(units, graph, spacing),
      layoutProcess(units, graph, minimums, { compact: true, reuseBranchRows: true })];
    let best;
    let reason = 'collisions';
    for (const deltas of candidates) {
      const candidate = prepare(deltas);
      if (!candidate || !respectsGaps(units, candidate.plan, minimums, toLocal)) continue;
      const evaluated = evaluate(candidate);
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

  const regular = layoutProcess(units, graph, minimums);
  const base = prepare(regular);
  let best = base && !base.growth ? evaluate(base) : null;
  if (!best) {
    const compact = layoutProcess(units, graph, minimums, { compact: true });
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
    ? prepare(layoutProcess(units, graph, minimums, { compact, reuseBranchRows: true }))
    : null;
  if (packed && packed.growth <= best.growth && height(packed) < height(best) &&
      respectsGaps(units, packed.plan, spacing, toLocal)) {
    const tested = evaluate(packed);
    // A shorter drawing is worthwhile when crossings, shared lines and bends
    // are at least as good by the usual routing priorities.
    if (tested && compareCosts(tested.cost.slice(0, 3), best.cost.slice(0, 3)) <= 0) best = tested;
  }

  if (spacing.maxX !== undefined || spacing.maxY !== undefined) {
    const { layouts, excess } = spacingLayouts(units, graph, spacing, { compact });
    const baseline = { ...best, excess: excess(best.plan, toLocal) };
    best = baseline;
    const containers = frame ? [scope, ...lanes] : lanes;
    for (const deltas of layouts) {
      const candidate = prepare(deltas);
      if (!candidate || !respectsGaps(units, candidate.plan, spacing, toLocal, true) ||
          containers.some((container) => {
            const before = baseline.plan.boxes.get(container);
            const after = candidate.plan.boxes.get(container);
            return after.width > before.width || after.height > before.height;
          })) continue;
      candidate.excess = excess(candidate.plan, toLocal);
      if (candidate.excess >= baseline.excess) continue;
      const tested = evaluate(candidate);
      if (tested && preferSpacing(tested, baseline, best)) best = tested;
    }
  }

  best = improveSingleNodeBranches(best, { units, diagram, scope, frame, toLocal, toWorld, spacing: minimums,
    obstacles: obstaclesInScope, lanes, evaluate });

  const oldScope = state.boxes.get(scope);
  if (oldScope && scope.kind !== 'pool' && !sameBox(oldScope, best.plan.boxes.get(scope))) {
    makeRoom(best.plan, diagram, scope, oldScope, gaps);
  }
  return { state: best.plan };
}

function newOverlap(state, original, figure, others) {
  const next = state.boxes.get(figure);
  return others.some((other) => other !== figure && other.parent === figure.parent &&
    !other.host && other.kind !== 'lane' && other.kind !== 'group' &&
    figure.lane === other.lane &&
    intersects(next, state.boxes.get(other)) &&
    !intersects(original.boxes.get(figure), original.boxes.get(other)));
}

function indexDiagram(figures, edges, auxiliary, canMove = () => true) {
  const notes = annotationLayout(figures, auxiliary);
  const followers = new Set(notes.annotations.filter((note) => [...notes.anchors.get(note)].some(canMove)));
  return {
    notes,
    followers,
    edges,
    incoming: Map.groupBy(edges, ({ target }) => target),
    outgoing: Map.groupBy(edges, ({ source }) => source),
    internalEdges: [...edges, ...auxiliary],
    children: Map.groupBy(figures, (figure) => figure.parent),
    scopes: Map.groupBy(figures, (figure) => figure.scope),
    attachments: Map.groupBy(figures.filter((figure) => figure.host), (figure) => figure.host)
  };
}

function changes(state) {
  const boxes = new Map([...state.boxes].filter(([figure, bounds]) => !sameBox(figure.box, bounds)));
  return { boxes, routes: state.routes };
}

export function planAlignment({ root, figures, edges, messageFlows = [], auxiliary = [] }, gaps) {
  const diagram = indexDiagram(figures, edges, auxiliary);
  const initial = { boxes: new Map(figures.map((figure) => [figure, figure.box])), routes: new Map() };
  const skipped = new Map();
  let reverted = false;
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
    if (scope.kind !== 'root' && scope.kind !== 'pool' && newOverlap(result.state, start, scope, diagram.children.get(scope.parent) ?? [])) {
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

  const failedScopes = new Set(skipped.keys());
  if (pools.length > 1 || messageFlows.length) {
    const collab = collaboration(figures, messageFlows, diagram.followers);
    const placed = placePools(collab, state, initial, gaps, (next, pool, delta) => moveTree(next, diagram, pool, delta));
    if (placed.state) {
      state = { boxes: placed.state.boxes, routes: new Map([...placed.state.routes, ...placed.routes]) };
    } else {
      skipped.set(root, placed.reason === 'stability' ? 'poolStability' : 'poolRouting');
      const nonOverlapping = collab.pools.every((pool, index) => collab.pools.slice(index + 1)
        .every((other) => !intersects(state.boxes.get(pool), state.boxes.get(other))));
      const routes = nonOverlapping && routeMessages(collab, state, initial);
      reverted = !routes;
      state = routes ? { boxes: state.boxes, routes: new Map([...state.routes, ...routes]) } : initial;
    }
  }
  const finished = finishAnnotations(diagram, state, initial, messageFlows, gaps);
  if (!finished) return { ...changes(initial), skipped: [], reason: 'annotations' };
  const labelGateways = reverted ? [] : figures.filter((figure) => {
    if (figure.type !== 'bpmn:ExclusiveGateway') return false;
    for (let scope = figure.scope; scope; scope = scope.kind === 'pool' ? null : scope.scope) {
      if (failedScopes.has(scope)) return false;
    }
    return true;
  });
  return { ...changes(finished), labelGateways, skipped: [...skipped].map(([scope, reason]) => ({ scope, reason })) };
}

export function alignmentSelection(diagram, elements) {
  const byElement = new Map(diagram.figures.map((figure) => [figure.element, figure]));
  const selected = [...new Set(elements.map((element) => element.labelTarget ?? element))];
  const figures = selected.map((element) => byElement.get(element));
  if (!figures.length) return { reason: 'Выберите пул, дорожку, раскрытый подпроцесс или несколько фигур.' };
  const pools = figures.filter((figure) => figure?.kind === 'pool');
  if (pools.length && pools.length !== figures.length) {
    return { reason: 'Выберите только пулы или фигуры одного процесса' };
  }
  if (pools.length > 1) return { pools: new Set(pools) };
  if (figures.some((figure) => !figure)) return { reason: 'Выделение должно состоять из фигур.' };
  if (figures.some((figure) => figure.host && !figures.includes(figure.host))) {
    return { reason: 'Выберите фигуру, к которой прикреплено граничное событие.' };
  }

  const members = figures.filter((figure) => !figure.host);
  const [first] = members;
  if (members.length === 1 && isFrame(first)) {
    const scope = first.kind === 'lane' ? first.scope : first;
    const contents = diagram.figures.filter((figure) => figure.kind === 'node' && figure.scope === scope &&
      (first.kind !== 'lane' || figure.lane && (figure.lane === first || descendantOf(figure.lane, first))));
    return contents.length ? { scope, members: contents, container: first } : { reason: 'В выбранной области нет фигур для выравнивания.' };
  }
  if (members.some(isFrame)) return { reason: 'Выберите один контейнер или несколько отдельных фигур.' };
  if (members.length < 2) return { reason: 'Выберите хотя бы две фигуры.' };
  if (members.some((figure) => figure.scope !== first.scope)) {
    return { reason: 'Фигуры должны принадлежать одному процессу или подпроцессу.' };
  }
  return { scope: first.scope, members };
}

function offsets(areas, axis, obstacles) {
  const end = axis === 'x' ? right : bottom;
  let low = -Infinity;
  let high = Infinity;
  const candidates = new Set();
  for (const { box, limits } of areas) {
    for (const limit of limits) {
      low = Math.max(low, ceilGrid(limit[axis] - box[axis]));
      high = Math.min(high, -ceilGrid(end(box) - end(limit)));
    }
    for (const obstacle of obstacles) {
      candidates.add(ceilGrid(end(obstacle) - box[axis]));
      candidates.add(-ceilGrid(end(box) - obstacle[axis]));
    }
  }
  candidates.add(Math.max(low, Math.min(0, high)));
  return [...candidates].filter((value) => Number.isFinite(value) && value >= low && value <= high)
    .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
}

function fixedRoutes(diagram, state, boxes, movable, finalAnnotations = false, fitted = new Set()) {
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

function unitsOverlap(units, boxes) {
  return units.some(({ parts }, index) => units.slice(index + 1).some((other) =>
    parts.some((part) => other.parts.some((neighbor) => intersects(boxes.get(part), boxes.get(neighbor))))));
}

export function planSelection(snapshot, selection, gaps) {
  const { figures, edges, messageFlows = [], auxiliary = [] } = snapshot;
  const fitted = selection.container && selection.container.kind !== 'lane';
  const selected = selection.pools ?? new Set(fitted ? [selection.container] : selection.members);
  const diagram = indexDiagram(figures, edges, auxiliary, (anchor) =>
    selected.has(anchor.host ?? anchor) || [...selected].some((figure) => descendantOf(anchor, figure)));
  const collab = collaboration(figures, messageFlows, diagram.followers);
  const initial = { boxes: new Map(figures.map((figure) => [figure, figure.box])), routes: new Map() };
  let plan;
  if (selection.pools) {
    const placed = placePools(collab, initial, initial, gaps,
      (next, pool, delta) => moveTree(next, diagram, pool, delta), selection.pools);
    if (!placed.state) return { reason: placed.reason === 'stability' ? 'poolStability' : 'poolRouting' };
    const state = { boxes: placed.state.boxes, routes: new Map([...placed.state.routes, ...placed.routes]) };
    const finished = finishAnnotations(diagram, state, initial, messageFlows, gaps, selection);
    plan = finished ? changes(finished) : { reason: 'annotations' };
  } else if (fitted) {
    plan = planContainerSelection(snapshot, diagram, collab, initial, selection, gaps);
  } else {
    plan = planProcessSelection(snapshot, diagram, collab, initial, selection, gaps);
  }
  if (plan.reason) return plan;
  const labelGateways = figures.filter((figure) => figure.type === 'bpmn:ExclusiveGateway' &&
    (selected.has(figure) || [...selected].some((member) => descendantOf(figure, member))));
  return { ...plan, labelGateways };
}

function planContainerSelection({ figures, messageFlows = [] }, diagram, collab, initial, selection, gaps) {
  const { scope } = selection;
  const fitted = new Set(figures.filter((figure) => (figure === scope || figure.expanded && descendantOf(figure, scope)) &&
    (diagram.scopes.get(figure) ?? []).some((member) => member.kind === 'node')));
  const owned = (figure) => fitted.has(figure) || figure.kind === 'lane' && fitted.has(figure.scope);

  function safe(state) {
    for (const frame of fitted) {
      const local = frame.horizontal === false ? transpose : (box) => box;
      const box = state.boxes.get(frame);
      const area = usableArea(frame, local(box));
      const content = usableArea(frame, local(box), false);
      for (const member of diagram.scopes.get(frame)) {
        if (member.kind === 'group') continue;
        const bounds = state.boxes.get(member);
        if ((member.kind === 'node' || member.host) && !contains(area, local(bounds))) return false;
        if (!geometryWithLabels(member, bounds).every((rect) => contains(content, local(rect)))) return false;
        for (let lane = member.lane ?? member.host?.lane; lane?.kind === 'lane'; lane = lane.parent) {
          const laneArea = usableArea(lane, local(state.boxes.get(lane)), false);
          if (!geometryWithLabels(member, bounds).every((rect) => contains(laneArea, local(rect)))) return false;
        }
      }
    }

    const parent = scope.scope;
    const parts = [scope, ...attachments(diagram, scope)];
    for (const frame of [parent, scope.lane]) {
      if (!state.boxes.has(frame)) continue;
      const local = parent.horizontal === false ? transpose : (box) => box;
      const box = local(state.boxes.get(frame));
      if (parts.some((part) => !contains(usableArea(frame, box), local(state.boxes.get(part))) ||
          !geometryWithLabels(part, state.boxes.get(part)).every((rect) =>
            contains(usableArea(frame, box, false), local(rect))))) return false;
    }
    return parts.every((part) => figures.every((other) => {
      if (parts.includes(other) || descendantOf(other, scope) || other.scope !== parent ||
          other.kind === 'group' || other === scope.lane || scope.lane && descendantOf(scope.lane, other)) return true;
      return geometryWithLabels(part, state.boxes.get(part)).every((rect) =>
        geometryWithLabels(other, state.boxes.get(other)).every((obstacle) => !intersects(rect, obstacle)));
    }));
  }

  function finish(state, frame) {
    // Route labels follow the command stack's waypoint adjustment. Preserve any
    // extra space they need before checking external docking and annotations.
    const local = frame.horizontal === false ? transpose : (box) => box;
    const box = local(state.boxes.get(frame));
    const labels = diagram.edges.filter(({ source }) => source.scope === frame).flatMap((edge) =>
      (edge.projectLabels?.(state.routes.get(edge) ?? edge.points) ?? []).map(local));
    const content = usableArea(frame, box, false);
    if (labels.some((label) => label.x < content.x || label.y < content.y)) return { reason: 'routing' };
    const width = Math.max(box.width, ...labels.map((label) => right(label) - box.x));
    const height = Math.max(box.height, ...labels.map((label) => bottom(label) - box.y));
    if (width !== box.width || height !== box.height) {
      resize(state, diagram, frame, local({ ...box, width, height }));
      for (const lane of diagram.scopes.get(frame).filter((member) => member.kind === 'lane')) {
        const rect = local(state.boxes.get(lane));
        state.boxes.set(lane, local({ ...rect, width: rect.width + width - box.width,
          height: rect.height + (bottom(rect) === bottom(box) ? height - box.height : 0) }));
      }
    }
    if (frame !== scope) return { state };

    const routes = fixedRoutes(diagram, state, changes(state).boxes, undefined, false, fitted);
    const messages = routeMessages(collab, state, initial, { selection: true });
    if (!routes || !messages) return { reason: 'routing' };
    state.routes = new Map([...state.routes, ...routes, ...messages]);
    const finished = finishAnnotations(diagram, state, initial, messageFlows, gaps, { ...selection, owned });
    if (!finished) return { reason: 'annotations' };
    if (!safe(finished)) return { reason: 'collisions' };
    const finalRoutes = fixedRoutes(diagram, finished, changes(finished).boxes, undefined, true, fitted);
    const finalMessages = routeMessages(collaboration(figures, messageFlows), finished, initial, { selection: true });
    if (!finalRoutes || !finalMessages) return { reason: 'routing' };
    finished.routes = new Map([...finished.routes, ...finalRoutes, ...finalMessages]);
    if (obstructedFlows(diagram.notes, finished, [...diagram.internalEdges.filter((edge) =>
      !diagram.notes.associations.includes(edge)), ...messageFlows]).length) return { reason: 'annotations' };

    for (const edge of diagram.internalEdges) {
      if (edge.source.scope !== edge.target.scope || !fitted.has(edge.source.scope)) continue;
      const frame = edge.source.scope;
      const local = frame.horizontal === false ? transpose : (box) => box;
      const area = usableArea(frame, local(finished.boxes.get(frame)), false);
      const points = finished.routes.get(edge) ?? edge.points;
      if (!points?.every((point) => contains(area, local({ ...point, width: 0, height: 0 }))) ||
          edge.projectLabels?.(points).some((label) => !contains(area, local(label)))) return { reason: 'routing' };
    }
    const changed = changes(finished).boxes;
    const changedRoutes = [...finished.routes].filter(([edge]) => fitted.has(edge.source.scope) ||
      changed.has(edge.source) || changed.has(edge.target));
    return { state: finished, cost: routeCost(changedRoutes.map(([, points]) => points)) };
  }

  function align(frame, state) {
    for (const child of (diagram.scopes.get(frame) ?? []).filter((figure) => fitted.has(figure)).sort(byId)) {
      const next = align(child, state);
      if (!next.state) return next;
      state = next.state;
    }
    return planScope(diagram, state, frame, gaps, (plan) => finish(plan, frame));
  }

  const result = align(scope, initial);
  return result.state ? changes(result.state) : result;
}

function planProcessSelection({ figures, edges, messageFlows = [] }, diagram, collab, initial, selection, gaps) {
  const { scope, members } = selection;
  const flip = scope.horizontal === false;
  const local = flip ? transpose : (box) => box;
  const world = flip ? ({ x, y }) => ({ x: y, y: x }) : (delta) => delta;
  const spacing = localSpacing(gaps, flip);
  const minimums = { x: spacing.x, y: spacing.y };
  const frame = scope.box && local(scope.box);
  const origin = { x: frame?.x ?? 0, y: frame?.y ?? 0 };
  const relative = (box) => translate(box, { x: -origin.x, y: -origin.y });
  const scoped = diagram.scopes.get(scope);
  const lanes = scoped.filter((figure) => figure.kind === 'lane');
  const laneBounds = lanes.map(({ box }) => local(box));
  const movable = new Set(members);
  const stationary = scoped.filter((figure) => figure.kind !== 'lane' && figure.kind !== 'group' &&
    !movable.has(figure.host ?? figure) && !diagram.followers.has(figure));
  const obstacles = stationary.map(({ box }) => local(box));
  const units = members.map((figure) => {
    const lane = memberLane(figure, lanes, initial.boxes);
    const parts = [figure, ...attachments(diagram, figure)];
    const limits = [];
    if (frame) limits.push(usableArea(scope, frame));
    for (let owner = lane; owner?.kind === 'lane'; owner = owner.parent) {
      limits.push(usableArea(owner, local(owner.box)));
    }
    return { figure, lane, parts, limits, shape: { ...relative(local(figure.box)), id: figure.id, type: figure.type },
      area: relative(boundsOf(parts.map(({ box }) => local(box)))) };
  });
  const byFigure = new Map(units.map((unit) => [unit.figure, unit]));
  const graph = edges.map((edge) => ({ id: edge.id, isDefault: edge.isDefault,
    source: byFigure.get(edge.source.host ?? edge.source), target: byFigure.get(edge.target.host ?? edge.target) }))
    .filter(({ source, target }) => source && target);
  const subprocesses = members.filter((figure) => figure.expanded);
  let reason = 'collisions';

  function* placements(deltas) {
    if (!deltas) return;
    const areas = units.map((unit) => ({ unit, box: translate(unit.area, {
      x: origin.x + deltas.get(unit).x, y: origin.y + deltas.get(unit).y }), limits: unit.limits }));
    const groups = Map.groupBy(areas, ({ unit }) => unit.lane);
    for (const x of offsets(areas, 'x', obstacles)) {
      const state = clone(initial);
      let fits = true;
      for (const group of groups.values()) {
        const y = offsets(group, 'y', obstacles).find((amount) => group.every(({ unit }) => {
          const delta = { x: deltas.get(unit).x + x, y: deltas.get(unit).y + amount };
          return unit.parts.every((figure) => {
            const part = local(figure.box);
            const box = translate(part, delta);
            return validBox(box) && !obstacles.some((obstacle) => intersects(box, obstacle)) &&
              laneBounds.every((lane) => containsCenter(lane, box) === containsCenter(lane, part) &&
                (!intersects(lane, box) || intersects(lane, part)));
          });
        }));
        if (y === undefined) {
          fits = false;
          break;
        }
        for (const { unit } of group) {
          const delta = deltas.get(unit);
          moveTree(state, diagram, unit.figure, world({ x: delta.x + x, y: delta.y + y }));
        }
      }
      const boxes = new Map([...state.boxes].filter(([figure, box]) => !sameBox(figure.box, box)));
      if (!fits || [...boxes.values()].some((box) => !validBox(box)) ||
          !respectsGaps(units, state, spacing, local) || unitsOverlap(units, state.boxes)) continue;
      yield { state, boxes };
    }
  }

  function allRoutes(candidate, movableParts) {
    const routes = fixedRoutes(diagram, candidate.state, candidate.boxes, movableParts);
    if (!routes) return null;
    const messages = routeMessages(collab, candidate.state, initial, { selection: true });
    return messages && new Map([...candidate.state.routes, ...routes, ...messages]);
  }

  let base;
  for (const compact of [false, true]) {
    const deltas = layoutProcess(units, graph, minimums, { compact });
    for (const candidate of placements(deltas)) {
      const routes = allRoutes(candidate);
      if (!routes) {
        if (reason !== 'annotations') reason = 'routing';
        continue;
      }
      const finished = finishAnnotations(diagram, { boxes: candidate.state.boxes, routes }, initial, messageFlows, gaps, selection);
      if (finished) {
        base = { ...candidate, compact, result: changes(finished) };
        break;
      }
      reason = 'annotations';
    }
    if (base) break;
  }
  if (!base) return { reason };
  if (spacing.maxX === undefined && spacing.maxY === undefined) return base.result;

  const sequence = new Set(edges);
  const { layouts, excess } = spacingLayouts(units, graph, spacing, { compact: base.compact });
  const movableParts = new Set(figures.filter((figure) => movable.has(figure.host ?? figure) ||
    subprocesses.some((subprocess) => descendantOf(figure, subprocess))));
  const movement = (boxes) => [...boxes].reduce((total, [{ box }, next]) =>
    total + Math.abs(next.x - box.x) + Math.abs(next.y - box.y), 0);
  const baseline = { ...base, excess: excess(base.state, local) };
  if (!baseline.excess) return base.result;
  const baseRoutes = allRoutes(base, movableParts);
  if (!baseRoutes) return base.result;
  baseline.cost = [...routeCost(baseRoutes.values()), movement(base.boxes)];
  const fixedUnits = stationary.filter((figure) => figure.kind === 'node').map((figure) => ({
    lane: figure.lane,
    area: boundsOf([figure, ...attachments(diagram, figure)].map(({ box }) => local(box)))
  }));
  let best = baseline;
  for (const deltas of layouts) {
    for (const candidate of placements(deltas)) {
      if (!respectsGaps(units, candidate.state, spacing, local, true) ||
          units.some(({ lane, parts, area }) => {
            const before = translate(area, origin);
            const after = boundsOf(parts.map((part) => local(candidate.state.boxes.get(part))));
            return fixedUnits.some((fixed) => lane === fixed.lane &&
              hasClearance(before, fixed.area, spacing) && !hasClearance(after, fixed.area, spacing));
          })) continue;
      candidate.excess = excess(candidate.state, local);
      if (candidate.excess >= baseline.excess) continue;
      const routes = allRoutes(candidate, movableParts);
      if (!routes) continue;
      candidate.cost = [...routeCost(routes.values()), movement(candidate.boxes)];
      if (preferSpacing(candidate, baseline, best)) {
        const filtered = new Map([...routes].filter(([edge]) =>
          !sequence.has(edge) || candidate.boxes.has(edge.source) || candidate.boxes.has(edge.target)));
        const finished = finishAnnotations(diagram, { boxes: candidate.state.boxes, routes: filtered },
          initial, messageFlows, gaps, selection);
        if (!finished) continue;
        best = { ...candidate, result: changes(finished) };
      }
      break;
    }
  }
  return best.result;
}

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

function finishAnnotations(diagram, planned, initial, messageFlows, gaps, selection) {
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
