// These cases use complete BPMN and DI so Node and Chromium can open the same input.
const scenarios = {
  'invoice-lifecycle': {
    lanes: {
      Intake: 'Receive invoice|Identify supplier|Capture invoice|Validate tax fields|Find purchase order|Match line items|Match delivery|Check duplicate',
      Review: 'Check coding|Assess variance|Request explanation|Collect evidence|Review evidence|Confirm cost center|Approve exception|Record decision',
      Payment: 'Select payment method|Check bank details|Verify beneficiary|Schedule payment|Prepare batch|Release payment|Reconcile settlement|Archive invoice'
    },
    detour: 'Query supplier|Receive correction|Verify correction|Update ledger|Recheck amount|Record variance'
  },
  'access-lifecycle': {
    lanes: {
      Requester: 'Submit request|Identify system|Select role|Document purpose|Specify duration|Confirm manager|Attach justification|Submit for review',
      Security: 'Check sponsor|Check policy|Review data sensitivity|Assess separation of duties|Validate training|Approve scope|Set expiry|Record approval',
      Operations: 'Create ticket|Reserve change window|Verify identity|Prepare account|Apply role|Test access|Notify requester|Schedule expiry|Record completion'
    },
    detour: 'Ask for details|Receive justification|Clarify scope|Review revised request|Document exception|Resolve review'
  }
};

export const graphWorkloads = Object.keys(scenarios);

export function graphWorkloadXml(name, { localEdit = false } = {}) {
  const { lanes, detour } = scenarios[name];
  const nodes = [];
  const flows = [];
  const rows = new Map();
  function node(id, label, type, lane, column, row = 0, attributes = '') {
    const size = type.endsWith('Event') ? [36, 36] : type.endsWith('Gateway') ? [50, 50] : [120, 80];
    const box = { x: 100 + column * 180, y: lane * 220 + 25 + row * 100, width: size[0], height: size[1] };
    nodes.push({ id, label, type, lane, box, attributes });
    return id;
  }
  function link(source, target, id = `To_${target}`) {
    flows.push({ id, source, target });
    return target;
  }
  let previous = node('Start', '', 'startEvent', 0, 0);
  let column = 1;
  for (const [lane, [id, tasks]] of Object.entries(lanes).entries()) {
    rows.set(id, lane);
    for (const [index, label] of tasks.split('|').entries()) {
      previous = link(previous, node(`${id}_${index + 1}`, label, 'userTask', lane, column++));
      if (localEdit && lane === 2 && index === 5) {
        previous = link(previous, node('Audit', 'Record audit evidence', 'userTask', lane, column++));
      }
      if (lane !== 1 || index !== 2) continue;
      const split = link(previous, node('Split', 'Exception?', 'exclusiveGateway', lane, column++, undefined, ' default="Normal"'));
      const merge = node('Merge', '', 'exclusiveGateway', lane, column + 6);
      link(split, merge, 'Normal');
      let branch = split;
      for (const [step, label] of detour.split('|').entries()) {
        branch = link(branch, node(`Exception_${step + 1}`, label, 'task', lane, column + step, 1));
      }
      previous = link(branch, merge, 'ExceptionResolved');
      column += 7;
    }
  }
  link(previous, node('End', '', 'endEvent', rows.size - 1, column));
  const width = 300 + column * 180;
  const shape = (id, box, attributes = '') => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${attributes}>
    <dc:Bounds ${Object.entries(box).map(([key, value]) => `${key}="${value}"`).join(' ')} />
  </bpmndi:BPMNShape>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
 xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
 xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions" targetNamespace="https://example.org/bpmn">
 <bpmn:collaboration id="Collaboration"><bpmn:participant id="Pool" name="${name}" processRef="Process" /></bpmn:collaboration>
 <bpmn:process id="Process" isExecutable="false">
  <bpmn:laneSet id="Lanes">${[...rows].map(([id, lane]) => `<bpmn:lane id="${id}" name="${id}">
   ${nodes.filter((entry) => entry.lane === lane).map((entry) => `<bpmn:flowNodeRef>${entry.id}</bpmn:flowNodeRef>`).join('')}
  </bpmn:lane>`).join('')}</bpmn:laneSet>
  ${nodes.map(({ id, type, label, attributes }) => `<bpmn:${type} id="${id}" name="${label}"${attributes} />`).join('')}
  ${flows.map(({ id, source, target }) => `<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`).join('')}
 </bpmn:process>
 <bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collaboration">
  ${shape('Pool', { x: 0, y: 0, width, height: rows.size * 220 }, ' isHorizontal="true"')}
  ${[...rows].map(([id, lane]) => shape(id, { x: 30, y: lane * 220, width: width - 30, height: 220 }, ' isHorizontal="true"')).join('')}
  ${nodes.map(({ id, box }) => shape(id, box)).join('')}
  ${flows.map(({ id, source, target }) => {
    const a = nodes.find((node) => node.id === source).box;
    const b = nodes.find((node) => node.id === target).box;
    return `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">
      <di:waypoint x="${a.x + a.width}" y="${a.y + a.height / 2}" />
      <di:waypoint x="${b.x}" y="${b.y + b.height / 2}" />
    </bpmndi:BPMNEdge>`;
  }).join('')}
 </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
