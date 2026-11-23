import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inspectCollaboration, unsupportedGraph } from '../src/graph-layout/support.js';
import { readDiagram, readFixture } from './helpers/read-fixture.js';

const collaboration = await readFile(new URL('./fixtures/collaboration.bpmn', import.meta.url), 'utf8');
const removeDi = (xml, id) => xml.replace(new RegExp(
  `<bpmndi:BPMN(Shape|Edge) id="${id}_di"[^>]*>[\\s\\S]*?<\\/bpmndi:BPMN\\1>`
), '');
const edgeDi = (id) => `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">
  <di:waypoint x="220" y="140" /><di:waypoint x="270" y="400" />
</bpmndi:BPMNEdge>`;

function expectFailure(diagram, reason, id) {
  const issue = inspectCollaboration(diagram);
  assert.equal(issue?.reason, reason);
  assert.equal(issue.elementId, id);
}

test('reads the active semantic inventory independently of DI and snapshot array order', async () => {
  const diagram = await readFixture('order-fulfilment.bpmn');
  const inspected = inspectCollaboration(diagram);
  const reversed = inspectCollaboration({
    ...diagram,
    figures: diagram.figures.toReversed(),
    edges: diagram.edges.toReversed(),
    diElements: diagram.diElements.toReversed(),
    messageFlows: diagram.messageFlows.toReversed(),
    auxiliary: diagram.auxiliary.toReversed()
  });
  assert.equal(inspected.extended, true);
  assert.deepEqual(reversed, inspected);
  assert.deepEqual(inspected.pools.map(({ id }) => id), ['Sales', 'Warehouse', 'Carrier']);
  assert.deepEqual(inspected.messages.map(({ id }) => id), ['Order', 'Pickup', 'Tracking']);
  assert.equal(inspected.owner.get(diagram.figures.find(({ id }) => id === 'Confirm')).id, 'Warehouse');
});

test('refuses missing or truncated message DI and inconsistent visible endpoints', async () => {
  expectFailure(await readDiagram(removeDi(collaboration, 'Delivery')), 'graphIncomplete', 'Delivery');
  const incomplete = collaboration.replace(
    /(<bpmndi:BPMNEdge id="Delivery_di"[^>]*>\s*<di:waypoint[^>]*\/>)[\s\S]*?(<\/bpmndi:BPMNEdge>)/,
    '$1$2'
  );
  expectFailure(await readDiagram(incomplete), 'graphIncomplete', 'Delivery');

  const unresolved = await readFixture('collaboration.bpmn');
  unresolved.messageFlows.length = 0;
  expectFailure(unresolved, 'graphIncomplete', 'Delivery');

  const wrongPort = collaboration.replace(
    '<bpmndi:BPMNEdge id="Delivery_di"',
    '<bpmndi:BPMNEdge sourceElement="Prepare_di" id="Delivery_di"'
  );
  expectFailure(await readDiagram(wrongPort), 'graphIncomplete', 'Delivery');

  const wrongElement = await readFixture('collaboration.bpmn');
  wrongElement.messageFlows[0].source = wrongElement.figures.find(({ id }) => id === 'Prepare');
  expectFailure(wrongElement, 'graphIncomplete', 'Delivery');
});

test('excludes a message to a wholly undrawn participant but refuses orphan DI', async () => {
  expectFailure(await readDiagram(removeDi(collaboration, 'Receiver')), 'graphIncomplete', 'Receive');
  const absent = ['Receiver', 'Receive', 'End', 'Received', 'Delivery'].reduce(removeDi, collaboration);
  const diagram = await readDiagram(absent);
  const inspected = inspectCollaboration(diagram);
  assert.equal(inspected.extended, false);
  assert.deepEqual(inspected.pools.map(({ id }) => id), ['Sender']);
  assert.deepEqual(inspected.messages, []);
  assert.deepEqual(inspected.diagnostics, [{ kind: 'excludedMessage', elementId: 'Delivery', reason: 'hiddenEndpoint' }]);
  assert.equal(diagram.root.model.messageFlows[0].targetRef.id, 'Receive');

  const strayEdge = absent.replace('</bpmndi:BPMNPlane>', `${edgeDi('Delivery')}</bpmndi:BPMNPlane>`);
  expectFailure(await readDiagram(strayEdge), 'graphIncomplete', 'Delivery');
  const empty = collaboration.replace(/(<bpmndi:BPMNPlane[^>]*>)[\s\S]*?(<\/bpmndi:BPMNPlane>)/, '$1$2');
  expectFailure(await readDiagram(empty), 'graphNoPools', 'Sender');
});

