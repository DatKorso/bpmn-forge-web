import { GRID, boundsOf, ceilGrid, center, intersects, snap, translate, translateWaypoints } from '../layout.js';
import { changes, contains, indexDiagram, moveTree, right, bottom, sameBox, transpose, validBox } from '../alignment-state.js';
import { acceptsRoute, ROUTE_MARGIN, routeFlows } from '../route-flows.js';
import { finishFixedAnnotations } from '../finish-annotations.js';
import { isAnnotation } from '../annotation-layout.js';

const modelOf = (entry) => entry.model ?? entry.element?.businessObject ?? entry.connection?.businessObject;
const processOf = (scope) => modelOf(scope)?.processRef ?? modelOf(scope);
const isData = (figure) => ['bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:DataObject', 'bpmn:DataStore'].includes(figure.type);
const isDataFlow = (edge) => ['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation'].includes(edge.type);
const typeIs = (model, type) => model?.$instanceOf(type);
const keyAt = (index) => `k${String(index + 1).padStart(8, '0')}`;

export function modelOrder(scope) {
  const model = processOf(scope);
  const nodes = [];
  const outgoing = new Map();
  for (const member of model?.flowElements ?? []) {
    if (typeIs(member, 'bpmn:SequenceFlow')) {
      if (!outgoing.has(member.sourceRef)) outgoing.set(member.sourceRef, []);
      outgoing.get(member.sourceRef).push(member);
    } else {
      nodes.push(member);
    }
  }
  const edges = nodes.flatMap((node) => {
    const flows = outgoing.get(node) ?? [];
    const explicit = new Map((node.outgoing ?? []).map((flow, index) => [flow, index]));
    return flows.toSorted((a, b) => Number(b === node.default) - Number(a === node.default) ||
      (explicit.get(a) ?? Infinity) - (explicit.get(b) ?? Infinity));
  });
  return { nodes, edges, lanes: (model?.laneSets ?? []).flatMap((set) => set.lanes) };
}

function support(diagram) {
  const root = modelOf(diagram.root);
  const definitions = root?.$parent;
  const collaborations = (definitions?.rootElements ?? [root]).filter((model) => typeIs(model, 'bpmn:Collaboration'));
  const pools = diagram.figures.filter((figure) => figure.kind === 'pool');
  if (pools.length > 1 || diagram.messageFlows?.length ||
      collaborations.some((model) => model.participants?.length > 1 || model.messageFlows?.length)) {
    return { scope: diagram.root, reason: 'graphCollaboration' };
  }
  function check(model, scope) {
    if (model?.artifacts?.some((artifact) => typeIs(artifact, 'bpmn:Group'))) return 'graphGroup';
    if (model?.laneSets?.some((set) => set.lanes.some((lane) => lane.childLaneSet))) return 'graphNestedLanes';
    if (scope?.kind === 'pool') {
      const lanes = modelOrder(scope).lanes;
      const owned = new Set(lanes.flatMap((lane) => lane.flowNodeRef ?? []));
      if (lanes.length && model.flowElements?.some((node) => typeIs(node, 'bpmn:FlowNode') && !owned.has(node))) {
        return 'graphMissingLane';
      }
    }
    for (const child of model?.flowElements ?? []) {
      const reason = check(child);
      if (reason) return reason;
    }
  }
  for (const scope of [diagram.root, ...pools]) {
    const reason = check(processOf(scope), scope);
    if (reason) return { scope, reason };
  }
}

