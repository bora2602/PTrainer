// The calendar feed is the one URL in this application that answers without a
// session, because Google Calendar and Apple Calendar cannot send a cookie or a
// CSRF token. That makes the URL itself the credential, and makes this file the
// place where three things have to hold:
//
//   - the link works with no cookie and no CSRF header, or the feature does not
//     work at all;
//   - it shows its owner's days and nobody else's, and stops working the moment
//     it is replaced or turned off;
//   - it carries a name and a date and nothing else. Sets, reps, loads and the
//     exercise list must never travel in a file anybody holding the URL can read.
import assert from 'node:assert/strict';

const base = process.env.PTRAINER_BASE || 'http://127.0.0.1:4173';
const stamp = Date.now();
const notice = (await (await fetch(`${base}/api/privacy`)).json()).noticeVersion;

class Actor {
  cookie = ''; csrf = '';
  async request(path, options = {}) {
    const response = await fetch(base + path, {
      ...options,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(options.method && options.method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}),
        ...options.headers
      }
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const data = await response.json();
    if (data.csrfToken) this.csrf = data.csrfToken;
    return { status: response.status, data };
  }
  async start() { await this.request('/api/session'); return this; }
  login(email, password) { return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); }
  async register(role) {
    const email = `feed_${role}_${stamp}_${Math.random().toString(36).slice(2, 8)}@ptrainer.local`;
    const result = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: `Feed ${role}`, email, password: 'ProbeAccount1!', role, privacyAccepted: true, privacyNoticeVersion: notice })
    });
    if (result.status === 429) {
      console.error('This check registers one account and the registration rate limit is');
      console.error('already spent. The buckets are in memory, so restarting the app clears');
      console.error('them; then run this again.');
      process.exit(2);
    }
    assert.equal(result.status, 201, `register failed: ${JSON.stringify(result.data).slice(0, 160)}`);
    return this;
  }
  // Issuing returns the raw token once and never again, so it is captured here.
  async issueFeed() {
    const result = await this.request('/api/me/calendar-feed', { method: 'POST', body: '{}' });
    assert.equal(result.status, 201, `issuing a feed failed: ${JSON.stringify(result.data).slice(0, 160)}`);
    return result.data;
  }
}

// A calendar client is not an API client: it sends no cookie, no CSRF token and
// no JSON Accept header, and it reads text rather than an object. Everything
// about this helper is the point of the test.
async function readFeed(token) {
  const response = await fetch(`${base}/api/calendar/${token}.ics`);
  return { status: response.status, contentType: response.headers.get('content-type') || '', body: await response.text() };
}
const tokenIn = url => (String(url).match(/\/api\/calendar\/(cal_[^./]+)\.ics$/) || [])[1];

const shiftedDate = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const trainer = await new Actor().start();
assert.equal((await trainer.login('trainer@ptrainer.local', 'DemoTrainer1!')).status, 200);
const trainee = await new Actor().start();
assert.equal((await trainee.login('trainee@ptrainer.local', 'DemoTrainee1!')).status, 200);
const dashboard = (await trainer.request('/api/dashboard')).data;
const traineeId = dashboard.clients[0].id;
const traineeName = dashboard.clients[0].name;

// --- setup ----------------------------------------------------------------
// Dates are relative to today rather than fixed, because the feed covers a
// window around now: a hardcoded year would quietly fall outside it later.
const workoutName = `Feed probe ${stamp}`;
const exerciseName = `Probe squat ${stamp}`;
const template = await trainer.request('/api/workout-templates', {
  method: 'POST',
  body: JSON.stringify({ name: workoutName, exercises: [{ name: exerciseName, sets: 4, reps: 12, restSeconds: 90 }] })
});
assert.equal(template.status, 201);
const templateId = template.data.template.id;

const soon = shiftedDate(40);
const assigned = await trainer.request('/api/assigned-workouts', { method: 'POST', body: JSON.stringify({ templateId, traineeId, startDate: soon }) });
assert.equal(assigned.status, 201, JSON.stringify(assigned.data).slice(0, 200));

// Beyond the feed horizon, so the window is proved to have an end.
const distant = shiftedDate(400);
const farAway = await trainer.request('/api/assigned-workouts', { method: 'POST', body: JSON.stringify({ templateId, traineeId, startDate: distant }) });
assert.equal(farAway.status, 201);

// --- the feed answers an anonymous calendar client -------------------------
const issued = await trainee.issueFeed();
assert.ok(issued.url && issued.url.includes('/api/calendar/'), 'issuing returns the full URL once');
assert.ok(issued.webcalUrl.startsWith('webcal:'), 'the one-tap iOS form is offered');
assert.ok(issued.feed.fingerprint.startsWith('cal_'), 'a fingerprint identifies the live link');
const traineeToken = tokenIn(issued.url);
assert.ok(traineeToken, `could not read a token out of ${issued.url}`);

