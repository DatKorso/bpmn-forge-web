import { intersects } from './layout.js';
import { collaboration, placePools, routeMessages } from './pool-layout.js';
import { byId, validBox, moveTree, indexDiagram, changes } from './alignment-state.js';
import { newOverlap } from './container-fit.js';
import { planScope } from './scope-plan.js';
import { preserveCompactLoops } from './compact-loops.js';
import { finishAnnotations } from './finish-annotations.js';

export { alignmentSelection, planSelection } from './selection-plan.js';

export function planAlignment({ root, figures, edges, messageFlows = [], auxiliary = [] }, gaps) {
  const diagram = indexDiagram(figures, edges, auxiliary);
  const initial = { boxes: new Map(figures.map((figure) => [figure, figure.box])), routes: new Map() };
  const skipped = new Map();
  const loops = [];
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
    loops.push(...(result.loops ?? []));
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
  let finished = finishAnnotations(diagram, state, initial, messageFlows, gaps);
  if (!finished) return { ...changes(initial), skipped: [], reason: 'annotations' };
  function alignedScope(scope) {
    for (let parent = scope; parent; parent = parent.kind === 'pool' ? null : parent.scope) {
      if (failedScopes.has(parent)) return false;
    }
    return true;
  }
  // Evaluate the loop against final positions and routes, including collaboration and annotations.
  if (!reverted && loops.length) {
    finished = preserveCompactLoops(finished, loops.filter(({ scope }) => alignedScope(scope)), diagram, messageFlows, gaps);
  }
  const labelGateways = reverted ? [] : figures.filter((figure) =>
    figure.type === 'bpmn:ExclusiveGateway' && alignedScope(figure.scope));
  return { ...changes(finished), labelGateways, skipped: [...skipped].map(([scope, reason]) => ({ scope, reason })) };
}
