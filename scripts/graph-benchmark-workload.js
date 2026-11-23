import { BpmnModdle } from 'bpmn-moddle';
import { generatedProcess } from './alignment-workload.js';

export function graphBenchmarkWorkload() {
  const moddle = new BpmnModdle();
  const diagram = generatedProcess(200, 42, false, 12);
  for (const figure of diagram.figures) figure.model = moddle.create(figure.type, { id: figure.id });
  for (const edge of diagram.edges) {
    edge.type = 'bpmn:SequenceFlow';
    edge.model = moddle.create(edge.type, { id: edge.id, sourceRef: edge.source.model, targetRef: edge.target.model });
  }
  diagram.root.model = moddle.create('bpmn:Process', {
    id: diagram.root.id,
    flowElements: [...diagram.figures, ...diagram.edges].map(({ model }) => model)
  });

  async function xml() {
    const shapes = diagram.figures.map(({ id, model, box }) => moddle.create('bpmndi:BPMNShape', {
      id: `${id}_di`, bpmnElement: model, bounds: moddle.create('dc:Bounds', box)
    }));
    const routes = diagram.edges.map(({ id, model, source, target }) => moddle.create('bpmndi:BPMNEdge', {
      id: `${id}_di`, bpmnElement: model, waypoint: [
        moddle.create('dc:Point', { x: source.box.x + source.box.width, y: source.box.y + source.box.height / 2 }),
        moddle.create('dc:Point', { x: target.box.x, y: target.box.y + target.box.height / 2 })
      ]
    }));
    const plane = moddle.create('bpmndi:BPMNPlane', {
      id: 'Plane', bpmnElement: diagram.root.model, planeElement: [...shapes, ...routes]
    });
    const definitions = moddle.create('bpmn:Definitions', {
      id: 'Definitions', targetNamespace: 'https://example.org/bpmn', rootElements: [diagram.root.model],
      diagrams: [moddle.create('bpmndi:BPMNDiagram', { id: 'Diagram', plane })]
    });
    return (await moddle.toXML(definitions)).xml;
  }

  return { diagram, xml };
}

export async function collaborationBenchmarkXml({ lateRefusal = false } = {}) {
  const moddle = new BpmnModdle();
  const create = (type, props) => moddle.create(type, props);
  const participants = [];
  const processes = [];
  const messageFlows = [];
  const planeElement = [];
  const positions = new Map();

  function shape(model, box, attributes = {}) {
    positions.set(model, box);
    planeElement.push(create('bpmndi:BPMNShape', {
      id: `${model.id}_di`, bpmnElement: model, bounds: create('dc:Bounds', box), ...attributes
    }));
    return model;
  }

  function edge(type, id, sourceRef, targetRef) {
    const model = create(type, { id, sourceRef, targetRef });
    const from = positions.get(sourceRef);
    const to = positions.get(targetRef);
    planeElement.push(create('bpmndi:BPMNEdge', {
      id: `${id}_di`, bpmnElement: model, waypoint: [
        create('dc:Point', { x: from.x + from.width, y: from.y + from.height / 2 }),
        create('dc:Point', { x: to.x, y: to.y + to.height / 2 })
      ]
    }));
    return model;
  }

  const poolNodes = [];
  const nestedEnds = [];
  for (let pool = 0; pool < 4; pool++) {
    const y = 520 * pool;
    const { figures, edges } = generatedProcess(47, 42, false, 8);
    const nodes = new Map(figures.map(({ id, type, box }) => [
      id, shape(create(type, { id: `P${pool}_${id}` }), { ...box, y: box.y + y })
    ]));
    const members = [...nodes.values()];
    poolNodes.push(members);
    const nestedNodes = ['First', 'Second'].map((name, index) => shape(
      create('bpmn:Task', { id: `Nested_${pool}_${name}` }),
      { x: 7_700 + 160 * index, y: y + 95, width: 100, height: 70 }
    ));
    nestedEnds.push(nestedNodes[1]);
    const subProcess = shape(create('bpmn:SubProcess', {
      id: `Nested_${pool}`,
      flowElements: [...nestedNodes, edge('bpmn:SequenceFlow', `Inner_${pool}`, ...nestedNodes)]
    }), { x: 7_660, y: y + 55, width: 340, height: 160 }, { isExpanded: true });
    const flows = edges.map(({ id, source, target }) => edge(
      'bpmn:SequenceFlow', `P${pool}_${id}`, nodes.get(source.id), nodes.get(target.id)
    ));
    flows.push(edge('bpmn:SequenceFlow', `Enter_${pool}`, members.at(-1), subProcess));

    const artifacts = [4, 34].flatMap((index, note) => {
      const id = `Note_${pool}_${note}`;
      const anchor = members[index];
      const bounds = positions.get(anchor);
      const annotation = shape(create('bpmn:TextAnnotation', { id, text: 'Note' }), {
        x: bounds.x + 12, y: bounds.y - 48, width: lateRefusal && pool === 3 && note === 1 ? 100_000 : 46, height: 24
      });
      return [annotation, edge('bpmn:Association', `Link_${pool}_${note}`, anchor, annotation)];
    });
    const process = create('bpmn:Process', {
      id: `Process_${pool}`, flowElements: [...nodes.values(), subProcess, ...flows], artifacts
    });
    processes.push(process);
    participants.push(shape(create('bpmn:Participant', { id: `Pool_${pool}`, processRef: process }),
      { x: 0, y, width: 8_050, height: 420 }, { isHorizontal: true }));
  }

  for (let pool = 0; pool < 3; pool++) {
    for (const index of [1, 6, 11, 16, 21, 26, 31]) {
      messageFlows.push(edge('bpmn:MessageFlow', `Message_${pool}_${index}`,
        poolNodes[pool][index], poolNodes[pool + 1][index]));
    }
    messageFlows.push(edge('bpmn:MessageFlow', `Message_${pool}_Nested`, nestedEnds[pool], nestedEnds[pool + 1]));
  }
  const collaboration = create('bpmn:Collaboration', { id: 'Collaboration', participants, messageFlows });
  const plane = create('bpmndi:BPMNPlane', { id: 'Plane', bpmnElement: collaboration, planeElement });
  const definitions = create('bpmn:Definitions', {
    id: 'Definitions', targetNamespace: 'https://example.org/bpmn', rootElements: [collaboration, ...processes],
    diagrams: [create('bpmndi:BPMNDiagram', { id: 'Diagram', plane })]
  });
  return (await moddle.toXML(definitions)).xml;
}
