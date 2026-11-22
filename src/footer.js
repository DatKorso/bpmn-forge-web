const byId = (id) => document.getElementById(id);
const messages = byId('messages');
const messageButton = byId('show-messages');
const unreadIndicator = byId('unread-messages');
const status = byId('status');
const alignmentStatus = byId('alignment-status');
const alignmentProgress = byId('alignment-progress');
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

const operationErrors = byId('operation-errors');
const errors = new Map();

export function reportOperation(message, operation) {
  const previous = errors.get(operation);
  previous?.alert.remove();
  previous?.entry.remove();
  errors.delete(operation);
  operationErrors.hidden = !errors.size;
  byId('operation-message').textContent = message;
  announce(message);
}

export function reportOperationError(operation, message) {
  reportOperation('', operation);
  const entry = document.createElement('li');
  entry.className = 'error';
  entry.textContent = message;
  operationErrors.append(entry);
  operationErrors.hidden = false;

  const alert = document.createElement('div');
  alert.className = 'operation-alert';
  const text = document.createElement('span');
  text.setAttribute('role', 'alert');
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Закрыть';
  dismiss.setAttribute('aria-label', `Закрыть сообщение «${message}»`);
  dismiss.addEventListener('click', () => {
    byId(({ export: 'download', import: 'open', new: 'new' })[operation]).focus();
    alert.remove();
  });
  alert.append(text, dismiss);
  byId('operation-alerts').append(alert);
  text.textContent = message;
  errors.set(operation, { alert, entry });
  if (!messages.open) setUnread(true);
}

export function setAlignmentPending(pending) {
  alignmentProgress.hidden = !pending;
  alignmentStatus.classList.toggle('alignment-pending', pending);
  if (pending) announce(alignmentProgress.textContent);
  else if (status.textContent === alignmentProgress.textContent) status.replaceChildren();
}

export function reportAlignment({
  moved = 0, resized = 0, rerouted = 0, movedPools = 0, reroutedMessages = 0, movedLabels = 0, skipped = [], reason
}, revealRegion) {
  const severity = reason ? 'error' : skipped.length ? 'warning' : '';
  const movedShapes = moved - movedPools;
  const reroutedOrdinary = rerouted - reroutedMessages;
  const changed = moved || resized || rerouted || movedLabels;
  const summary = reason ? 'Не удалось выровнять' :
    skipped.length ? 'Выравнивание с пропусками' : changed ? 'Выравнивание выполнено' : 'Изменений нет';
  const counts = `Перемещено фигур: ${movedShapes}. Контейнеров с изменённым размером: ${resized}. Обновлено обычных связей: ${reroutedOrdinary}. ` +
    `Перемещено пулов: ${movedPools}. Перестроено потоков сообщений: ${reroutedMessages}. ` +
    `Перемещено подписей: ${movedLabels}. Пропущено участков: ${skipped.length}.`;
  alignmentResult.textContent = reason ?? counts;
  alignmentResult.dataset.severity = severity;
  alignmentSkips.replaceChildren(...skipped.map(({ name, reason, hint, scope }) => {
    const item = document.createElement('li');
    const text = document.createElement('p');
    text.textContent = `${name} — ${reason}. ${hint}`;
    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.textContent = 'Показать на схеме';
    reveal.setAttribute('aria-label', `Показать на схеме: ${name}`);
    reveal.addEventListener('click', () => {
      messages.close();
      revealRegion(scope);
    });
    item.append(text, reveal);
    return item;
  }));
  alignmentSkips.hidden = !skipped.length;

  alignmentStatus.dataset.severity = severity;
  alignmentSummary.textContent = summary;
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
