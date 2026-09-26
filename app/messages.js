/* Messages — one conversation per coaching relationship, with photos, PDFs and
   emoji.

   Photos are shrunk and re-encoded in the browser before they are sent. Phone
   photos are routinely larger than the 5 MB limit, and re-encoding also drops
   the metadata a camera writes into the file, including where it was taken.
   The server still checks every file's real type from its bytes.

   Loaded after app.js and workouts.js; it is the last script, so it also starts
   the app. */

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PHOTO_EDGE = 2048;
const EMOJI = [
  ['Faces', [['😀', 'grinning'], ['😁', 'beaming'], ['😂', 'laughing'], ['🙂', 'smiling'], ['😊', 'happy'], ['😍', 'love it'], ['🤩', 'star struck'], ['😅', 'relieved'], ['😎', 'cool'], ['🤔', 'thinking'], ['😮‍💨', 'exhale'], ['😴', 'sleepy'], ['🥵', 'hot'], ['😬', 'grimace'], ['🙏', 'thank you'], ['❤️', 'heart']]],
  ['Hands', [['👍', 'thumbs up'], ['👎', 'thumbs down'], ['👏', 'clapping'], ['🙌', 'celebrate'], ['💪', 'strong'], ['🤝', 'handshake'], ['👊', 'fist bump'], ['✌️', 'peace'], ['👋', 'wave'], ['🫡', 'salute']]],
  ['Training', [['🏋️', 'weightlifting'], ['🏃', 'running'], ['🚴', 'cycling'], ['🧘', 'yoga'], ['🤸', 'stretching'], ['🏊', 'swimming'], ['🔥', 'fire'], ['⚡', 'energy'], ['💯', 'hundred'], ['🎯', 'on target'], ['⏱️', 'stopwatch'], ['🏆', 'trophy'], ['🥇', 'first place'], ['📈', 'going up'], ['✅', 'done'], ['❌', 'missed']]],
  ['Food & recovery', [['🥗', 'salad'], ['🍎', 'apple'], ['🍌', 'banana'], ['🥚', 'egg'], ['🍗', 'chicken'], ['🥑', 'avocado'], ['🥤', 'shake'], ['💧', 'water'], ['☕', 'coffee'], ['🛌', 'rest day'], ['🩹', 'bandage'], ['🧊', 'ice']]]
];

const composer = { files: [], renderedKey: '', olderCursor: null };
const formatBytes = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/* ── Reading the conversation ────────────────────────────────────────────── */

/* The thread keeps every message it has ever loaded, keyed by id.
   
   It used to hold only whatever the last request returned, and each poll did
   `list.innerHTML = latestPage`. So a reader who pressed "Show earlier
   messages" and scrolled back through 245 messages lost 45 of them the moment
   anybody sent anything: the list snapped back to the newest 200, the scroll
   offset stayed put, and the text under it silently became different messages.
   Merging by id instead means a refresh can only ever add. */
const thread = { byId: new Map(), olderCursor: null, oldestLoaded: null, pending: [], unseen: 0 };
// MessageThread comes from message-thread.mjs, a module, so it loads after this
// classic script. Everything below runs from an event or a fetch, never at
// parse time, so it is always there by the time it is read.
const messageTime = item => window.MessageThread.messageTime(item);
const inOrder = () => window.MessageThread.inOrder(thread.byId);
const mergeMessages = incoming => window.MessageThread.mergeInto(thread.byId, incoming);
function resetThread() {
  thread.byId.clear(); thread.olderCursor = null; thread.oldestLoaded = null; thread.unseen = 0;
  $('#newMessageCount').hidden = true;
}

const dayLabel = value => window.MessageThread.dayLabel(value);
const clockLabel = value => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function attachmentMarkup(file) {
  if (file.contentType.startsWith('image/')) {
    return `<a class="message-photo" href="${escapeText(file.url)}" target="_blank" rel="noopener"><img src="${escapeText(file.url)}" alt="${escapeText(file.fileName)}" loading="lazy" /></a>`;
  }
  return `<a class="message-file" href="${escapeText(file.url)}" download="${escapeText(file.fileName)}"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-file"/></svg><span><strong>${escapeText(file.fileName)}</strong><small>PDF · ${formatBytes(file.byteSize)}</small></span></a>`;
}

/* A bubble knows whether it opens a run of messages from the same person.
   Repeating the sender's name and a full date on every line is noise in a
   conversation that is mostly short replies. */
