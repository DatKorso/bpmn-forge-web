import { expect, test } from '@playwright/test';
import { graphBenchmarkWorkload } from '../scripts/graph-benchmark-workload.js';
import { openDiagram, preview } from './helpers/diagram.js';

test('measures graph preview on the 200-node benchmark', async ({ page, browser }) => {
  test.skip(process.env.BPMN_GRAPH_BENCHMARK !== '1', 'Run on idle, fixed hardware.');
  test.setTimeout(120_000);
  const { diagram, xml } = graphBenchmarkWorkload();
  const filename = 'graph-benchmark.bpmn';
  await page.goto('/');
  await openDiagram(page, { name: filename, mimeType: 'application/xml', buffer: Buffer.from(await xml()) }, filename);
  await page.evaluate(() => {
    const dialog = document.querySelector('#alignment-preview');
    const button = document.querySelector('#align-graph');
    let start;
    let resolve;
    const tasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask' });
    button.addEventListener('click', () => {
      start = performance.now();
      window.previewTiming = new Promise((done) => { resolve = done; });
    }, { capture: true });
    new MutationObserver(() => {
      if (!dialog.open) return;
      const end = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        preview: Math.round(end - start),
        longestTask: Math.max(0, ...tasks.filter((task) => task.start < end && task.start + task.duration >= start)
          .map(({ duration }) => duration))
      })));
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  });
  const timings = [];
  for (let i = 0; i < 6; i++) {
    await page.locator('#align-graph').click();
    await expect(preview(page)).toBeVisible({ timeout: 15_000 });
    timings.push(await page.evaluate(() => window.previewTiming));
    await page.keyboard.press('Escape');
    await expect(preview(page)).toBeHidden();
  }
  const [cold, ...warm] = timings;
  console.log(JSON.stringify({
    chromium: browser.version(), nodes: diagram.figures.length, flows: diagram.edges.length,
    cold, warm, medianWarm: warm.map(({ preview }) => preview).sort((a, b) => a - b)[2],
    overThreshold: warm.filter(({ longestTask }) => longestTask >= 200).length
  }));
});
