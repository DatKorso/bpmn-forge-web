import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

export const preview = (page) => page.getByRole('dialog', { name: 'Предпросмотр выравнивания' });
export const applyPreview = (page) => preview(page).getByRole('button', { name: 'Применить', exact: true }).click();

export async function openDiagram(page, path, filename) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#open').click()
  ]);
  await chooser.setFiles(path);
  await expect(page.locator('#document-name')).toHaveAttribute('title', filename);
  await expect(page.locator('#status')).toHaveText('Файл открыт.');
}

export async function downloadDiagram(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать BPMN' }).click()
  ]);
  return download;
}

export async function readDiagram(page, download) {
  const xml = await readFile(await download.path(), 'utf8');
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    const error = doc.querySelector('parsererror');
    if (error) throw new Error(error.textContent);

    const model = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
    const bpmnDi = 'http://www.omg.org/spec/BPMN/20100524/DI';
    const dc = 'http://www.omg.org/spec/DD/20100524/DC';
    const di = 'http://www.omg.org/spec/DD/20100524/DI';
    const elements = (parent, namespace, name) => [...parent.getElementsByTagNameNS(namespace, name)];
    const byId = (entries, attribute, value) => Object.fromEntries(entries.map((entry) =>
      [entry.getAttribute(attribute), value(entry)]));
    const numbers = (element, names) => Object.fromEntries(names.map((name) => {
      const value = element.getAttribute(name);
      if (value === null || !Number.isFinite(Number(value))) throw new Error(`Invalid BPMN coordinate ${name}`);
      return [name, Number(value)];
    }));
    const bounds = (element) => numbers(element, ['x', 'y', 'width', 'height']);

    const shapes = byId(elements(doc, bpmnDi, 'BPMNShape'), 'bpmnElement', (shape) => bounds(
      [...shape.children].find(({ namespaceURI, localName }) => namespaceURI === dc && localName === 'Bounds')
    ));
    const labels = Object.fromEntries(elements(doc, bpmnDi, 'BPMNLabel').map((label) =>
      [label.parentElement.getAttribute('bpmnElement'), bounds(elements(label, dc, 'Bounds')[0])]));
    const routes = byId(elements(doc, bpmnDi, 'BPMNEdge'), 'bpmnElement', (edge) =>
      elements(edge, di, 'waypoint').map((point) => numbers(point, ['x', 'y'])));
    const lanes = byId(elements(doc, model, 'lane'), 'id', (lane) =>
      elements(lane, model, 'flowNodeRef').map(({ textContent }) => textContent.trim()).sort());
    const connections = (name) => byId(elements(doc, model, name), 'id', (flow) => ({
      sourceRef: flow.getAttribute('sourceRef'),
      targetRef: flow.getAttribute('targetRef')
    }));

    const timers = byId(elements(doc, model, 'boundaryEvent'), 'id', (event) => ({
      attachedTo: event.getAttribute('attachedToRef'),
      duration: elements(event, model, 'timeDuration')[0]?.textContent.trim() ?? null
    }));
    return { shapes, labels, routes, lanes, timers, flows: connections('sequenceFlow'), messages: connections('messageFlow') };
  }, xml);
}
