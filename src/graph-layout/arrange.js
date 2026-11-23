import { GRID, boundsOf, ceilGrid, intersects, snap, translate } from '../layout.js';
import { contains, moveTree, right, bottom, transpose, validBox } from '../alignment-state.js';
import { acceptsRoute, compareCosts, ROUTE_MARGIN, routeCost, routeFlows } from '../route-flows.js';
import { routingBounds } from '../routing-bounds.js';
import { CONTAINER_INSET } from '../container-fit.js';
import { isAnnotation } from '../annotation-layout.js';
import { keyAt, modelOf, modelOrder, orderGraph, typeIs } from './model-order.js';
import { layoutElk } from './elk.js';

const dataTypes = new Set(['bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:DataObject', 'bpmn:DataStore']);
const isData = (figure) => dataTypes.has(figure.type);
const BYPASS_MARGIN = 16;

function routeScope(flows, limits, obstacles) {
  const route = (margin) => routeFlows(flows, limits, obstacles, [], { margin, preventReversals: true });
  const preferred = route(BYPASS_MARGIN);
  if (!preferred) return route(ROUTE_MARGIN);
  const interactions = routeCost([...preferred.values()]).slice(0, 2);
  if (interactions.every((value) => value === 0)) return preferred;
  const fallback = route(ROUTE_MARGIN);
  return fallback && compareCosts(routeCost([...fallback.values()]).slice(0, 2), interactions) < 0
    ? fallback : preferred;
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

export function packRows(units, lanes, geometry, header, spacing, expanded, vertical = false) {
  const inset = CONTAINER_INSET;
  const crossInset = inset + (expanded && !vertical ? 20 : 0);
  const title = expanded && vertical ? 20 : 0;
  const dx = ceilGrid(header + (lanes.length ? lanes[0].header : 0) + inset + title);
  const positioned = new Map();
  const laneBoxes = new Map();
  const groups = Map.groupBy([...units], ([, unit]) => unit.lane);
  const bands = groups.has(undefined) || !lanes.length ? [...lanes, undefined] : lanes;
  let cursor = lanes.length ? 0 : crossInset;
  let maxX = dx;
  for (const lane of bands) {
    const members = groups.get(lane) ?? [];
    const minY = Math.min(...members.map(([, { key }]) => geometry.get(key).y), Infinity);
    const dy = members.length ? ceilGrid(cursor + (lanes.length ? crossInset : 0) - minY + GRID / 2) : 0;
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
    if (lane) {
      const height = ceilGrid(maxY + Math.max(crossInset, spacing.y / 2)) - cursor;
      laneBoxes.set(lane, { x: header, y: cursor, width: 0, height });
      cursor += height;
    } else {
      cursor = ceilGrid(maxY + inset);
    }
  }
  const width = ceilGrid(maxX + inset);
  for (const box of laneBoxes.values()) box.width = width - header;
  return { positioned, laneBoxes, frame: { x: 0, y: 0, width, height: cursor } };
}

export async function arrangeScope(scope, diagram, state, gaps, diagnostics, vertical = scope.horizontal === false) {
  const { nodes, edges, lanes: modelLanes } = modelOrder(scope);
  const figures = diagram.scopes.get(scope) ?? [];
  const byModel = new Map(figures.map((figure) => [modelOf(figure), figure]));
  const lanes = modelLanes.map((model) => byModel.get(model));
  const memberLanes = new Map();
  for (const model of modelLanes) {
    for (const member of model.flowNodeRef ?? []) {
      if (!memberLanes.has(member)) memberLanes.set(member, byModel.get(model));
    }
  }
  const laneOf = (figure) => memberLanes.get(modelOf(figure));
  const units = new Map();
  const members = nodes.map((model) => byModel.get(model)).filter(Boolean);
  const memberSet = new Set(members);
  const rank = new Map(members.map((figure, index) => [figure, index]));
  for (const figure of members) {
    if (figure.type === 'bpmn:ExclusiveGateway') diagram.labelGateways.push(figure);
    if (!figure.expanded) continue;
    const failure = await arrangeScope(figure, diagram, state, gaps, diagnostics, vertical);
    if (failure) return failure;
  }
  const spacing = vertical ? { x: gaps.y, y: gaps.x } : gaps;
  const toLocal = vertical ? transpose : (value) => value;
  const contacts = dataContacts(diagram.data, scope, rank);
  const dataOwners = Map.groupBy(contacts, ([, sink]) => sink);
  const attached = Map.groupBy(members.filter(({ host }) => host), ({ host }) => host);
  const downstreamEvents = new Set(edges
    .filter(({ sourceRef, targetRef }) => sourceRef?.attachedToRef &&
      sourceRef.attachedToRef !== (targetRef?.attachedToRef ?? targetRef))
    .map(({ sourceRef }) => sourceRef));
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
      isDefault: model.sourceRef?.default === model };
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
  const laneRanks = new Map(lanes.map((lane, index) => [lane, index]));
  const laneRank = (figure) => laneRanks.get(units.get(figure).lane) ?? lanes.length;
  const graph = orderGraph([...units.keys()], flows, dataEdges, laneRank);
  const elk = await layoutElk(graph, units, spacing, vertical);
  const geometry = new Map(elk.children?.map(({ id, ...box }) => [id, toLocal(box)]));
  const { positioned, laneBoxes, frame } = packRows(units, lanes, geometry, scope.header ?? 0, spacing, scope.expanded, vertical);
  if (![frame, ...positioned.values(), ...laneBoxes.values()].every(validBox)) return { scope, reason: 'bounds' };
  for (const [figure, box] of positioned) {
    const world = toLocal(box);
    if (figure.expanded) moveTree(state, diagram, figure, {
      x: world.x - state.boxes.get(figure).x, y: world.y - state.boxes.get(figure).y
    });
    else state.boxes.set(figure, world);
  }
  for (const [lane, box] of laneBoxes) state.boxes.set(lane, toLocal(box));
  if (scope.kind !== 'root') state.boxes.set(scope, toLocal(frame));
  const obstacles = [...positioned.keys()].map((figure) => state.boxes.get(figure));
  const frameBounds = new Map([[scope, toLocal(frame)], ...[...laneBoxes].map(([lane, box]) => [lane, toLocal(box)])]);
  const limits = routingBounds(scope, { boxes: frameBounds }, lanes, toLocal, obstacles);
  const routed = flows.map((flow) => ({
    ...flow, source: state.boxes.get(flow.edge.source), target: state.boxes.get(flow.edge.target),
    back: graph.back.has(flow) || flow.source === flow.target, vertical
  }));
  if (diagnostics) diagnostics.push({ scope, units, elk, positioned, laneBoxes, flows: routed, limits, obstacles });
  const routes = routeScope(routed, limits, obstacles);
  if (!routes || routed.some((flow) => !acceptsRoute(routes.get(flow.id), flow, limits, obstacles))) {
    return { scope, reason: 'routing' };
  }
  const pairs = [...positioned];
  if (pairs.some(([figure, box], index) => pairs.slice(index + 1).some(([other, otherBox]) =>
    figure.host !== other && other.host !== figure && intersects(box, otherBox))) ||
    [...units.values()].some(({ lane, parts }) => parts.some(([figure]) =>
      !contains(lane ? laneBoxes.get(lane) : frame, positioned.get(figure)) ||
      (figure.host && (!intersects(positioned.get(figure.host), positioned.get(figure)) ||
        (laneOf(figure) && laneOf(figure) !== lane))))) ||
    routed.some(({ back, source, target }) => !back && right(toLocal(source)) > toLocal(target).x)) {
    return { scope, reason: 'collisions' };
  }
  for (const { edge, id } of flows) state.routes.set(edge, routes.get(id));
}
