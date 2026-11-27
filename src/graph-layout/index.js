import { boundsOf, snap, translate, translateWaypoints } from '../layout.js';
import { changes, indexDiagram, validBox } from '../alignment-state.js';
import { isAnnotation } from '../annotation-layout.js';
import { arrangeScope, captureStructure } from './arrange.js';
import { arrangeCollaboration, isDataFlow, isPassivePool, localizePassivePool } from './collaboration.js';
import { modelOf, processOf } from './model-order.js';
import { fixedLabels, placeNotes } from './decorations.js';
import { finishCollaborationRoutes } from './collaboration-routes.js';
import { inspectCollaboration, unsupportedGraph } from './support.js';

function recordGraphTiming(stage, start) {
  const name = `bpmn:graph:${stage}`;
  performance.clearMeasures(name);
  performance.measure(name, { start, end: performance.now() });
}

export async function planGraphLayout(diagram, gaps, diagnostics, { allowMixedPools = true } = {}) {
  const room = new Map();
  let stages = diagnostics && [];
  let plan = await planDiagram(diagram, gaps, stages, allowMixedPools, room);
  while (plan.reason === 'graphGatewayLabel' && !room.has(plan.scope)) {
    room.set(plan.scope, 48);
    stages = diagnostics && [];
    const retry = await planDiagram(diagram, gaps, stages, allowMixedPools, room);
    if (retry.reason && retry.reason !== 'graphGatewayLabel') break;
    plan = retry;
  }
  if (stages) diagnostics.push(...stages);
  return plan;
}

async function planDiagram(diagram, gaps, diagnostics, allowMixedPools, room) {
  const failure = (reason, scope = diagram.root, elementId) =>
    ({ boxes: new Map(), routes: new Map(), labelGateways: [], skipped: [], reason, scope, elementId });
  const structures = new Map([diagram.root, ...diagram.figures.filter(({ expanded, kind }) => expanded || kind === 'pool')]
    .map((scope) => [scope, captureStructure(scope)]));
  const collaboration = inspectCollaboration(diagram, structures);
  const unsupported = collaboration?.reason ? collaboration : unsupportedGraph(diagram, structures);
  if (unsupported) return failure(unsupported.reason, unsupported.scope, unsupported.elementId);
  if (!allowMixedPools && collaboration?.pools.some(({ horizontal }) => horizontal === false) &&
      collaboration.pools.some(({ horizontal }) => horizontal !== false)) {
    return failure('graphMixedOrientation');
  }
  if (collaboration?.extended) {
    const arranged = await arrangeCollaboration(diagram, collaboration, structures, gaps, diagnostics, recordGraphTiming, room);
    if (arranged.reason) return failure(arranged.reason, arranged.scope, arranged.elementId);
    return { ...plannedChanges(arranged), labels: arranged.labels, labelGateways: [], skipped: [],
      diagnostics: collaboration.diagnostics };
  }
  const pool = diagram.figures.find((figure) => figure.kind === 'pool');
  const scope = pool ?? diagram.root;
  const auxiliary = diagram.auxiliary ?? [];
  if (auxiliary.some((edge) => !edge.source || !edge.target)) return failure('graphIncomplete', scope);
  const indexed = {
    ...indexDiagram(diagram.figures, diagram.edges, auxiliary.filter((edge) => !isDataFlow(edge))),
    data: auxiliary.filter(isDataFlow),
    structures,
    sequenceByModel: new Map(diagram.edges.map((edge) => [modelOf(edge), edge]))
  };
  const state = {
    boxes: new Map(diagram.figures.map((figure) => [figure, figure.box])),
    routes: new Map(),
    routing: new Map(),
    labelBands: new Map(),
    room
  };
  const localStart = performance.now();
  const passive = pool && isPassivePool(diagram.figures, structures.get(pool));
  if (passive) localizePassivePool(pool, diagram.figures, state);
  const result = passive ? undefined : await arrangeScope(scope, indexed, state, gaps, diagnostics);
  recordGraphTiming('local', localStart);
  if (result) return failure(result.reason, result.scope, result.elementId);
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
  const notesStart = performance.now();
  const order = new Map();
  function visit(model) {
    order.set(model, order.size);
    for (const member of [...model.flowElements ?? [], ...model.artifacts ?? []]) visit(member);
  }
  visit(processOf(scope));
  if (pool) visit(modelOf(diagram.root));
  const modelRank = (figure) => order.get(modelOf(figure)) ?? Infinity;
  const figures = diagram.figures.toSorted((a, b) => modelRank(a) - modelRank(b));
  const context = {
    owner: collaboration?.owner ?? new Map(), messages: [], auxiliary,
    order: new Map(figures.map((figure, index) => [figure, index]))
  };
  const fixed = fixedLabels(figures.filter((figure) => !isAnnotation(figure)), state);
  if (fixed.reason) return failure(fixed.reason, fixed.scope, fixed.elementId);
  const blocked = placeNotes(diagram, context, state, figures, fixed.obstacles);
  recordGraphTiming('notes', notesStart);
  if (blocked) return failure(blocked.reason, blocked.scope, blocked.elementId);
  const routed = finishCollaborationRoutes(diagram, context, state, fixed.obstacles);
  if (routed.reason) return failure(routed.reason, routed.scope, routed.elementId);
  return {
    ...plannedChanges({ boxes: state.boxes, routes: new Map([...state.routes, ...routed.routes]) }),
    labels: new Map([...fixed.labels, ...routed.labels]),
    labelGateways: [],
    skipped: [],
    diagnostics: collaboration?.diagnostics ?? []
  };
}

function plannedChanges(state) {
  const { boxes } = changes(state);
  return {
    boxes,
    // Claim unchanged routes at moved endpoints to suppress automatic docking.
    routes: new Map([...state.routes].filter(([edge, path]) =>
      boxes.has(edge.source) || boxes.has(edge.target) || path.length !== edge.points?.length ||
      path.some(({ x, y }, i) => Math.abs(x - edge.points[i].x) >= 1e-7 || Math.abs(y - edge.points[i].y) >= 1e-7)))
  };
}
