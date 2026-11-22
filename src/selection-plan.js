import { boundsOf, intersects, layoutProcess, translate } from './layout.js';
import { routeCost } from './route-flows.js';
import { collaboration, placePools, routeMessages } from './pool-layout.js';
import { isFrame, obstructedFlows } from './annotation-layout.js';
import { byId, right, bottom, sameBox, transpose, localSpacing, descendantOf, contains, validBox, clone, moveTree, attachments, indexDiagram, changes, offsets } from './alignment-state.js';
import { usableArea, geometryWithLabels, containsCenter, resize, memberLane } from './container-fit.js';
import { hasClearance, respectsGaps, spacingLayouts, preferSpacing, planScope } from './scope-plan.js';
import { fixedRoutes } from './fixed-routes.js';
import { finishAnnotations } from './finish-annotations.js';

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
