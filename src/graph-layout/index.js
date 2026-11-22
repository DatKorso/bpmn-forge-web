import { boundsOf, snap, translate, translateWaypoints } from '../layout.js';
import { changes, indexDiagram, sameBox, validBox } from '../alignment-state.js';
import { finishFixedAnnotations } from '../finish-annotations.js';
import { isAnnotation } from '../annotation-layout.js';
import { arrangeScope } from './arrange.js';
import { modelOf } from './model-order.js';
import { unsupportedGraph } from './support.js';

const isDataFlow = (edge) => ['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation'].includes(edge.type);

export async function planGraphLayout(diagram, gaps, diagnostics) {
  const failure = (reason, scope = diagram.root) =>
    ({ boxes: new Map(), routes: new Map(), labelGateways: [], skipped: [], reason, scope });
  const unsupported = unsupportedGraph(diagram);
  if (unsupported) return failure(unsupported.reason, unsupported.scope);
  const pool = diagram.figures.find((figure) => figure.kind === 'pool');
  const scope = pool ?? diagram.root;
  const auxiliary = diagram.auxiliary ?? [];
  if (auxiliary.some((edge) => !edge.source || !edge.target)) return failure('graphIncomplete', scope);
  const indexed = {
    ...indexDiagram(diagram.figures, diagram.edges, auxiliary.filter((edge) => !isDataFlow(edge))),
    data: auxiliary.filter(isDataFlow),
    labelGateways: [],
    sequenceByModel: new Map(diagram.edges.map((edge) => [modelOf(edge), edge]))
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
  const { boxes } = changes(finished);
  return {
    boxes,
    // Mark unchanged routes at moved endpoints as planned so the editor
    // does not fall back to bpmn-js routing for those flows.
    routes: new Map([...finished.routes].filter(([edge, path]) =>
      boxes.has(edge.source) || boxes.has(edge.target) || path.length !== edge.points?.length ||
      path.some(({ x, y }, i) => x !== edge.points[i].x || y !== edge.points[i].y))),
    labelGateways: indexed.labelGateways,
    skipped: []
  };
}
