import { is } from 'bpmn-js/lib/util/ModelUtil';
import { isHorizontal, LANE_INDENTATION } from './bpmn-internals.js';
import { contains } from './alignment-state.js';
import { translate } from './layout.js';

const isNote = ({ type }) => type === 'bpmn:TextAnnotation';
const associations = (shape) => [...shape.incoming, ...shape.outgoing]
  .filter(({ type, hidden }) => type === 'bpmn:Association' && !hidden);

function fitsParent(note, delta) {
  const next = translate(note, delta);
  for (let parent = note.parent; parent?.parent; parent = parent.parent) {
    if (parent.type === 'bpmn:Participant') {
      const content = isHorizontal(parent) === false
        ? { ...parent, y: parent.y + LANE_INDENTATION, height: parent.height - LANE_INDENTATION }
        : { ...parent, x: parent.x + LANE_INDENTATION, width: parent.width - LANE_INDENTATION };
      if (!contains(content, next)) return false;
    } else if (is(parent, 'bpmn:SubProcess') && !contains(parent, next)) return false;
  }
  return true;
}

class LinkedAnnotationMove {
  static $inject = ['eventBus', 'modeling'];

  constructor(eventBus, modeling) {
    for (const [command, key, type] of [['shape.move', 'shape', 'bpmn:TextAnnotation'],
      ['connection.move', 'connection', 'bpmn:Association']]) {
      const event = `commandStack.${command}.preExecute`;
      eventBus.on(event, 1500, ({ context }) => {
        const element = context[key];
        if (element.type === type && (!context.newParent || context.newParent === element.parent)) {
          context.keepArtifactParent = true;
        }
      });
      eventBus.on(event, 500, ({ context }) => {
        if (!context.keepArtifactParent) return;
        // BPMN ordering can lift an annotation to the canvas root even on a geometry-only move.
        const element = context[key];
        context.newParent = element.parent;
        context.newParentIndex = element.parent.children.indexOf(element);
      });
    }

    eventBus.on('commandStack.elements.move.preExecuted', ({ context }) => {
      if (!context.hints?.primaryShape) return;
      const moving = new Set(Object.values(context.closure.allShapes));
      for (const shape of moving) {
        for (const attacher of shape.attachers ?? []) moving.add(attacher);
      }
      const candidates = new Set();
      for (const anchor of moving) {
        if (isNote(anchor)) continue;
        for (const { source, target } of associations(anchor)) {
          const note = source === anchor ? target : source;
          if (isNote(note) && !note.hidden && !moving.has(note)) candidates.add(note);
        }
      }
      context.linkedNotes = [];
      for (const note of candidates) {
        const anchors = new Set(associations(note).map(({ source, target }) => source === note ? target : source)
          .filter((anchor) => !isNote(anchor) && !anchor.hidden));
        if (anchors.size && [...anchors].every((anchor) => moving.has(anchor))) {
          context.linkedNotes.push({ note, anchors: [...anchors].map((anchor) =>
            ({ anchor, x: anchor.x, y: anchor.y })) });
        }
      }
    });

    eventBus.on('commandStack.elements.move.postExecuted', 600, ({ context }) => {
      for (const { note, anchors } of context.linkedNotes ?? []) {
        const [first] = anchors;
        const delta = { x: first.anchor.x - first.x, y: first.anchor.y - first.y };
        if ((!delta.x && !delta.y) || anchors.some(({ anchor, x, y }) =>
          !anchor.parent || anchor.x - x !== delta.x || anchor.y - y !== delta.y)) continue;

        if (!fitsParent(note, delta)) continue;
        modeling.moveShape(note, delta, note.parent, { recurse: false, autoResize: false });
      }
    });
  }
}

export default {
  __init__: ['linkedAnnotationMove'],
  linkedAnnotationMove: ['type', LinkedAnnotationMove]
};
