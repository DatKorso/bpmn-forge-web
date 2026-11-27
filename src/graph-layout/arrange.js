import { GRID, boundsOf, ceilGrid, center, intersects, snap, translate, translateWaypoints } from '../layout.js';
import { contains, moveTree, right, bottom, transpose, validBox } from '../alignment-state.js';
import { acceptsRoute, compareCosts, cutsInterior, expandObstacle, ROUTE_MARGIN, routeCost, routeFlows } from '../route-flows.js';
import { routingBounds } from '../routing-bounds.js';
import { CONTAINER_INSET } from '../container-fit.js';
import { isAnnotation } from '../annotation-layout.js';
import { keyAt, modelOf, modelOrder, orderGraph, typeIs } from './model-order.js';
import { readLaneTree } from './lane-tree.js';
import { layoutElk } from './elk.js';
import { routingBox } from './support.js';

const dataTypes = new Set(['bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:DataObject', 'bpmn:DataStore']);
const isData = (figure) => dataTypes.has(figure.type);
const BYPASS_MARGIN = 16;

function routeScope(flows, limits, obstacles, fixed = [], onFailure) {
  const route = (margin, channels = false, reverseOrder = false) => routeFlows(
    channels ? flows.map((flow) => ({
      ...flow,
      sourcePorts: activityPorts(flow.edge.source, flow.source),
      targetPorts: activityPorts(flow.edge.target, flow.target)
    })) : flows,
    limits, obstacles, fixed, {
      margin, clearance: margin, minimumClearance: ROUTE_MARGIN, preventReversals: true,
      reserveStraight: true, channels, reverseOrder, onFailure
    });
  const score = (paths) => routeCost([...paths.values()], fixed).slice(0, 2);
  let best = route(BYPASS_MARGIN);
  for (const options of [[ROUTE_MARGIN], [BYPASS_MARGIN, true], [ROUTE_MARGIN, true],
    [BYPASS_MARGIN, true, true], [ROUTE_MARGIN, true, true]]) {
    if (best && score(best).every((value) => value === 0)) break;
    const candidate = route(...options);
    if (candidate && (!best || compareCosts(score(candidate), score(best)) < 0)) best = candidate;
  }
  return best;
}

function activityPorts(figure, box) {
  if (!typeIs(modelOf(figure), 'bpmn:Activity')) return;
  const x = center(box, 'x');
  const y = center(box, 'y');
  return { inset: 10, projections: [
    { x: x - BYPASS_MARGIN, y: y - BYPASS_MARGIN },
    { x: x + BYPASS_MARGIN, y: y + BYPASS_MARGIN }
  ] };
}

function dataContacts(edges, scope, rank) {
  const contacts = [];
  for (const { source, target } of edges) {
    const [activity, data] = isData(source) ? [target, source] : [source, target];
    if (data.scope !== scope || !isData(data) || isData(activity)) continue;

    // An activity in an expanded subprocess is represented by its enclosing
    // subprocess in the outer scope. The BPMN association keeps its real ends.
    let owner = activity.host ?? activity;
    while (owner.scope && owner.scope !== scope) owner = owner.scope;
    if (rank.has(owner) && rank.has(data)) contacts.push([owner, data]);
  }
  return contacts.sort(([a, b], [c, d]) => rank.get(a) - rank.get(c) || rank.get(b) - rank.get(d));
}

function unitParts(figure, state, attachments, downstreamEvents, toLocal) {
  const { width, height } = toLocal(state.boxes.get(figure));
  const parts = [[figure, { x: 0, y: 0, width, height }]];
  const widths = attachments.map((event) => toLocal(state.boxes.get(event)).width);
  const span = widths.reduce((sum, size) => sum + size, 0);
  const gap = Math.max(0, (width - span) / (widths.length + 1));
  // A solitary event can leave the host near its downstream corner.
  const trailing = width - span - ROUTE_MARGIN;
  const singleExit = attachments.length === 1 && downstreamEvents.has(modelOf(attachments[0]));
  let x = singleExit && trailing > gap ? trailing : gap || (width - span) / 2;
  for (const event of attachments) {
    const { width, height: eventHeight } = toLocal(state.boxes.get(event));
    parts.push([event, { x, y: height - eventHeight / 2, width, height: eventHeight }]);
    x += width + gap;
  }
  return parts;
}