test('refuses stray process DI on a collaboration without participant models', async () => {
  const stray = ['Sender', 'Receiver', 'Delivery'].reduce(removeDi, collaboration)
    .replace(/\s*<bpmn:(?:participant|messageFlow)[^>]*\/>/g, '');
  const diagram = await readDiagram(stray);
  diagram.figures.length = 0; // The importer can skip DI for an unreferenced process.
  expectFailure(diagram, 'graphOwnership', 'Prepare');
});

test('stops at a collapsed subprocess and checks its artifacts only on its own plane', async () => {
  const collapsed = collaboration
    .replace('<bpmn:sendTask id="Send" />',
      '<bpmn:subProcess id="Sub"><bpmn:sendTask id="Send" /><bpmn:group id="InnerGroup" /></bpmn:subProcess>')
    .replace('sourceRef="Prepare" targetRef="Send"', 'sourceRef="Prepare" targetRef="Sub"')
    .replace('id="Send_di" bpmnElement="Send"', 'id="Sub_di" bpmnElement="Sub"')
    .replace('</bpmn:definitions>', `
      <bpmndi:BPMNDiagram id="InnerDiagram"><bpmndi:BPMNPlane id="InnerPlane" bpmnElement="Sub">
        <bpmndi:BPMNShape id="Send_inner" bpmnElement="Send"><dc:Bounds x="0" y="0" width="100" height="80" /></bpmndi:BPMNShape>
      </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`);

  expectFailure(await readDiagram(collapsed), 'graphIncomplete', 'Delivery');
  const noEdge = removeDi(collapsed, 'Delivery');
  const outer = await readDiagram(noEdge);
  assert.equal(unsupportedGraph(outer), undefined);
  assert.deepEqual(inspectCollaboration(outer).diagnostics.map(({ elementId }) => elementId), ['Delivery']);
  const inner = await readDiagram(noEdge, 'InnerPlane');
  assert.equal(inspectCollaboration(inner), undefined);
  assert.equal(unsupportedGraph(inner).elementId, 'InnerGroup');
});

test('checks rendered shapes, sequence edges and ownership in an expanded collaboration', async () => {
  expectFailure(await readDiagram(removeDi(collaboration, 'Prepare')), 'graphIncomplete', 'Prepare');
  expectFailure(await readDiagram(removeDi(collaboration, 'Received')), 'graphIncomplete', 'Received');
  const mixed = collaboration.replace('bpmnElement="Receiver" isHorizontal="true"', 'bpmnElement="Receiver" isHorizontal="false"');
  expectFailure(await readDiagram(mixed), 'graphMixedOrientation', 'Receiver');
  const duplicate = collaboration.replace('processRef="ReceiverProcess"', 'processRef="Process"');
  expectFailure(await readDiagram(duplicate), 'graphOwnership', 'Receiver');

  const wrongParent = await readFixture('collaboration.bpmn');
  wrongParent.figures.find(({ id }) => id === 'Receive').parent = wrongParent.root;
  expectFailure(wrongParent, 'graphOwnership', 'Receive');

  const badLane = collaboration.replace('<bpmn:task id="Prepare" />', `
    <bpmn:laneSet id="LaneSet">
      <bpmn:lane id="First"><bpmn:flowNodeRef>Prepare</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Second"><bpmn:flowNodeRef>Prepare</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet><bpmn:task id="Prepare" />
  `).replace('</bpmndi:BPMNPlane>', ['First', 'Second'].map((id) => `
    <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" isHorizontal="true">
      <dc:Bounds x="80" y="45" width="450" height="100" />
    </bpmndi:BPMNShape>`
  ).join('') + '</bpmndi:BPMNPlane>');
  expectFailure(await readDiagram(badLane), 'graphOwnership', 'Prepare');
});

