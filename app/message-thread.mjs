// How a conversation is assembled, separated from how it is drawn.
//
// This exists because of one defect. The thread used to hold only whatever the
// last request returned, and every refresh replaced the list wholesale. A
// reader who pressed "Show earlier messages" and scrolled back through 245
// messages lost 45 of them the instant anybody sent anything: the list snapped
// to the newest page, the scroll offset stayed where it was, and the text under
// it became different messages without a flicker to say so.
//
// Merging by id fixes it, and the rule is worth stating plainly: a refresh may
// only ever add to the thread. Nothing a refresh learns can remove a message
// the reader has already been shown.
//
// Loaded as a module by index.html and published on window, because app.js and
// messages.js are classic scripts and cannot import. The unit tests import it
// directly.

// Two messages in a row from the same person, close together in time, read as
// one turn in the conversation and do not repeat the name.
const SAME_RUN_MS = 5 * 60 * 1000;

const messageTime = item => {
  const parsed = Date.parse(item?.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Oldest first, which is reading order. Ties break on id so the order is total
// and therefore stable: two messages sent in the same millisecond must not swap
// places between renders.
function compareMessages(a, b) {
  return messageTime(a) - messageTime(b) || String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

// Returns how many were new. An id already present is left untouched rather
// than overwritten, so a half-populated row from one endpoint cannot replace a
// complete one from another.
function mergeInto(byId, incoming) {
  let added = 0;
  for (const item of Array.isArray(incoming) ? incoming : []) {
    if (!item || item.id == null || byId.has(item.id)) continue;
    byId.set(item.id, item);
    added += 1;
  }
  return added;
}

function inOrder(byId) {
  return [...byId.values()].sort(compareMessages);
}

function isSameRun(item, previous) {
  if (!item || !previous) return false;
  if (previous.sender_id !== item.sender_id) return false;
  const gap = messageTime(item) - messageTime(previous);
  return gap >= 0 && gap < SAME_RUN_MS;
}

// "Today" and "Yesterday" are worth the words; anything older gets its date.
// `now` is a parameter so this can be tested without owning the clock.
function dayLabel(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export { mergeInto, inOrder, isSameRun, dayLabel, compareMessages, messageTime, SAME_RUN_MS };

if (typeof window !== 'undefined') {
  window.MessageThread = { mergeInto, inOrder, isSameRun, dayLabel, compareMessages, messageTime, SAME_RUN_MS };
}