export function packRows(units, children, geometry, header, spacing, expanded, vertical = false, room = 0) {
  const inset = CONTAINER_INSET + room;
  const crossInset = inset + (expanded && !vertical ? 20 : 0);
  const title = expanded && vertical ? 20 : 0;
  const headerEnds = new Map();
  let deepestHeader = header;
  function measureHeaders(parent, x) {
    for (const lane of children.get(parent) ?? []) {
      const end = x + lane.header;
      headerEnds.set(lane, end);
      deepestHeader = Math.max(deepestHeader, end);
      measureHeaders(lane, end);
    }
  }
  measureHeaders(undefined, header);
  const dx = ceilGrid(deepestHeader + inset + title);
  const positioned = new Map();
  const laneBoxes = new Map();
  const bands = new Map();
  const groups = Map.groupBy([...units], ([, unit]) => unit.lane);
  const hasLanes = children.get(undefined).length > 0;
  let cursor = hasLanes ? 0 : crossInset;
  let maxX = dx;
  function packBand(lane, x) {
    const members = groups.get(lane) ?? [];
    const minY = Math.min(...members.map(([, { key }]) => geometry.get(key).y), Infinity);
    const dy = members.length ? ceilGrid(cursor + (hasLanes ? crossInset : 0) - minY + GRID / 2) : 0;
    let maxY = cursor + crossInset;
    for (const [figure, { key, parts }] of members) {
      const origin = geometry.get(key);
      const area = boundsOf(parts.map(([, box]) => box));
      const host = parts[0][1];
      const shift = {
        x: snap(origin.x - area.x + dx + host.width / 2) - host.width / 2,
        y: snap(origin.y - area.y + dy + host.height / 2) - host.height / 2
      };
      for (const [part, box] of parts) {
        const placed = translate(box, shift);
        positioned.set(part, placed);
        maxX = Math.max(maxX, right(placed));
        maxY = Math.max(maxY, bottom(placed));
      }
    }
    const end = ceilGrid(maxY + (lane ? Math.max(crossInset, spacing.y / 2) : inset));
    if (lane) bands.set(lane, { x, y: cursor, width: 0, height: end - cursor });
    cursor = end;
  }
  function packLanes(parent, x) {
    for (const lane of children.get(parent) ?? []) {
      const y = cursor;
      const childX = headerEnds.get(lane);
      if (groups.has(lane) || !children.get(lane)?.length) packBand(lane, x);
      packLanes(lane, childX);
      laneBoxes.set(lane, { x, y, width: 0, height: cursor - y });
    }
  }
  packLanes(undefined, header);
  if (groups.has(undefined) || !hasLanes) packBand(undefined, 0);
  const width = ceilGrid(maxX + inset);
  for (const box of [...laneBoxes.values(), ...bands.values()]) box.width = width - box.x;
  return { positioned, laneBoxes, bands, frame: { x: 0, y: 0, width, height: cursor } };
}

export function captureStructure(scope) {
  const { nodes, edges } = modelOrder(scope);
  return {
    nodes, edges, laneTree: readLaneTree(scope, nodes),
    defaults: new Set(edges.filter((edge) => edge.sourceRef?.default === edge)),
    downstreamEvents: new Set(edges
      .filter(({ sourceRef, targetRef }) => sourceRef?.attachedToRef &&
        sourceRef.attachedToRef !== (targetRef?.attachedToRef ?? targetRef))
      .map(({ sourceRef }) => sourceRef))
  };
}