test('accepts a message to a receiving boundary event and refuses invalid message endpoints', async () => {
  const withBoundary = collaboration.replace('<bpmn:endEvent id="End" />', `
    <bpmn:boundaryEvent id="End" attachedToRef="Receive"><bpmn:messageEventDefinition /></bpmn:boundaryEvent>
  `).replace('sourceRef="Send" targetRef="Receive"', 'sourceRef="Send" targetRef="End"')
    .replace('<bpmn:sequenceFlow id="Received" sourceRef="Receive" targetRef="End" />', '');
  const accepted = await readDiagram(removeDi(withBoundary, 'Received'));
  assert.equal(inspectCollaboration(accepted).messages[0].target.id, 'End');

  const badEvent = collaboration.replace('sourceRef="Send" targetRef="Receive"', 'sourceRef="Send" targetRef="End"');
  expectFailure(await readDiagram(badEvent), 'graphMessageEndpoint', 'Delivery');
  const samePool = collaboration.replace('sourceRef="Send" targetRef="Receive"', 'sourceRef="Send" targetRef="Prepare"');
  expectFailure(await readDiagram(samePool), 'graphMessageEndpoint', 'Delivery');
  const signal = collaboration.replace('<bpmn:sendTask id="Send" />',
    '<bpmn:intermediateThrowEvent id="Send"><bpmn:signalEventDefinition /></bpmn:intermediateThrowEvent>');
  expectFailure(await readDiagram(signal), 'graphMessageEndpoint', 'Delivery');
  const message = signal.replace('signalEventDefinition', 'messageEventDefinition');
  assert.equal(inspectCollaboration(await readDiagram(message)).messages[0].source.id, 'Send');
  const compensation = collaboration.replace('<bpmn:receiveTask id="Receive" />',
    '<bpmn:receiveTask id="Receive" isForCompensation="true" />');
  expectFailure(await readDiagram(compensation), 'graphMessageEndpoint', 'Delivery');
});

test('checks visible data scope and rejects an association with an edge endpoint', async () => {
  const data = collaboration.replace('<bpmn:sendTask id="Send" />', `
    <bpmn:sendTask id="Send"><bpmn:dataOutputAssociation id="Data">
      <bpmn:targetRef>Store</bpmn:targetRef>
    </bpmn:dataOutputAssociation></bpmn:sendTask>
  `).replace('</bpmndi:BPMNPlane>', `
    ${edgeDi('Data')}
    <bpmndi:BPMNShape id="Store_di" bpmnElement="Store"><dc:Bounds x="130" y="225" width="40" height="40" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  `);
  const store = '<bpmn:dataStoreReference id="Store" />';
  const local = await readDiagram(data.replace('<bpmn:task id="Prepare" />', store + '<bpmn:task id="Prepare" />'));
  assert.deepEqual(inspectCollaboration(local).auxiliary.map(({ id }) => id), ['Data']);
  const crossPool = data.replace('<bpmn:receiveTask id="Receive" />', store + '<bpmn:receiveTask id="Receive" />');
  expectFailure(await readDiagram(crossPool), 'graphDataScope', 'Data');
  expectFailure(await readDiagram(removeDi(crossPool, 'Data')), 'graphDataScope', 'Data');
  const hidden = ['Receiver', 'Receive', 'End', 'Received', 'Delivery', 'Store'].reduce(removeDi, crossPool);
  expectFailure(await readDiagram(hidden), 'graphDataScope', 'Data');
  const semanticOnly = inspectCollaboration(await readDiagram(removeDi(hidden, 'Data')));
  assert.equal(semanticOnly.reason, undefined);
  assert.deepEqual(semanticOnly.auxiliary, []);

  const association = collaboration
    .replace('</bpmn:collaboration>', '<bpmn:association id="Link" sourceRef="Prepare" targetRef="Delivery" /></bpmn:collaboration>')
    .replace('</bpmndi:BPMNPlane>', edgeDi('Link') + '</bpmndi:BPMNPlane>');
  expectFailure(await readDiagram(association), 'graphAssociationEndpoint', 'Link');
});