function messageMarkup(item, previous) {
  const mine = item.sender_id === state.user.id, files = item.attachments || [];
  const sameRun = window.MessageThread.isSameRun(item, previous);
  const state_ = item.localState ? ` is-${item.localState}` : '';
  return `<article class="message-bubble ${mine ? 'mine' : ''}${files.length && !item.body ? ' media-only' : ''}${sameRun ? ' same-run' : ''}${state_}" data-message-id="${escapeText(String(item.id))}">
    ${sameRun ? '' : `<strong>${escapeText(mine ? 'You' : item.sender_name)}</strong>`}
    ${item.body ? `<p>${escapeText(item.body)}</p>` : ''}
    ${files.length ? `<div class="message-attachments">${files.map(attachmentMarkup).join('')}</div>` : ''}
    <small class="message-time"><time datetime="${escapeText(new Date(item.created_at).toISOString())}">${clockLabel(item.created_at)}</time>${item.localState === 'sending' ? ' · sending…' : ''}${item.localState === 'failed' ? ' · not sent' : ''}</small>
    ${item.localState === 'failed' ? `<div class="message-retry"><button type="button" class="text-button" data-retry-message="${escapeText(String(item.id))}">Try again</button><button type="button" class="text-button" data-discard-message="${escapeText(String(item.id))}">Discard</button></div>` : ''}
  </article>`;
}

function renderThread({ keepAnchor = false, toEnd = false } = {}) {
  const list = $('#messageList');
  const items = [...inOrder(), ...thread.pending];
  const previousHeight = list.scrollHeight, previousTop = list.scrollTop;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state compact"><h2>${thread.relationship ? 'No messages yet' : 'No conversation yet'}</h2><p>${thread.relationship ? 'Say hello and it will appear here.' : 'Messages open once a coaching relationship is active.'}</p></div>`;
    return;
  }
  let html = '', lastDay = '';
  for (let i = 0; i < items.length; i += 1) {
    const day = dayLabel(items[i].created_at);
    if (day && day !== lastDay) { html += `<div class="message-day"><span>${escapeText(day)}</span></div>`; lastDay = day; }
    html += messageMarkup(items[i], i > 0 && lastDay === dayLabel(items[i - 1].created_at) ? items[i - 1] : null);
  }
  list.innerHTML = html;
  if (toEnd) list.scrollTop = list.scrollHeight;
  else if (keepAnchor) list.scrollTop = previousTop + (list.scrollHeight - previousHeight);
  else list.scrollTop = previousTop;
}

function showUnseen(count) {
  thread.unseen += count;
  const pill = $('#newMessageCount');
  pill.hidden = thread.unseen === 0;
  pill.textContent = thread.unseen === 1 ? '1 new message' : `${thread.unseen} new messages`;
}

async function loadMessages({ scrollToEnd = false } = {}) {
  const list = $('#messageList');
  try {
    const result = await api(`/api/messages${traineeQuery()}`);
    thread.relationship = result.relationship;
    const partner = state.user.role === 'TRAINER' ? selectedClient()?.name : null;
    $('#messageThreadTitle').textContent = state.user.role === 'TRAINER'
      ? (partner ? `Conversation with ${partner}` : 'No active client selected')
      : (result.relationship ? 'Conversation with your trainer' : 'No trainer connected yet');
    // Switching to another client is a different conversation, not an update.
    const conversation = state.selectedTraineeId || state.user.id;
    if (thread.conversation !== conversation) { resetThread(); thread.conversation = conversation; scrollToEnd = true; }
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const firstRender = thread.byId.size === 0;
    const added = mergeMessages(result.messages);
    if (thread.olderCursor === null && result.olderCursor) thread.olderCursor = result.olderCursor;
    $('#loadOlderMessages').hidden = !thread.olderCursor;
    if (!added && !scrollToEnd) return;
    const follow = scrollToEnd || nearBottom || firstRender;
    renderThread({ toEnd: follow });
    // Somebody reading older history is told, not dragged.
    if (added && !follow) showUnseen(added);
    else if (follow) { thread.unseen = 0; $('#newMessageCount').hidden = true; }
  } catch (error) { $('#messageError').textContent = error.message; }
}

$('#newMessageCount').addEventListener('click', () => {
  const list = $('#messageList');
  list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  thread.unseen = 0; $('#newMessageCount').hidden = true;
});
$('#messageList').addEventListener('scroll', () => {
  const list = $('#messageList');
  if (list.scrollHeight - list.scrollTop - list.clientHeight < 80) { thread.unseen = 0; $('#newMessageCount').hidden = true; }
});