export async function arrangeScope(scope, diagram, state, gaps, diagnostics, vertical = scope.horizontal === false) {
  const { nodes, edges, laneTree, defaults, downstreamEvents } = diagram.structures.get(scope);
  const figures = diagram.scopes.get(scope) ?? [];
  const byModel = new Map(figures.map((figure) => [modelOf(figure), figure]));
  const lanes = laneTree.lanes.map((model) => byModel.get(model));
  const laneOf = (figure) => byModel.get(laneTree.memberships.get(modelOf(figure)));
  const units = new Map();
  const members = nodes.map((model) => byModel.get(model)).filter(Boolean);
  const memberSet = new Set(members);
  const rank = new Map(members.map((figure, index) => [figure, index]));
  for (const figure of members) {
    if (!figure.expanded) continue;
    const failure = await arrangeScope(figure, diagram, state, gaps, diagnostics, vertical);
    if (failure) return failure;
  }
  const spacing = vertical ? { x: gaps.y, y: gaps.x } : gaps;
  const toLocal = vertical ? transpose : (value) => value;
  const contacts = dataContacts(diagram.data, scope, rank);
  const dataOwners = Map.groupBy(contacts, ([, sink]) => sink);
  const attached = Map.groupBy(members.filter(({ host }) => host), ({ host }) => host);
  for (const [index, figure] of members.entries()) {
    if (figure.host) continue;
    const [owner] = dataOwners.get(figure)?.[0] ?? [];
    const lane = laneOf(figure) ?? (isData(figure) ? (owner && laneOf(owner.host ?? owner)) ?? lanes[0] : undefined);
    const attachments = attached.get(figure) ?? [];
    units.set(figure, { key: keyAt(index), parts: unitParts(figure, state, attachments, downstreamEvents, toLocal), lane });
  }
  const scopeEdges = diagram.sequenceByModel;
  const flows = edges.map((model, index) => {
    const edge = scopeEdges.get(model);
    return edge && { id: keyAt(index), edge, source: edge.source.host ?? edge.source, target: edge.target.host ?? edge.target,
      isDefault: defaults.has(model) };
  });
  const missing = nodes.some((model) =>
    (typeIs(model, 'bpmn:FlowNode') || typeIs(model, 'bpmn:DataObjectReference') ||
      typeIs(model, 'bpmn:DataStoreReference')) && !byModel.has(model));
  if (missing || lanes.some((lane) => !lane) || figures.some((figure) => figure.kind !== 'pool' && !isAnnotation(figure) &&
      !memberSet.has(figure) && !lanes.includes(figure)) ||
      flows.some((flow) => !flow || !units.has(flow.source) || !units.has(flow.target))) {
    return { scope, reason: 'graphIncomplete' };
  }
  if (!units.size && !lanes.length && scope.kind === 'root') return;
  const dataEdges = contacts.map(([source, target], index) => ({ source, target, id: `d${keyAt(index)}` }));
  const children = new Map([...laneTree.children].map(([parent, models]) =>
    [byModel.get(parent), models.map((model) => byModel.get(model))]));
  const laneRanks = new Map(lanes.map((lane, index) => [lane, index]));
  const laneRank = (figure) => laneRanks.get(units.get(figure).lane) ?? lanes.length;
  const graph = orderGraph([...units.keys()], flows, dataEdges, laneRank);
  let failedFlow;
  async function candidate(room, widen = false) {
    const actualSpacing = widen ? { x: spacing.x + room, y: spacing.y + room } : spacing;
    const elk = await layoutElk(graph, units, actualSpacing, vertical);
    const geometry = new Map(elk.children?.map(({ id, ...box }) => [id, toLocal(box)]));
    const { positioned, laneBoxes, bands, frame } = packRows(units, children, geometry, scope.header ?? 0,
      actualSpacing, scope.expanded, vertical, room);
    if (![frame, ...positioned.values(), ...laneBoxes.values()].every(validBox)) return { reason: 'bounds' };
    const boxes = new Map([...positioned].map(([figure, box]) => [figure, routingBox(figure, toLocal(box))]));
    const obstacles = [...boxes.values()];
    const frameBounds = new Map([[scope, toLocal(frame)], ...[...laneBoxes].map(([lane, box]) => [lane, toLocal(box)])]);
    const limits = routingBounds(scope, { boxes: frameBounds }, lanes, toLocal, obstacles);
    const routed = flows.map((flow) => ({
      ...flow, source: boxes.get(flow.edge.source), target: boxes.get(flow.edge.target),
      sourceHost: boxes.get(flow.edge.source.host), targetHost: boxes.get(flow.edge.target.host),
      back: graph.back.has(flow) || flow.source === flow.target, vertical
    }));
    const routes = routeScope(routed, limits, obstacles, [], ({ edge }) => { failedFlow = edge; });
    const reason = !routes || routed.some((flow) =>
      !acceptsRoute(routes.get(flow.id), flow, limits, obstacles, ROUTE_MARGIN)) ? 'graphSequenceClearance' : undefined;
    return { reason, scope, units, elk, positioned, laneBoxes, bands, frame, toLocal, flows: routed, limits, obstacles, routes };
  }

  const room = state.room?.get(scope) ?? 0;
  let result = await candidate(room, room > 0);
  if (result.reason === 'graphSequenceClearance') result = await candidate(room + 24, true);
  if (result.reason) return { scope, reason: result.reason, elementId: failedFlow?.id };
  const { positioned, laneBoxes, bands, frame, flows: routed, routes } = result;
  if (diagnostics) diagnostics.push(result);
  if (routed.length) state.routing.set(scope, result);
  for (const [figure, box] of positioned) {
    const world = toLocal(box);
    if (figure.expanded) moveTree(state, diagram, figure, {
      x: world.x - state.boxes.get(figure).x, y: world.y - state.boxes.get(figure).y
    });
    else state.boxes.set(figure, world);
  }
  for (const [figure, { lane }] of units) {
    if (!lane || !(figure.expanded || typeIs(modelOf(figure), 'bpmn:Gateway'))) continue;
    const box = toLocal(positioned.get(figure));
    // Store the band relative to its unit so it follows later scope and pool moves.
    state.labelBands.set(figure, translate(toLocal(bands.get(lane)), { x: -box.x, y: -box.y }));
  }
  for (const [lane, box] of laneBoxes) state.boxes.set(lane, toLocal(box));
  if (scope.kind !== 'root') state.boxes.set(scope, toLocal(frame));
  const pairs = [...positioned];
  if (pairs.some(([figure, box], index) => pairs.slice(index + 1).some(([other, otherBox]) =>
    figure.host !== other && other.host !== figure && intersects(box, otherBox))) ||
    [...units.values()].some(({ lane, parts }) => parts.some(([figure]) =>
      !contains(lane ? bands.get(lane) : frame, positioned.get(figure)) ||
      (figure.host && !intersects(positioned.get(figure.host), positioned.get(figure))))) ||
    routed.some(({ back, source, target }) => !back && right(toLocal(source)) > toLocal(target).x)) {
    return { scope, reason: 'collisions' };
  }
  for (const { edge, id } of flows) state.routes.set(edge, routes.get(id));
}

