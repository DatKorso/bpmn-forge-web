# Preserve compact BPMN loops

- Recognize a task above the left gateway of a three-node loop in the incoming diagram. Require both exclusive gateways to share a row and all three nodes to share a lane or a process without lanes.
- After whole-diagram alignment, try moving the task into the left gateway’s column. Keep the placement only when it fits the final containers and spacing and the existing router produces a straight return and a one-bend entry without worsening route interactions.
- Cover compact, obstructed, insufficient-gap, and stretched loops. Verify repeat alignment and the browser import, undo, redo, and export workflow on Node.js 24.
