export function nestedLaneVariant(xml, { vertical = false, collaboration = true, reverseDi = false } = {}) {
  if (!collaboration) {
    xml = xml.replace(/    <bpmn:participant id="Receiver".*\n|    <bpmn:messageFlow.*\n/g, '')
      .replace(/  <bpmn:process id="ReceiverProcess">[\s\S]*?<\/bpmn:process>\n/, '')
      .replace(/      <bpmndi:BPMN(Shape|Edge) id="(?:Receiver|Receive|Delivery)_di"[\s\S]*?<\/bpmndi:BPMN\1>\n/g, '');
  }
  if (vertical) {
    xml = xml.replace(/(<bpmndi:BPMNShape id="(?:Pool|Receiver|Operations|Preparation|Desk|Empty|Dispatch|Completion)_di"[^>]*)(>)/g,
      '$1 isHorizontal="false"$2')
      .replace(/x="([^"]+)" y="([^"]+)"/g, 'x="$2" y="$1"')
      .replace(/width="([^"]+)" height="([^"]+)"/g, 'width="$2" height="$1"');
  }
  if (reverseDi) {
    xml = xml.replace(/(<bpmndi:BPMNPlane[^>]*>)([\s\S]*?)(<\/bpmndi:BPMNPlane>)/, (_, open, content, close) =>
      open + content.match(/\s*<bpmndi:BPMN(Shape|Edge)\b[\s\S]*?<\/bpmndi:BPMN\1>/g).reverse().join('') + '\n    ' + close);
  }
  return xml;
}