$('#loadOlderMessages').addEventListener('click', async event => {
  if (!thread.olderCursor) return;
  const button = event.currentTarget;
  setBusy(button, true, 'Loading…');
  try {
    const query = traineeQuery();
    const older = await api(`/api/messages${query ? `${query}&` : '?'}before=${encodeURIComponent(thread.olderCursor)}`);
    mergeMessages(older.messages);
    thread.olderCursor = older.olderCursor || null;
    renderThread({ keepAnchor: true });   // the reader stays on the line they were reading
    button.hidden = !thread.olderCursor;
  } catch (error) { showToast(error.message); }
  finally { setBusy(button, false); }
});

/* ── Attachments ─────────────────────────────────────────────────────────── */
const readAsDataUrl = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
async function preparePhoto(file) {
  // GIFs keep their animation, so they go as they are.
  if (file.type === 'image/gif') {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 5 MB.`);
    return { name: file.name, data: await readAsDataUrl(file), preview: await readAsDataUrl(file), size: file.size, isImage: true };
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name} is a photo format this browser cannot read. Try a JPEG or PNG.`); }
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); // transparent PNGs
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob || blob.size > MAX_FILE_BYTES) throw new Error(`${file.name} is too large even after resizing.`);
  const data = await readAsDataUrl(blob);
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', data, preview: data, size: blob.size, isImage: true };
}
async function prepareFile(file) {
  if (file.type.startsWith('image/')) return preparePhoto(file);
  if (file.type !== 'application/pdf') throw new Error(`${file.name}: only photos and PDF files can be sent.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 5 MB.`);
  return { name: file.name, data: await readAsDataUrl(file), preview: null, size: file.size, isImage: false };
}
const ATTACHMENT_RULES = `Photos and PDFs, up to ${MAX_ATTACHMENTS} files, ${MAX_FILE_BYTES / 1024 / 1024} MB each.`;
function renderAttachmentTray() {
  const tray = $('#attachmentTray');
  tray.hidden = !composer.files.length;
  // Say what is allowed while something is attached, so the rule arrives before
  // the rejection rather than after it.
  $('#attachmentHint').hidden = !composer.files.length;
  $('#attachmentHint').textContent = `${composer.files.length} of ${MAX_ATTACHMENTS} attached. ${ATTACHMENT_RULES}`;
  tray.innerHTML = composer.files.map((file, index) => `<div class="tray-item">${file.isImage ? `<img src="${file.preview}" alt="" />` : '<span class="tray-file" aria-hidden="true">📄</span>'}<span class="tray-name">${escapeText(file.name)}<small>${formatBytes(file.size)}</small></span><button type="button" class="tray-remove" data-remove-attachment="${index}" aria-label="Remove ${escapeText(file.name)}">×</button></div>`).join('');
}
$('#attachButton').setAttribute('title', ATTACHMENT_RULES);
$('#attachButton').setAttribute('aria-label', `Attach a photo or PDF. ${ATTACHMENT_RULES}`);
$('#attachButton').addEventListener('click', () => $('#attachmentInput').click());
$('#attachmentInput').addEventListener('change', async event => {
  const picked = [...event.target.files];
  event.target.value = '';
  $('#messageError').textContent = '';
  const room = MAX_ATTACHMENTS - composer.files.length;
  if (picked.length > room) showToast(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
  for (const file of picked.slice(0, Math.max(0, room))) {
    try { composer.files.push(await prepareFile(file)); renderAttachmentTray(); }
    catch (error) { $('#messageError').textContent = error.message; }
  }
});
$('#attachmentTray').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-attachment]');
  if (!button) return;
  composer.files.splice(Number(button.dataset.removeAttachment), 1);
  renderAttachmentTray();
});

/* ── Emoji ───────────────────────────────────────────────────────────────── */
$('#emojiPicker').innerHTML = EMOJI.map(([group, items]) => `<div class="emoji-group" role="group" aria-label="${escapeText(group)}"><span class="emoji-group-name">${escapeText(group)}</span><div class="emoji-grid">${items.map(([emoji, name]) => `<button type="button" data-emoji="${emoji}" aria-label="${escapeText(name)}" title="${escapeText(name)}">${emoji}</button>`).join('')}</div></div>`).join('');
function toggleEmojiPicker(open) {
  const picker = $('#emojiPicker'), next = open ?? picker.hidden;
  picker.hidden = !next;
  $('#emojiButton').setAttribute('aria-expanded', String(next));
}
$('#emojiButton').addEventListener('click', () => toggleEmojiPicker());
$('#emojiPicker').addEventListener('click', event => {
  const button = event.target.closest('[data-emoji]');
  if (!button) return;
  const input = $('#messageInput'), start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? input.value.length;
  input.setRangeText(button.dataset.emoji, start, end, 'end');
  input.focus();
  autosizeComposer();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#emojiPicker').hidden) { toggleEmojiPicker(false); $('#emojiButton').focus(); } });
document.addEventListener('click', event => { if (!$('#emojiPicker').hidden && !event.target.closest('#emojiPicker, #emojiButton')) toggleEmojiPicker(false); });

/* ── Sending ─────────────────────────────────────────────────────────────── */
function autosizeComposer() {
  const input = $('#messageInput');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
$('#messageInput').addEventListener('input', autosizeComposer);
// Enter sends on a keyboard; Shift+Enter is a new line. On a phone the return
// key stays a new line, because there the Send button is under the thumb.
$('#messageInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(hover: hover)').matches) {
    event.preventDefault();
    $('#messageForm').requestSubmit();
  }
});
/* A message the server has not accepted yet is shown as its own bubble, so the
   difference between "sending", "sent" and "not sent" is visible in the place
   the person is already looking. A failure leaves the bubble there with a
   retry, rather than silently dropping what they wrote. */
