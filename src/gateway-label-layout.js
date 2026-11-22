import { center, intersects, nearestFreeBox } from './layout.js';
import { cutsInterior, ROUTE_MARGIN } from './route-flows.js';

const REACH = 40;
const right = (box) => box.x + box.width;
const bottom = (box) => box.y + box.height;

export function placeGatewayLabel(label, gateway, obstacles, paths, containers) {
  const { width, height } = label;
  const searchArea = {
    x: gateway.x - REACH - width - ROUTE_MARGIN,
    y: gateway.y - REACH - height - ROUTE_MARGIN,
    width: gateway.width + 2 * (REACH + width + ROUTE_MARGIN),
    height: gateway.height + 2 * (REACH + height + ROUTE_MARGIN)
  };
  const boxes = [gateway, ...obstacles.filter((box) => intersects(box, label) || intersects(box, searchArea))];
  const diagonals = [];
  let blocked = boxes.some((box) => intersects(label, box));
  for (const points of paths) {
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      if (a.x === b.x && a.y === b.y) continue;
      blocked ||= cutsInterior(a, b, label);
      if (!cutsInterior(a, b, searchArea)) continue;
      if (a.x !== b.x && a.y !== b.y) diagonals.push([a, b]);
      else boxes.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
    }
  }
  if (!blocked) return label;

  const distance = (box) => (box.x - label.x) ** 2 + (box.y - label.y) ** 2;
  const x = center(label, 'x') - center(gateway, 'x');
  const y = center(label, 'y') - center(gateway, 'y');
  const preferredSide = Math.abs(y) * gateway.width >= Math.abs(x) * gateway.height
    ? (y <= 0 ? 0 : 1) : (x >= 0 ? 2 : 3);
  const across = gateway.width + 2 * width;
  const along = gateway.height + 2 * height;
  const strips = [
    { x: gateway.x - width, y: gateway.y - REACH - height, width: across, height: REACH + height },
    { x: gateway.x - width, y: bottom(gateway), width: across, height: REACH + height },
    { x: right(gateway), y: gateway.y - height, width: REACH + width, height: along },
    { x: gateway.x - REACH - width, y: gateway.y - height, width: REACH + width, height: along }
  ];
  let best = label;
  let cost = Infinity;
  for (const side of new Set([preferredSide, 0, 1, 2, 3])) {
    const limits = strips[side];
    for (const container of containers) {
      const endX = Math.min(right(limits), right(container));
      const endY = Math.min(bottom(limits), bottom(container));
      limits.x = Math.max(limits.x, container.x);
      limits.y = Math.max(limits.y, container.y);
      limits.width = endX - limits.x;
      limits.height = endY - limits.y;
    }
    const candidate = nearestFreeBox(label, boxes, limits, ROUTE_MARGIN, diagonals);
    if (candidate && distance(candidate) < cost - 1e-7) {
      best = candidate;
      cost = distance(candidate);
    }
  }
  return best;
}
