const tooltip = document.getElementById('tool-tooltip');
const gapToggle = document.getElementById('toggle-gaps');
const gapSettings = document.getElementById('gap-settings');
let hoveredTool;
let focusedTool;

export function updateToolTooltip() {
  const button = hoveredTool ?? focusedTool;
  tooltip.hidden = !button;
  if (!button) return;

  const description = document.getElementById(button.getAttribute('aria-describedby'));
  tooltip.textContent = [button.getAttribute('aria-label') ?? button.textContent.trim(), description?.textContent]
    .filter(Boolean).join('\n');

  const anchor = button.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const viewport = document.documentElement;
  const edge = 8;
  const offset = 4;
  const center = anchor.left + (anchor.width - width) / 2;
  const below = anchor.bottom + offset;
  const above = anchor.top - height - offset;
  const preferAbove = below + height > viewport.clientHeight - edge ||
    (button === gapToggle && !gapSettings.hidden);

  tooltip.style.left = `${Math.max(edge, Math.min(center, viewport.clientWidth - width - edge))}px`;
  tooltip.style.top = `${preferAbove && above >= edge ? above : below}px`;
}

function dismissToolTooltip() {
  hoveredTool = focusedTool = undefined;
  updateToolTooltip();
}

for (const tool of document.querySelectorAll('.tool')) {
  const button = tool.querySelector('button');

  tool.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    hoveredTool = button;
    updateToolTooltip();
  });
  tool.addEventListener('pointerleave', () => {
    if (hoveredTool === button) hoveredTool = undefined;
    updateToolTooltip();
  });
  button.addEventListener('focus', () => {
    if (button.matches(':focus-visible')) {
      hoveredTool = undefined;
      focusedTool = button;
    }
    updateToolTooltip();
  });
  button.addEventListener('blur', () => {
    if (focusedTool === button) focusedTool = undefined;
    updateToolTooltip();
  });
}

window.addEventListener('resize', updateToolTooltip);
window.addEventListener('scroll', updateToolTooltip);

function showGapSettings(visible) {
  gapSettings.hidden = !visible;
  gapToggle.setAttribute('aria-expanded', String(visible));
  updateToolTooltip();
}

gapToggle.addEventListener('click', () => showGapSettings(gapSettings.hidden));

document.addEventListener('focusin', (event) => {
  if (!gapSettings.hidden && event.target !== gapToggle && !gapSettings.contains(event.target)) showGapSettings(false);
});

document.addEventListener('click', (event) => {
  if (gapSettings.hidden || gapSettings.contains(event.target) || gapToggle.contains(event.target)) return;
  if (gapSettings.contains(document.activeElement)) gapToggle.focus();
  showGapSettings(false);
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!gapSettings.hidden) {
    event.preventDefault();
    event.stopPropagation();
    gapToggle.focus();
    showGapSettings(false);
  }
  dismissToolTooltip();
}, true);

export function reportGapValidity() {
  const invalid = gapSettings.querySelector('input:invalid');
  if (!invalid) return true;
  dismissToolTooltip();
  showGapSettings(true);
  invalid.focus();
  return false;
}

const alignmentPreview = document.getElementById('alignment-preview');
const previewSummary = document.getElementById('alignment-preview-summary');

export function confirmAlignment({ moved, resized, rerouted, movedLabels, skipped }) {
  const counts = [`Переместится фигур: ${moved}.`, `Изменится размер контейнеров: ${resized}.`];
  if (rerouted) counts.push(`Обновится связей: ${rerouted}.`);
  if (movedLabels) counts.push(`Переместится подписей: ${movedLabels}.`);
  if (skipped?.length) counts.push(`Будет пропущено участков: ${skipped.length}.`);
  previewSummary.textContent = counts.join(' ');
  alignmentPreview.returnValue = 'cancel';
  alignmentPreview.showModal();
  return new Promise((resolve) => {
    alignmentPreview.addEventListener('close', () => resolve(alignmentPreview.returnValue === 'apply'), { once: true });
  });
}
