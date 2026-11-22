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
