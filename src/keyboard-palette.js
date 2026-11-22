import PaletteProvider from 'bpmn-js/lib/features/palette/PaletteProvider';
import { GRID, snap } from './layout.js';
import { placementCenter, placementOffset } from './viewport.js';

const directions = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
};
const instructions = 'Стрелки перемещают маркер, Enter размещает фигуру, Escape отменяет размещение.';

function KeyboardPlacement(canvas, eventBus, elementRegistry, rules, modeling, selection, directEditing, dragging) {
  const container = canvas.getContainer();
  const marker = document.createElement('div');
  marker.className = 'placement-marker';
  marker.hidden = true;
  marker.setAttribute('aria-hidden', 'true');
  const hint = document.createElement('div');
  hint.className = 'placement-hint';
  hint.setAttribute('role', 'status');
  container.append(marker, hint);
  let placement;

  this.start = (event, shapes, { hints = {} } = {}) => {
    dragging.cancel();
    const center = placementCenter(canvas);
    placement = {
      entry: event.target,
      elements: Array.isArray(shapes) ? shapes : [shapes],
      hints,
      position: { x: snap(center.x), y: snap(center.y) }
    };
    marker.hidden = false;
    hint.textContent = instructions;
    updateMarker(true);
  };

  const cancel = this.cancel = () => {
    placement = undefined;
    marker.hidden = true;
    hint.textContent = '';
  };

  this.handleKey = (event) => {
    if (!placement) return false;
    const direction = directions[event.key];

    if (direction) {
      placement.position.x += direction[0] * GRID;
      placement.position.y += direction[1] * GRID;
      hint.textContent = instructions;
      updateMarker(true);
    } else if (event.key === 'Escape') {
      const { entry } = placement;
      cancel();
      entry.focus();
    } else if (event.key === 'Enter') {
      if (!event.repeat) place();
    } else if (event.key !== ' ') {
      return false;
    }

    return true;
  };

  function updateMarker(keepVisible = false) {
    if (!placement) return;
    const { x, y } = placementOffset(canvas, placement.position, keepVisible);
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
  }

  function place() {
    const { elements, hints, position } = placement;
    const canvasRect = container.getBoundingClientRect();
    const offset = placementOffset(canvas, position, true);
    const target = document.elementsFromPoint(canvasRect.left + offset.x, canvasRect.top + offset.y)
      .map((node) => node.closest('[data-element-id]'))
      .filter((node) => node && container.contains(node))
      .map((node) => elementRegistry.get(node.dataset.elementId))
      .find((element) => element && !element.labelTarget) ?? canvas.getRootElement();

    const [shape] = elements;
    const attach = elements.length === 1 && rules.allowed('shape.attach', { shape, target, position });
    const allowed = attach || (elements.length === 1
      ? rules.allowed('shape.create', { shape, target, position })
      : rules.allowed('elements.create', { elements: elements.filter((element) => !element.parent), target, position }));
    if (!allowed) {
      hint.textContent = `Здесь нельзя разместить фигуру. ${instructions}`;
      return;
    }

    cancel();
    const created = modeling.createElements(elements, position, target, { ...hints, attach });
    selection.select(hints.autoSelect ?? created);
    if (!directEditing.activate(created[0])) canvas.focus();
  }

  eventBus.on(['canvas.viewbox.changed', 'canvas.resized'], () => updateMarker());
  eventBus.on('root.set', cancel);
}

KeyboardPlacement.$inject = [
  'canvas', 'eventBus', 'elementRegistry', 'rules', 'modeling', 'selection', 'directEditing', 'dragging'
];

class KeyboardPaletteProvider extends PaletteProvider {
  constructor(palette, create, elementFactory, spaceTool, lassoTool, handTool, globalConnect, translate,
    keyboardPlacement, eventBus, canvas) {
    super(palette, {
      start(event, ...args) {
        if (event instanceof KeyboardEvent) keyboardPlacement.start(event, ...args);
        else create.start(event, ...args);
      }
    }, elementFactory, spaceTool, lassoTool, handTool, globalConnect, translate);

    eventBus.on('palette.create', ({ container }) => {
      setupKeyboardNavigation(container, palette, keyboardPlacement, eventBus, canvas);
    });
  }
}

KeyboardPaletteProvider.$inject = [
  ...PaletteProvider.$inject, 'keyboardPlacement', 'eventBus', 'canvas'
];

function setupKeyboardNavigation(container, palette, placement, eventBus, canvas) {
  const toggle = container.querySelector('.djs-palette-toggle');
  const entries = () => [...container.querySelectorAll('.entry[data-action]')];
  const visibleEntries = () => {
    if (!palette.isOpen()) return [toggle];
    return container.classList.contains('two-column') ? [...entries(), toggle] : entries();
  };
  let entry;
  let wasOpen;

  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'Палитра BPMN');
  toggle.setAttribute('role', 'button');

  function setTabStop(next) {
    entry = next;
    for (const item of [...entries(), toggle]) item.tabIndex = item === entry ? 0 : -1;
  }

  eventBus.on('palette.changed', ({ open }) => {
    const visible = visibleEntries();
    const hadFocus = container.contains(document.activeElement) || document.activeElement === entry;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Свернуть палитру' : 'Развернуть палитру');
    setTabStop(visible.includes(entry) && open === wasOpen ? entry : visible[0]);
    wasOpen = open;
    if (hadFocus) entry.focus();
  });

  container.addEventListener('focusin', ({ target }) => setTabStop(target));
  container.addEventListener('focusout', ({ relatedTarget }) => {
    if (!container.contains(relatedTarget)) placement.cancel();
  });
  container.addEventListener('pointerdown', () => placement.cancel());
  container.addEventListener('keydown', (event) => {
    const { key, target } = event;
    if (!placement.handleKey(event)) {
      if (directions[key]) {
        const visible = visibleEntries();
        const [x, y] = directions[key];
        const step = x || y;
        const next = (visible.indexOf(target) + step + visible.length) % visible.length;
        visible[next].focus();
      } else if (key === 'Enter' || key === ' ') {
        if (!event.repeat) {
          if (target === toggle) {
            palette.toggle();
            entry.focus();
          } else {
            const action = target.dataset.action;
            const bounds = canvas.getContainer().getBoundingClientRect();
            const activation = action.startsWith('create.') ? event : new MouseEvent('click', {
              clientX: bounds.left + bounds.width / 2,
              clientY: bounds.top + bounds.height / 2
            });
            palette.triggerEntry(action, 'click', activation);
          }
        }
      } else {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
  });
}

export default {
  keyboardPlacement: ['type', KeyboardPlacement],
  paletteProvider: ['type', KeyboardPaletteProvider]
};