let sending = false;
let pendingSeq = 0;

function draftKeyForConversation() { return `ptrainer-draft:${state.user?.id || ''}:${state.selectedTraineeId || ''}`; }
function saveDraft() {
  try {
    const value = $('#messageInput').value;
    if (value.trim()) localStorage.setItem(draftKeyForConversation(), value);
    else localStorage.removeItem(draftKeyForConversation());
  } catch { /* a draft is a convenience; private mode may refuse to store it */ }
}
function restoreDraft() {
  try {
    const saved = localStorage.getItem(draftKeyForConversation());
    if (saved && !$('#messageInput').value) { $('#messageInput').value = saved; autosizeComposer(); }
  } catch { /* nothing to restore */ }
}

async function deliver(pending) {
  pending.localState = 'sending';
  renderThread({ toEnd: true });
  try {
    const result = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ body: pending.body, traineeId: state.user.role === 'TRAINER' ? selectedClient()?.id : undefined,
        attachments: pending.files.map(file => ({ name: file.name, data: file.data })) })
    });
    thread.pending = thread.pending.filter(item => item !== pending);
    if (result.message) mergeMessages([result.message]);
    renderThread({ toEnd: true });
    await loadMessages({ scrollToEnd: true });
    try { localStorage.removeItem(draftKeyForConversation()); } catch { /* nothing stored */ }
  } catch (error) {
    pending.localState = 'failed';
    pending.error = error.message;
    renderThread({ toEnd: true });
    $('#messageError').textContent = error.message;
  }
}

$('#messageForm').addEventListener('submit', async event => {
  event.preventDefault();
  // Enter submits without touching the button, so disabling the button alone
  // let a fast double-press store the same message twice.
  if (sending) return;
  const body = $('#messageInput').value.trim();
  $('#messageError').textContent = '';
  if (!body && !composer.files.length) return void ($('#messageError').textContent = 'Write a message or attach a photo.');
  sending = true;
  const button = $('#sendMessageButton');
  setBusy(button, true, 'Sending…');
  const pending = { id: `pending_${++pendingSeq}`, body, files: composer.files.slice(), sender_id: state.user.id,
    sender_name: state.user.name, created_at: new Date().toISOString(), attachments: [], localState: 'sending' };
  thread.pending.push(pending);
  $('#messageInput').value = '';
  composer.files = [];
  renderAttachmentTray();
  autosizeComposer();
  toggleEmojiPicker(false);
  saveDraft();
  try { await deliver(pending); }
  finally { sending = false; setBusy(button, false); }
});

$('#messageList').addEventListener('click', async event => {
  const retry = event.target.closest('[data-retry-message]');
  const discard = event.target.closest('[data-discard-message]');
  if (retry) {
    const pending = thread.pending.find(item => item.id === retry.dataset.retryMessage);
    if (!pending || sending) return;
    sending = true;
    $('#messageError').textContent = '';
    try { await deliver(pending); } finally { sending = false; }
  }
  if (discard) {
    const pending = thread.pending.find(item => item.id === discard.dataset.discardMessage);
    if (!pending) return;
    // Give the words back rather than throwing them away.
    if (pending.body && !$('#messageInput').value) { $('#messageInput').value = pending.body; autosizeComposer(); saveDraft(); }
    thread.pending = thread.pending.filter(item => item !== pending);
    $('#messageError').textContent = '';
    renderThread({ toEnd: true });
  }
});

// A half-written message survives leaving the view and reloading the page.
$('#messageInput').addEventListener('input', saveDraft);
window.addEventListener('beforeunload', saveDraft);

// Every script has loaded by now, so the app can start. It lives here, in the
// last file index.html loads, because starting any earlier would let the first
// API response arrive before workouts.js and this file had set up their parts.
initialize();