export function rerouteForLabel(state, scope, label, reservations) {
  const routing = state.routing.get(scope);
  if (!routing) return false;
  const { flows, limits, obstacles, positioned, toLocal } = routing;
  const first = flows[0];
  const source = state.boxes.get(first.edge.source);
  const original = toLocal(positioned.get(first.edge.source));
  const delta = { x: source.x - original.x, y: source.y - original.y };
  const local = { x: -delta.x, y: -delta.y };
  const padded = expandObstacle(label, ROUTE_MARGIN);
  const affected = flows.filter(({ edge }) => {
    const path = state.routes.get(edge);
    return path.slice(1).some((point, index) => cutsInterior(path[index], point, padded));
  });
  if (!affected.length) return false;
  const fixed = flows.filter((flow) => !affected.includes(flow))
    .map(({ edge }) => translateWaypoints(state.routes.get(edge), local));
  const blocked = [...obstacles, ...reservations.map((box) => translate(box, local)), translate(label, local)];
  const next = routeScope(affected, limits, blocked, fixed);
  if (!next || affected.some((flow) => !acceptsRoute(next.get(flow.id), flow, limits, blocked, ROUTE_MARGIN))) {
    return false;
  }
  for (const { id, edge } of affected) state.routes.set(edge, translateWaypoints(next.get(id), delta));
  return true;
}
