import { boundsOf } from './layout.js';
import { right, bottom } from './alignment-state.js';
import { usableArea } from './container-fit.js';
import { ROUTE_MARGIN } from './route-flows.js';

export function routingBounds(scope, plan, lanes, toLocal, obstacles) {
  for (const lane of lanes) {
    const box = toLocal(plan.boxes.get(lane));
    if (lane.header) obstacles.push(toLocal({ ...box, width: Math.min(lane.header, box.width) }));
  }
  const frame = plan.boxes.get(scope);
  const pad = frame ? 0 : ROUTE_MARGIN * 2;
  const content = frame ? toLocal(usableArea(scope, toLocal(frame), false))
    : boundsOf([...obstacles, ...lanes.map((lane) => plan.boxes.get(lane))]);
  return { left: content.x - pad, top: content.y - pad,
    right: right(content) + pad, bottom: bottom(content) + pad };
}