function components(nodes, outgoing) {
  const index = new Map();
  const low = new Map();
  const active = new Set();
  const stack = [];
  const groups = new Map();
  function visit(node) {
    index.set(node, index.size);
    low.set(node, index.get(node));
    stack.push(node);
    active.add(node);
    for (const { target } of outgoing.get(node) ?? []) {
      if (!index.has(target)) {
        visit(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (active.has(target)) {
        low.set(node, Math.min(low.get(node), index.get(target)));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      groups.set(member, node);
    } while (member !== node);
  }
  for (const node of nodes) if (!index.has(node)) visit(node);
  return groups;
}

export function orderGraph(nodes, edges, dataEdges) {
  const graph = edges.filter(({ source, target }) => source !== target);
  const outgoing = Map.groupBy(graph, ({ source }) => source);
  for (const flows of outgoing.values()) flows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const groups = components(nodes, outgoing);
  const entries = new Set(graph.filter(({ source, target }) => groups.get(source) !== groups.get(target))
    .map(({ target }) => target));
  const seen = new Set();
  const active = new Set();
  const back = new Set();
  function visit(node) {
    seen.add(node);
    active.add(node);
    for (const edge of outgoing.get(node) ?? []) {
      const { target } = edge;
      if (groups.get(node) !== groups.get(target)) continue;
      if (active.has(target)) back.add(edge);
      else if (!seen.has(target)) visit(target);
    }
    active.delete(node);
  }
  for (const node of [...nodes.filter((node) => entries.has(node)), ...nodes]) if (!seen.has(node)) visit(node);
  const dag = graph.map((edge) => back.has(edge)
    ? { ...edge, source: edge.target, target: edge.source }
    : edge).concat(dataEdges);
  const successors = Map.groupBy(dag, ({ source }) => source);
  const incoming = new Map(nodes.map((node) => [node, 0]));
  for (const { target } of dag) incoming.set(target, incoming.get(target) + 1);
  const ordered = [];
  const ready = nodes.filter((node) => !incoming.get(node));
  const keys = new Map(nodes.map((node, index) => [node, index]));
  const preferred = new Set();
  while (ready.length) {
    ready.sort((a, b) => Number(preferred.has(b)) - Number(preferred.has(a)) || keys.get(a) - keys.get(b));
    const node = ready.shift();
    ordered.push(node);
    for (const { target, isDefault } of successors.get(node) ?? []) {
      if (isDefault) preferred.add(target);
      incoming.set(target, incoming.get(target) - 1);
      if (!incoming.get(target)) ready.push(target);
    }
  }
  if (ordered.length !== nodes.length) throw new Error('Expected acyclic ELK input');
  return { ordered, back, dag };
}

let elkPromise;

async function layoutElk(graph, units, gaps, vertical) {
  const toWorld = vertical ? transpose : (box) => box;
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  const elk = await elkPromise;
  const padding = '0';
  const layoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': vertical ? 'DOWN' : 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.padding': `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`,
    'elk.spacing.nodeNode': String(gaps.y + GRID + ROUTE_MARGIN),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(gaps.x + GRID + ROUTE_MARGIN),
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'true'
  };
  return elk.layout({
    id: 'scope', layoutOptions,
    children: graph.ordered.map((figure) => {
      const { parts, key } = units.get(figure);
      const area = boundsOf(parts.map(([, box]) => box));
      const { width, height } = toWorld(area);
      const mid = parts[0][1].height / 2 - area.y;
      const ports = [
        { id: `${key}In`, x: 0, y: mid }, { id: `${key}Out`, x: area.width, y: mid }
      ];
      return {
        id: key, width, height, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: ports.map(({ id, x, y }) => ({ id, width: 0, height: 0, ...(vertical ? { x: y, y: x } : { x, y }) }))
      };
    }),
    edges: graph.dag.map(({ id, source, target }) => ({
      id, sources: [`${units.get(source).key}Out`], targets: [`${units.get(target).key}In`]
    }))
  });
}

function unitParts(figure, state, attachments, toLocal) {
  const { width, height } = toLocal(state.boxes.get(figure));
  const parts = [[figure, { x: 0, y: 0, width, height }]];
  const widths = attachments.map((event) => toLocal(state.boxes.get(event)).width);
  const span = widths.reduce((sum, size) => sum + size, 0);
  const gap = Math.max(0, (width - span) / (widths.length + 1));
  let x = gap || (width - span) / 2;
  for (const event of attachments) {
    const { width, height: eventHeight } = toLocal(state.boxes.get(event));
    parts.push([event, { x, y: height - eventHeight / 2, width, height: eventHeight }]);
    x += width + gap;
  }
  return parts;
}

function pack(units, lanes, geometry, header, spacing, expanded) {
  const inset = 40;
  const crossInset = expanded ? inset + 20 : inset;
  const dx = ceilGrid(header + (lanes.length ? lanes[0].header : 0) + inset);
  const positioned = new Map();
  const laneBoxes = new Map();
  const groups = Map.groupBy([...units], ([, unit]) => unit.lane);
  let cursor = lanes.length ? 0 : crossInset;
  let maxX = dx;
  for (const lane of lanes.length ? lanes : [undefined]) {
    const members = groups.get(lane) ?? [];
    const minY = Math.min(...members.map(([, { key }]) => geometry.get(key).y), Infinity);
    const dy = members.length ? ceilGrid(cursor + (lane ? crossInset : 0) - minY + GRID / 2) : 0;
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

async function arrangeScope(scope, diagram, state, gaps, diagnostics) {
  const { nodes, edges, lanes: modelLanes } = modelOrder(scope);
  const figures = diagram.scopes.get(scope) ?? [];
  const byModel = new Map(figures.map((figure) => [modelOf(figure), figure]));
  const lanes = modelLanes.map((model) => byModel.get(model));
  const units = new Map();
  const members = nodes.map((model) => byModel.get(model)).filter(Boolean);
  for (const child of members.filter((figure) => figure.expanded)) {
    const failure = await arrangeScope(child, diagram, state, gaps, diagnostics);
    if (failure) return failure;
  }
  const vertical = scope.horizontal === false;
  const spacing = vertical ? { x: gaps.y, y: gaps.x } : gaps;
  const toLocal = vertical ? transpose : (value) => value;
  const data = diagram.data.filter(({ source, target }) => figures.includes(source) && figures.includes(target));
  const dataEnds = (edge) => isData(edge.source) ? [edge.target, edge.source] : [edge.source, edge.target];
  const dataOwners = Map.groupBy(data.map(dataEnds), ([, sink]) => sink);
  for (const [index, figure] of members.entries()) {
    if (figure.host) continue;
    const lane = figure.lane ?? (isData(figure) ? (dataOwners.get(figure)?.[0][0].lane ?? lanes[0]) : undefined);
    const attachments = members.filter((member) => member.host === figure);
    units.set(figure, { key: keyAt(index), parts: unitParts(figure, state, attachments, toLocal), lane });
  }
  const scopeEdges = diagram.outgoingByModel;
  const flows = edges.map((model, index) => {
    const edge = scopeEdges.get(model);
    return edge && { id: keyAt(index), edge, source: edge.source.host ?? edge.source, target: edge.target.host ?? edge.target,
      isDefault: model.sourceRef.default === model };
  });
  if (lanes.some((lane) => !lane) || figures.some((figure) => figure.kind !== 'pool' && !isAnnotation(figure) &&
      !members.includes(figure) && !lanes.includes(figure)) ||
      [...units.values()].some(({ lane }) => lanes.length && !lanes.includes(lane)) ||
      flows.some((flow) => !flow || !units.has(flow.source) || !units.has(flow.target))) {
    return { scope, reason: 'graphIncomplete' };
  }
  if (!units.size && !lanes.length && scope.kind === 'root') return;
  const dataEdges = data.map((edge) => {
    const [source, target] = dataEnds(edge);
    return { source: source.host ?? source, target };
  }).filter(({ source, target }) => units.has(source) && units.has(target) && !isData(source) && isData(target))
    .sort((a, b) => units.get(a.source).key.localeCompare(units.get(b.source).key) ||
      units.get(a.target).key.localeCompare(units.get(b.target).key))
    .map((edge, index) => ({ ...edge, id: `d${keyAt(index)}` }));
  const graph = orderGraph([...units.keys()], flows, dataEdges);
  const elk = await layoutElk(graph, units, spacing, vertical);
  const geometry = new Map(elk.children?.map(({ id, ...box }) => [id, toLocal(box)]));
  const { positioned, laneBoxes, frame } = pack(units, lanes, geometry, scope.header, spacing, scope.expanded);
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
  for (const [lane, box] of laneBoxes) obstacles.push(toLocal({ ...box, width: lane.header }));
  const content = toLocal({ ...frame, x: scope.header, width: frame.width - scope.header });
  const limits = { left: content.x, top: content.y, right: right(content), bottom: bottom(content) };
  const routed = flows.map((flow) => ({
    ...flow, source: state.boxes.get(flow.edge.source), target: state.boxes.get(flow.edge.target),
    back: graph.back.has(flow) || flow.source === flow.target, vertical
  }));
  if (diagnostics) diagnostics.push({ scope, units, elk, positioned, laneBoxes, flows: routed, limits, obstacles });
  const routes = routeFlows(routed, limits, obstacles);
  if (!routes || routed.some((flow) => !acceptsRoute(routes.get(flow.id), flow, limits, obstacles))) {
    return { scope, reason: 'routing' };
  }
  const pairs = [...positioned];
  if (pairs.some(([figure, box], index) => pairs.slice(index + 1).some(([other, otherBox]) =>
    figure.host !== other && other.host !== figure && intersects(box, otherBox))) ||
    [...units.values()].some(({ lane, parts }) => parts.some(([figure]) =>
      !contains(lane ? laneBoxes.get(lane) : frame, positioned.get(figure)))) ||
    routed.some(({ back, source, target }) => !back && center(toLocal(source), 'x') >= center(toLocal(target), 'x'))) {
    return { scope, reason: 'collisions' };
  }
  for (const { edge, id } of flows) state.routes.set(edge, routes.get(id));
}

export async function planGraphLayout(diagram, gaps, diagnostics) {
  const failure = (reason, scope = diagram.root) =>
    ({ boxes: new Map(), routes: new Map(), labelGateways: [], skipped: [], reason, scope });
  const unsupported = support(diagram);
  if (unsupported) return failure(unsupported.reason, unsupported.scope);
  const pool = diagram.figures.find((figure) => figure.kind === 'pool');
  const scope = pool ?? diagram.root;
  const auxiliary = diagram.auxiliary ?? [];
  const indexed = {
    ...indexDiagram(diagram.figures, diagram.edges, auxiliary.filter((edge) => !isDataFlow(edge))),
    data: auxiliary.filter(isDataFlow),
    outgoingByModel: new Map(diagram.edges.map((edge) => [modelOf(edge), edge]))
  };
  const state = { boxes: new Map(diagram.figures.map((figure) => [figure, figure.box])), routes: new Map() };
  const result = await arrangeScope(scope, indexed, state, gaps, diagnostics);
  if (result) return failure(result.reason, result.scope);
  if (diagram.edges.some((edge) => !state.routes.has(edge)) ||
      diagram.figures.some((figure) => !isAnnotation(figure) && state.boxes.get(figure) === figure.box)) {
    return failure('graphIncomplete', scope);
  }
  const members = diagram.figures.filter((figure) => !isAnnotation(figure));
  if (members.length) {
    const local = boundsOf(members.map((figure) => state.boxes.get(figure)));
    const original = boundsOf(members.map((figure) => figure.box));
    const delta = pool ? { x: pool.box.x, y: pool.box.y } :
      { x: snap(original.x - local.x), y: snap(original.y - local.y) };
    for (const figure of members) state.boxes.set(figure, translate(state.boxes.get(figure), delta));
    for (const [edge, path] of state.routes) state.routes.set(edge, translateWaypoints(path, delta));
  }
  if (![...state.boxes.values()].every(validBox)) return failure('bounds', scope);
  const finished = finishFixedAnnotations(indexed, state);
  if (!finished || members.some((figure) => !sameBox(state.boxes.get(figure), finished.boxes.get(figure))) ||
      diagram.edges.some((edge) => state.routes.get(edge) !== finished.routes.get(edge))) return failure('annotations', scope);
  return {
    ...changes(finished),
    routes: new Map([...finished.routes].filter(([edge, path]) =>
      path.length !== edge.points?.length || path.some(({ x, y }, i) => x !== edge.points[i].x || y !== edge.points[i].y))),
    labelGateways: diagram.figures.filter(({ type }) => type === 'bpmn:ExclusiveGateway'),
    skipped: []
  };
}
