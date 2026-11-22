import { boundsOf, GRID } from '../layout.js';
import { transpose } from '../alignment-state.js';
import { ROUTE_MARGIN } from '../route-flows.js';

let elkPromise;

export async function layoutElk(graph, units, gaps, vertical) {
  const toWorld = vertical ? transpose : (box) => box;
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  const elk = await elkPromise;
  const layoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': vertical ? 'DOWN' : 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    'elk.spacing.componentComponent': String(Math.max(gaps.x, gaps.y) + GRID + ROUTE_MARGIN),
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
