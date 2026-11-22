import { modelOf, modelOrder, processOf, typeIs } from './model-order.js';

export function unsupportedGraph(diagram) {
  const root = modelOf(diagram.root);
  const definitions = root?.$parent;
  const collaborations = (definitions?.rootElements ?? [root]).filter((model) => typeIs(model, 'bpmn:Collaboration'));
  const pools = diagram.figures.filter((figure) => figure.kind === 'pool');
  if (pools.length > 1 || diagram.messageFlows?.length ||
      collaborations.flatMap((model) => model.participants ?? []).length > 1 ||
      collaborations.some((model) => model.messageFlows?.length)) {
    return { scope: diagram.root, reason: 'graphCollaboration' };
  }
  const byModel = new Map(diagram.figures.map((figure) => [modelOf(figure), figure]));
  function check(model, scope) {
    if (model?.artifacts?.some((artifact) => typeIs(artifact, 'bpmn:Group'))) return { scope, reason: 'graphGroup' };
    if (model?.laneSets?.some((set) => set.lanes.some((lane) => lane.childLaneSet))) {
      return { scope, reason: 'graphNestedLanes' };
    }
    if (scope?.kind === 'pool') {
      const lanes = modelOrder(scope).lanes;
      const owned = new Set(lanes.flatMap((lane) => lane.flowNodeRef ?? []));
      if (lanes.length && model.flowElements?.some((node) => typeIs(node, 'bpmn:FlowNode') && !owned.has(node))) {
        return { scope, reason: 'graphMissingLane' };
      }
    }
    for (const child of model?.flowElements ?? []) {
      if (!typeIs(child, 'bpmn:SubProcess')) continue;
      const failure = check(child, byModel.get(child) ?? scope);
      if (failure) return failure;
    }
  }
  for (const scope of [diagram.root, ...pools]) {
    const failure = check(processOf(scope), scope);
    if (failure) return failure;
  }
}
