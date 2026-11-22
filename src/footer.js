const byId = (id) => document.getElementById(id);
const messages = byId('messages');
const messageButton = byId('show-messages');
const unreadIndicator = byId('unread-messages');
const status = byId('status');
const alignmentStatus = byId('alignment-status');
const alignmentSummary = byId('alignment-summary');
const alignmentDetails = byId('alignment-details');
const alignmentResult = byId('alignment-result');
const alignmentSkips = byId('alignment-skips');
const initialAlignment = alignmentResult.textContent;

function setUnread(unread) {
  unreadIndicator.hidden = !unread;
  if (unread) messageButton.setAttribute('aria-describedby', 'unread-description');
  else messageButton.removeAttribute('aria-describedby');
}

function connectDialog(dialog, ...buttons) {
  for (const button of buttons) {
    button.addEventListener('click', () => {
      button.focus();
      dialog.showModal();
      if (dialog === messages) setUnread(false);
    });
  }
  dialog.addEventListener('close', () => {
    if (document.activeElement === document.body) buttons[0].focus();
  });
}

connectDialog(messages, messageButton, alignmentDetails);
connectDialog(byId('changelog'), byId('show-changelog'));

function announce(message, attention) {
  status.replaceChildren(message);
  if (attention && !messages.open) setUnread(true);
}

export function reportOperation(message, error = false) {
  const operation = byId('operation-message');
  operation.textContent = message;
  operation.classList.toggle('error', error);
  announce(message, error);
}

export function reportAlignment({
  moved = 0, resized = 0, rerouted = 0, movedPools = 0, reroutedMessages = 0, movedLabels = 0, skipped = [], reason
}) {
  const severity = reason ? 'error' : skipped.length ? 'warning' : '';
  const movedShapes = moved - movedPools;
  const reroutedOrdinary = rerouted - reroutedMessages;
  const changes = [
    ['Пулы', movedPools],
    ['Потоки сообщений', reroutedMessages],
    ['Фигуры', movedShapes],
    ['Контейнеры', resized],
    ['Связи', reroutedOrdinary],
    ['Подписи', movedLabels]
  ].filter(([, count]) => count > 0).map(([label, count]) => `${label}: ${count}`);

  const warning = skipped.length ? `Предупреждение: пропущено участков — ${skipped.length}` : '';
  const summary = reason ? `Ошибка: ${reason}` :
    [warning, ...changes].filter(Boolean).join(' · ') || 'Изменений нет';
  const counts = `Перемещено фигур: ${movedShapes}. Расширено контейнеров: ${resized}. Обновлено обычных связей: ${reroutedOrdinary}. ` +
    `Перемещено пулов: ${movedPools}. Перестроено потоков сообщений: ${reroutedMessages}. ` +
    `Перемещено подписей: ${movedLabels}. Пропущено участков: ${skipped.length}.`;
  alignmentResult.textContent = reason ? summary : skipped.length ? `Предупреждение. ${counts}` : counts;
  alignmentResult.dataset.severity = severity;
  alignmentSkips.replaceChildren(...skipped.map(({ name, reason }) => {
    const item = document.createElement('li');
    item.textContent = `${name} — ${reason}.`;
    return item;
  }));
  alignmentSkips.hidden = !skipped.length;

  alignmentStatus.dataset.severity = severity;
  alignmentSummary.textContent = summary;
  alignmentSummary.title = summary;
  alignmentStatus.hidden = false;
  announce(summary, Boolean(severity));
}

export function clearAlignmentStatus() {
  if (alignmentStatus.hidden) return;
  if (alignmentStatus.contains(document.activeElement)) messageButton.focus();
  alignmentStatus.hidden = true;
  if (status.textContent === alignmentSummary.textContent) status.replaceChildren();
}

byId('dismiss-alignment').addEventListener('click', clearAlignmentStatus);

export function resetAlignment() {
  clearAlignmentStatus();
  alignmentResult.textContent = initialAlignment;
  delete alignmentResult.dataset.severity;
  alignmentSkips.replaceChildren();
  alignmentSkips.hidden = true;
}

const { version, commits, repositoryUrl, historyUrl } = __BUILD_METADATA__;
const versionLink = byId('version');
versionLink.href = repositoryUrl;
versionLink.textContent = version;
if (commits.length) {
  const dateFormat = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeZone: 'UTC' });
  const list = byId('commit-list');
  for (const { title, date, url } of commits) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = title || 'Коммит без заголовка';

    const time = document.createElement('time');
    time.dateTime = date;
    time.textContent = dateFormat.format(new Date(date));

    const item = document.createElement('li');
    item.append(link, time);
    list.append(item);
  }
  list.hidden = false;
  const fullHistory = byId('full-history');
  fullHistory.href = historyUrl;
  fullHistory.hidden = false;
} else {
  byId('history-unavailable').hidden = false;
}
