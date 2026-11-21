const byId = (id) => document.getElementById(id);
const messages = byId('messages');
const messageButton = byId('show-messages');
const unreadIndicator = byId('unread-messages');
const status = byId('status');
const alignmentResult = byId('alignment-result');
const alignmentSkips = byId('alignment-skips');
const initialAlignment = alignmentResult.textContent;

function setUnread(unread) {
  unreadIndicator.hidden = !unread;
  if (unread) messageButton.setAttribute('aria-describedby', 'unread-description');
  else messageButton.removeAttribute('aria-describedby');
}

for (const dialog of [messages, byId('changelog')]) {
  const button = byId(`show-${dialog.id}`);
  button.addEventListener('click', () => {
    dialog.showModal();
    if (dialog === messages) setUnread(false);
  });
  dialog.addEventListener('close', () => button.focus());
}

function announce(message, attention) {
  status.textContent = message;
  if (attention && !messages.open) setUnread(true);
}

export function reportOperation(message, error = false) {
  const operation = byId('operation-message');
  operation.textContent = message;
  operation.classList.toggle('error', error);
  announce(message, error);
}

export function reportAlignment(message, skipped = [], error = false) {
  alignmentResult.textContent = message;
  alignmentResult.classList.toggle('error', error);
  const reasons = skipped.map(({ name, reason }) => `${name} — ${reason}.`);
  alignmentSkips.replaceChildren(...reasons.map((reason) => {
    const item = document.createElement('li');
    item.textContent = reason;
    return item;
  }));
  alignmentSkips.hidden = !reasons.length;
  announce([message, ...reasons].join(' '), error || reasons.length > 0);
}

export function resetAlignment() {
  alignmentResult.textContent = initialAlignment;
  alignmentResult.classList.remove('error');
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
