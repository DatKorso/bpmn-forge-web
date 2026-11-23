import { BpmnModdle } from 'bpmn-moddle';
import { readFile } from 'node:fs/promises';
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

export const mixedBenchmarkProfiles = {
  'mixed-y': [true, false, true, false],
  'mixed-x': [true, false, false, false]
};

export const compactBenchmarkProfiles = ['compact-y', 'compact-x'];

export async function compactBenchmarkXml(axis) {
  const xml = await readFile(new URL('../test/fixtures/graph-layout/mixed-collaboration.bpmn', import.meta.url), 'utf8');
  return axis === 'x' ? xml.replace('bpmnElement="Carrier" isHorizontal="true"',
    'bpmnElement="Carrier" isHorizontal="false"') : xml;
}

export async function collaborationBenchmarkXml({ lateRefusal = false, orientations, size = 50 } = {}) {
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

  function edge(type, id, sourceRef, targetRef, vertical = false) {
    const model = create(type, { id, sourceRef, targetRef });
    const from = positions.get(sourceRef);
    const to = positions.get(targetRef);
    planeElement.push(create('bpmndi:BPMNEdge', {
      id: `${id}_di`, bpmnElement: model, waypoint: [
        create('dc:Point', vertical ? { x: from.x + from.width / 2, y: from.y + from.height } :
          { x: from.x + from.width, y: from.y + from.height / 2 }),
        create('dc:Point', vertical ? { x: to.x + to.width / 2, y: to.y } :
          { x: to.x, y: to.y + to.height / 2 })
      ]
    }));
    return model;
  }

  const poolNodes = [];
  const nestedEnds = [];
  const extent = 8_050 - 160 * (50 - size);
  const rowX = orientations?.filter((horizontal) => !horizontal).length > 2;
  let offset = 0;
  for (let pool = 0; pool < 4; pool++) {
    const horizontal = orientations?.[pool] ?? true;
    const x = rowX ? offset : 0;
    const y = rowX ? 0 : offset;
    const frame = horizontal ? { x, y, width: extent, height: 420 } : { x, y, width: 420, height: extent };
    offset += (rowX ? frame.width : frame.height) + 100;
    const position = (box, transposeSize = false) => horizontal ? { ...box, x: x + box.x, y: y + box.y } : {
      x: x + box.y, y: y + box.x,
      width: transposeSize ? box.height : box.width, height: transposeSize ? box.width : box.height
    };
    const { figures, edges } = generatedProcess(size - 3, 42, false, 8);
    const nodes = new Map(figures.map(({ id, type, box }) => [
      id, shape(create(type, { id: `P${pool}_${id}` }), position(box))
    ]));
    const members = [...nodes.values()];
    poolNodes.push(members);
    const nestedNodes = ['First', 'Second'].map((name, index) => shape(
      create('bpmn:Task', { id: `Nested_${pool}_${name}` }),
      position({ x: extent - 350 + 160 * index, y: 95, width: 100, height: 70 })
    ));
    nestedEnds.push(nestedNodes[1]);
    const subProcess = shape(create('bpmn:SubProcess', {
      id: `Nested_${pool}`,
      flowElements: [...nestedNodes, edge('bpmn:SequenceFlow', `Inner_${pool}`, ...nestedNodes, !horizontal)]
    }), position({ x: extent - 390, y: 55, width: 340, height: 160 }, true), { isExpanded: true });
    const flows = edges.map(({ id, source, target }) => edge(
      'bpmn:SequenceFlow', `P${pool}_${id}`, nodes.get(source.id), nodes.get(target.id), !horizontal
    ));
    flows.push(edge('bpmn:SequenceFlow', `Enter_${pool}`, members.at(-1), subProcess, !horizontal));

    const artifacts = [4, 34].map((index) => Math.round(index * (size - 4) / 46)).flatMap((index, note) => {
      const id = `Note_${pool}_${note}`;
      const anchor = members[index];
      const bounds = positions.get(anchor);
      const annotation = shape(create('bpmn:TextAnnotation', { id, text: 'Note' }), {
        x: bounds.x + (horizontal ? 12 : -54), y: bounds.y + (horizontal ? -48 : 12),
        width: lateRefusal && pool === 3 && note === 1 ? 100_000 : 46, height: 24
      });
      return [annotation, edge('bpmn:Association', `Link_${pool}_${note}`, anchor, annotation)];
    });
    const process = create('bpmn:Process', {
      id: `Process_${pool}`, flowElements: [...nodes.values(), subProcess, ...flows], artifacts
    });
    processes.push(process);
    participants.push(shape(create('bpmn:Participant', { id: `Pool_${pool}`, processRef: process }),
      frame, { isHorizontal: horizontal }));
  }

  for (let pool = 0; pool < 3; pool++) {
    for (const [rank, original] of [1, 6, 11, 16, 21, 26, 31].entries()) {
      const index = rank + Math.floor((original - rank) * (size - 10) / 40);
      messageFlows.push(edge('bpmn:MessageFlow', `Message_${pool}_${original}`,
        poolNodes[pool][index], poolNodes[pool + 1][index], !rowX && Boolean(orientations)));
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
