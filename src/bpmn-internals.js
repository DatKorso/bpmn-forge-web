// Keep version-sensitive bpmn-js and diagram-js integration in one place.
export { isExpanded, isHorizontal } from 'bpmn-js/lib/util/DiUtil';
export { collectLanes, getLanesRoot, LANE_INDENTATION } from 'bpmn-js/lib/features/modeling/util/LaneUtil';
export { getLabelAdjustment } from 'bpmn-js/lib/features/modeling/behavior/util/LabelLayoutUtil';
export { isDirectionHorizontal } from 'bpmn-js/lib/features/modeling/util/ModelingUtil';

export function getUndoAction(commandStack) {
  // Stack actions retain their identity across undo and redo.
  return commandStack?._getUndoAction();
}

export function updateBounds(updater, element) {
  updater.updateBounds(element);
}
