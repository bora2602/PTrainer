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
function attachmentMarkup(file) {
  if (file.contentType.startsWith('image/')) {
    return `<a class="message-photo" href="${escapeText(file.url)}" target="_blank" rel="noopener"><img src="${escapeText(file.url)}" alt="${escapeText(file.fileName)}" loading="lazy" /></a>`;
  }
  return `<a class="message-file" href="${escapeText(file.url)}" download="${escapeText(file.fileName)}"><span aria-hidden="true">📄</span><span><strong>${escapeText(file.fileName)}</strong><small>PDF · ${formatBytes(file.byteSize)}</small></span></a>`;
}
function messageMarkup(item) {
  const mine = item.sender_id === state.user.id, files = item.attachments || [];
  return `<article class="message-bubble ${mine ? 'mine' : ''}${files.length && !item.body ? ' media-only' : ''}"><strong>${escapeText(mine ? 'You' : item.sender_name)}</strong>${item.body ? `<p>${escapeText(item.body)}</p>` : ''}${files.length ? `<div class="message-attachments">${files.map(attachmentMarkup).join('')}</div>` : ''}<small>${new Date(item.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></article>`;
}
async function loadMessages({ scrollToEnd = false } = {}) {
  const list = $('#messageList');
  try {
    const result = await api(`/api/messages${traineeQuery()}`);
    const partner = state.user.role === 'TRAINER' ? selectedClient()?.name : null;
    $('#messageThreadTitle').textContent = state.user.role === 'TRAINER'
      ? (partner ? `Conversation with ${partner}` : 'No active client selected')
      : (result.relationship ? 'Conversation with your trainer' : 'No trainer connected yet');
    // A poll that brings nothing new must not re-draw the thread: that would
    // reload every photo and yank somebody back to the bottom while they read.
    const key = `${state.selectedTraineeId || ''}:${result.messages.length}:${result.messages.at(-1)?.id || ''}`;
    if (key === composer.renderedKey) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const firstRender = !composer.renderedKey.startsWith(`${state.selectedTraineeId || ''}:`);
    composer.renderedKey = key;
    composer.olderCursor = result.olderCursor || null;
    $('#loadOlderMessages').hidden = !composer.olderCursor;
    list.innerHTML = result.messages.length ? result.messages.map(messageMarkup).join('') : `<div class="template-item"><span>${result.relationship ? 'No messages yet. Say hello 👋' : 'Messages open once a coaching relationship is active.'}</span></div>`;
    if (scrollToEnd || nearBottom || firstRender) list.scrollTop = list.scrollHeight;
  } catch (error) { $('#messageError').textContent = error.message; }
}
$('#loadOlderMessages').addEventListener('click', async event => {
  if (!composer.olderCursor) return;
  const button = event.currentTarget, list = $('#messageList');
  setBusy(button, true, 'Loading…');
  try {
    const query = traineeQuery();
    const older = await api(`/api/messages${query ? `${query}&` : '?'}before=${encodeURIComponent(composer.olderCursor)}`);
    const height = list.scrollHeight;
    list.insertAdjacentHTML('afterbegin', older.messages.map(messageMarkup).join(''));
    list.scrollTop = list.scrollHeight - height; // keep the reader where they were
    composer.olderCursor = older.olderCursor || null;
    button.hidden = !composer.olderCursor;
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
function renderAttachmentTray() {
  const tray = $('#attachmentTray');
  tray.hidden = !composer.files.length;
  tray.innerHTML = composer.files.map((file, index) => `<div class="tray-item">${file.isImage ? `<img src="${file.preview}" alt="" />` : '<span class="tray-file" aria-hidden="true">📄</span>'}<span class="tray-name">${escapeText(file.name)}<small>${formatBytes(file.size)}</small></span><button type="button" class="tray-remove" data-remove-attachment="${index}" aria-label="Remove ${escapeText(file.name)}">×</button></div>`).join('');
}
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
$('#messageForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#sendMessageButton'), body = $('#messageInput').value.trim();
  $('#messageError').textContent = '';
  if (!body && !composer.files.length) return void ($('#messageError').textContent = 'Write a message or attach a photo.');
  setBusy(button, true, 'Sending…');
  try {
    await api('/api/messages', { method: 'POST', body: JSON.stringify({ body, traineeId: state.user.role === 'TRAINER' ? selectedClient()?.id : undefined, attachments: composer.files.map(file => ({ name: file.name, data: file.data })) }) });
    $('#messageInput').value = '';
    composer.files = [];
    renderAttachmentTray();
    autosizeComposer();
    toggleEmojiPicker(false);
    await loadMessages({ scrollToEnd: true });
  } catch (error) { $('#messageError').textContent = error.message; }
  finally { setBusy(button, false); }
});

// Every script has loaded by now, so the app can start. It lives here, in the
// last file index.html loads, because starting any earlier would let the first
// API response arrive before workouts.js and this file had set up their parts.
initialize();
