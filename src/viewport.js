const padding = 16;

function visibleBounds(canvas) {
  const container = canvas.getContainer();
  const { width, height } = canvas.getSize();
  const palette = container.querySelector('.djs-palette').getBoundingClientRect();
  const rect = container.getBoundingClientRect();
  const controls = document.getElementById('viewport-controls').getBoundingClientRect();
  const properties = document.getElementById('properties').getBoundingClientRect();
  const left = palette.right - rect.left + padding;
  const right = properties.width ? Math.min(width, properties.left - rect.left) : width;
  const bottom = controls.height ? controls.top - rect.top : height;

  return {
    left,
    top: padding,
    right: Math.max(left + 1, right - padding),
    bottom: Math.max(padding + 1, bottom - padding)
  };
}

function centerOf({ left, top, right, bottom }) {
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

export function fitDiagram(canvas) {
  const { inner, outer } = canvas.viewbox();
  if (!outer.width || !outer.height) return;
  const bounds = visibleBounds(canvas);
  const center = centerOf(bounds);
  const scale = Math.min(1,
    (bounds.right - bounds.left) / Math.max(1, inner.width),
    (bounds.bottom - bounds.top) / Math.max(1, inner.height));

  canvas.viewbox({
    x: inner.x + inner.width / 2 - center.x / scale,
    y: inner.y + inner.height / 2 - center.y / scale,
    width: outer.width / scale,
    height: outer.height / scale
  });
}

export function zoomDiagram(canvas, factor) {
  const current = canvas.zoom();
  const scale = Math.min(4, Math.max(Math.min(0.2, current), current * factor));
  canvas.zoom(scale, centerOf(visibleBounds(canvas)));
}

export function revealSelection(modeler) {
  const selection = modeler?.get('selection').get();
  if (selection?.length) revealElements(modeler.get('canvas'), selection);
}

export function revealElements(canvas, elements) {
  canvas.resized();
  const bounds = visibleBounds(canvas);
  const { width, height } = canvas.getSize();
  canvas.scrollToElement(elements, {
    left: bounds.left,
    top: bounds.top,
    right: width - bounds.right,
    bottom: height - bounds.bottom
  });
}

export function placementCenter(canvas) {
  const { x, y, scale } = canvas.viewbox();
  const center = centerOf(visibleBounds(canvas));
  return { x: x + center.x / scale, y: y + center.y / scale };
}

export function placementOffset(canvas, position, keepVisible) {
  const { x, y, scale } = canvas.viewbox();
  const offset = { x: (position.x - x) * scale, y: (position.y - y) * scale };
  if (keepVisible) {
    const { left, top, right, bottom } = visibleBounds(canvas);
    const clampedX = Math.max(left, Math.min(offset.x, right));
    const clampedY = Math.max(top, Math.min(offset.y, bottom));
    if (clampedX !== offset.x || clampedY !== offset.y) {
      canvas.scroll({ dx: clampedX - offset.x, dy: clampedY - offset.y });
      return { x: clampedX, y: clampedY };
    }
  }
  return offset;
}