const feed = await readFeed(traineeToken);
assert.equal(feed.status, 200, 'a calendar client sending no cookie and no CSRF token must be answered');
assert.match(feed.contentType, /text\/calendar/);
assert.ok(feed.body.startsWith('BEGIN:VCALENDAR'), 'the body is an iCalendar document');
assert.ok(feed.body.includes('END:VCALENDAR'));
assert.ok(feed.body.includes(`SUMMARY:${workoutName}`), 'the trainee sees their own scheduled workout');
assert.ok(feed.body.includes(`DTSTART;VALUE=DATE:${soon.replaceAll('-', '')}`), 'the workout lands on its due date');

// --- the feed carries no programme detail ---------------------------------
assert.equal(feed.body.includes(exerciseName), false, 'an exercise name reached the feed');
assert.equal(/DESCRIPTION/.test(feed.body), false, 'the feed carries a description it should not have');
assert.equal(/\b12 reps\b|\b4 sets\b/i.test(feed.body), false, 'prescription detail reached the feed');
assert.equal(feed.body.includes(distant.replaceAll('-', '')), false, 'a workout past the feed horizon was included');

// --- the raw token is never readable back ---------------------------------
const readBack = await trainee.request('/api/me/calendar-feed');
assert.equal(readBack.status, 200);
assert.equal(readBack.data.feed.enabled, true);
assert.equal(readBack.data.feed.fingerprint, issued.feed.fingerprint);
assert.equal(JSON.stringify(readBack.data).includes(traineeToken), false, 'the raw token was served a second time');
assert.equal('url' in readBack.data, false, 'a full feed URL was returned outside the moment of issue');

// --- a trainer feed names the client on each event ------------------------
const trainerIssued = await trainer.issueFeed();
const trainerToken = tokenIn(trainerIssued.url);
const trainerFeed = await readFeed(trainerToken);
assert.equal(trainerFeed.status, 200);
assert.ok(trainerFeed.body.includes(`SUMMARY:${traineeName} · ${workoutName}`), 'a coaching event names the client and the workout');

// --- denied: somebody else's link, a guessed link, a retired link ---------
// A well-formed token that was never issued.
const guessed = await readFeed('cal_' + 'A'.repeat(32));
assert.equal(guessed.status, 404, 'a guessed token must not be answered');
assert.equal(guessed.body.includes('BEGIN:VCALENDAR'), false);

// A different person's feed shows their days, not this trainee's.
const outsider = await new Actor().start();
await outsider.register('TRAINEE');
const outsiderFeed = await readFeed(tokenIn((await outsider.issueFeed()).url));
assert.equal(outsiderFeed.status, 200);
assert.equal(outsiderFeed.body.includes(workoutName), false, 'another account read this trainee workout');
assert.equal(outsiderFeed.body.includes('BEGIN:VEVENT'), false, 'a brand new account has nothing scheduled');

// Replacing the link retires the old one immediately.
const replaced = await trainee.issueFeed();
const replacementToken = tokenIn(replaced.url);
assert.notEqual(replacementToken, traineeToken, 'a replacement must be a new token');
assert.equal((await readFeed(traineeToken)).status, 404, 'the replaced link kept working');
assert.equal((await readFeed(replacementToken)).status, 200, 'the replacement link does not work');

// Turning it off stops it.
const turnedOff = await trainee.request('/api/me/calendar-feed', { method: 'DELETE', body: '{}' });
assert.equal(turnedOff.status, 200);
assert.equal(turnedOff.data.feed.enabled, false);
assert.equal((await readFeed(replacementToken)).status, 404, 'a revoked link kept working');

// --- the download stays behind the session --------------------------------
const anonymousDownload = await fetch(`${base}/api/me/calendar.ics`);
assert.equal(anonymousDownload.status, 401, 'the .ics download must require a session');
const download = await fetch(`${base}/api/me/calendar.ics`, { headers: { Cookie: trainer.cookie } });
assert.equal(download.status, 200);
assert.match(download.headers.get('content-disposition') || '', /attachment/);
assert.ok((await download.text()).startsWith('BEGIN:VCALENDAR'));

// --- the token never reaches the request log ------------------------------
// The label the server logs is asserted directly in server.mjs routeLabel; here
// the guarantee that matters to a reader of this suite is that the token is
// long, opaque and unguessable, so a leaked log line is the only realistic way
// it escapes.
assert.ok(traineeToken.length >= 20, 'the token is too short to resist guessing');

console.log(JSON.stringify({
  feedAnswersWithoutCookieOrCsrf: 'pass',
  eventsLandOnTheirDueDate: 'pass',
  noProgrammeDetailInTheFeed: 'pass',
  horizonExcludesDistantWork: 'pass',
  rawTokenNeverServedTwice: 'pass',
  trainerFeedNamesTheClient: 'pass',
  guessedTokenRefused: 'pass',
  anotherAccountSeesOnlyTheirOwn: 'pass',
  replacedLinkStopsWorking: 'pass',
  revokedLinkStopsWorking: 'pass',
  downloadRequiresASession: 'pass'
}, null, 2));
