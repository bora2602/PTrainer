// Messages with photos and files: what is accepted, who can read it back, and
// that a thread past its first page opens on the newest messages.
//
// The denied cases matter more than the allowed one. An attachment is health-
// adjacent content - a progress photo, a doctor's note - so a trainer from
// another practice, an unconnected trainee and a signed-out caller must all get
// the same answer as an id that never existed.
import assert from 'node:assert/strict';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();

class Actor {
  cookie = ''; csrf = '';
  async raw(path, options = {}) {
    return fetch(base + path, {
      ...options,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(options.method && options.method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}),
        ...options.headers
      }
    });
  }
  async request(path, options = {}) {
    const response = await this.raw(path, options);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await response.json();
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  async start() { await this.request('/api/session'); return this; }
  login(email, password) { return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); }
  async register(role, label) {
    const notice = (await this.request('/api/privacy')).data.noticeVersion;
    const email = `msg_${label}_${stamp}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Messaging ${label}`, email, password: 'MessagingPass1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
    });
    if (result.status === 429) { console.error('Registration rate limit spent; restart the app and rerun.'); process.exit(2); }
    assert.equal(result.status, 201);
    return result.data.user;
  }
  send(body) { return this.request('/api/messages', { method: 'POST', body: JSON.stringify(body) }); }
}

// A real 1x1 PNG, and HTML dressed up as a JPEG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FAKE_JPEG = Buffer.from('<html><script>alert(document.cookie)</script></html>').toString('base64');

const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const trainee = await new Actor().start();
const traineeLogin = await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!');
assert.equal(traineeLogin.status, 200);
const traineeId = traineeLogin.data.user.id;

// --- sending ---------------------------------------------------------------
const photo = await trainee.send({ body: `Form check ${stamp}`, attachments: [{ name: 'squat depth.png', data: PNG }] });
assert.equal(photo.status, 201, JSON.stringify(photo.data));
assert.equal(photo.data.message.attachments.length, 1);
const attachment = photo.data.message.attachments[0];
assert.equal(attachment.contentType, 'image/png');
assert.equal(attachment.fileName, 'squat depth.png');
assert.equal(attachment.byteSize, Buffer.from(PNG, 'base64').length);
assert.match(attachment.url, /^\/api\/messages\/attachments\/att_[a-f0-9]+$/);
assert.equal('data' in attachment, false, 'the message never carries the bytes');

const captionless = await trainee.send({ attachments: [{ name: 'progress.png', data: PNG }] });
assert.equal(captionless.status, 201, 'a photo on its own is a message');
assert.equal(captionless.data.message.body, '');

const empty = await trainee.send({ body: '   ' });
assert.equal(empty.status, 422, 'nothing to send is still refused');
assert.equal(empty.data.error.code, 'MESSAGE_INVALID');

const spoofed = await trainee.send({ body: 'look', attachments: [{ name: 'photo.jpg', data: FAKE_JPEG }] });
assert.equal(spoofed.status, 422, 'the file is judged by its bytes, not its name');
assert.equal(spoofed.data.error.code, 'ATTACHMENT_TYPE_UNSUPPORTED');
assert.equal(spoofed.data.error.field, 'attachments');

const tooMany = await trainee.send({ body: 'lots', attachments: Array(5).fill({ name: 'a.png', data: PNG }) });
assert.equal(tooMany.status, 422);
assert.equal(tooMany.data.error.code, 'TOO_MANY_ATTACHMENTS');

// --- reading back ----------------------------------------------------------
const thread = await trainer.request(`/api/messages?traineeId=${traineeId}`);
assert.equal(thread.status, 200);
const listed = thread.data.messages.find(item => item.id === photo.data.message.id);
assert.ok(listed, 'the trainer sees the message in the right conversation');
assert.equal(listed.attachments[0].id, attachment.id);
assert.equal(thread.data.messages.at(-1).id, captionless.data.message.id, 'the page ends on the newest message');

const download = await trainer.raw(attachment.url);
assert.equal(download.status, 200);
assert.equal(download.headers.get('content-type'), 'image/png');
assert.match(download.headers.get('content-disposition'), /^inline; filename="squat depth.png"/);
assert.match(download.headers.get('content-security-policy'), /sandbox/, 'opened directly, the file still cannot run anything');
assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
assert.equal(Buffer.from(await download.arrayBuffer()).toString('base64'), PNG, 'the bytes come back exactly');
assert.equal((await trainee.raw(attachment.url)).status, 200, 'the sender can open their own file');

// --- denied ----------------------------------------------------------------
const outsider = await new Actor().start();
await outsider.register('TRAINER', 'outsider');
const foreign = await outsider.raw(attachment.url);
assert.equal(foreign.status, 404, 'another trainer gets the unknown-id answer');
assert.equal((await foreign.json()).error.code, 'ATTACHMENT_NOT_FOUND');

const stranger = await new Actor().start();
await stranger.register('TRAINEE', 'stranger');
assert.equal((await stranger.raw(attachment.url)).status, 404, 'an unconnected trainee cannot open it');

const anonymous = await fetch(base + attachment.url);
assert.equal(anonymous.status, 401, 'signed out, nothing is served');

assert.equal((await trainer.raw('/api/messages/attachments/att_0000000000000000000000')).status, 404);
assert.equal((await outsider.request(`/api/messages?traineeId=${traineeId}`)).data.messages.length, 0, 'the outsider sees no conversation either');

// --- history ---------------------------------------------------------------
// The latest page opens on the newest message; `before` walks back from there.
const firstPage = await trainee.request('/api/messages?limit=2');
assert.equal(firstPage.status, 200);
assert.equal(firstPage.data.messages.length, 2);
assert.equal(firstPage.data.messages[1].id, captionless.data.message.id);
assert.ok(firstPage.data.olderCursor, 'a full page offers older history');
assert.equal(firstPage.data.nextCursor, null, 'nothing is newer than the latest page');
const older = await trainee.request(`/api/messages?limit=2&before=${encodeURIComponent(firstPage.data.olderCursor)}`);
assert.equal(older.status, 200);
assert.ok(older.data.messages.length >= 1);
const firstIds = new Set(firstPage.data.messages.map(item => item.id));
assert.ok(older.data.messages.every(item => !firstIds.has(item.id)), 'older history does not repeat the page before it');
assert.ok(new Date(older.data.messages.at(-1).created_at) <= new Date(firstPage.data.messages[0].created_at));

// Polling forward from a message returns only what came after it.
const forward = await trainee.request(`/api/messages?cursor=${encodeURIComponent(firstPage.data.olderCursor)}&limit=50`);
assert.equal(forward.status, 200);
assert.ok(forward.data.messages.some(item => item.id === captionless.data.message.id));

console.log('messaging check passed: attachments stored, served safely, denied across accounts; history pages both ways');
