// Unit tests for the iCalendar text the subscribable feed serves.
//
// The API suite proves who may read a feed. This proves the file they get is
// well formed, which is a different kind of bug: a calendar client that cannot
// parse a line does not report an error to anybody, it silently shows nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeIcsText, foldLine, icsDate, icsStamp, nextDay, buildCalendar } from './calendar-feed.mjs';

const linesOf = text => text.split('\r\n');

test('escapeIcsText escapes the characters that end a property value early', () => {
  assert.equal(escapeIcsText('Back, chest; legs'), 'Back\\, chest\\; legs');
  assert.equal(escapeIcsText('Push\\Pull'), 'Push\\\\Pull');
  assert.equal(escapeIcsText('Line one\nLine two'), 'Line one\\nLine two');
  assert.equal(escapeIcsText('Line one\r\nLine two'), 'Line one\\nLine two');
  // Backslash is escaped first, so an already-escaped comma is not mangled.
  assert.equal(escapeIcsText('a\\,b'), 'a\\\\\\,b');
  assert.equal(escapeIcsText(null), '');
});

test('foldLine leaves short lines alone', () => {
  assert.equal(foldLine('SUMMARY:Leg day'), 'SUMMARY:Leg day');
  assert.equal(foldLine('x'.repeat(75)), 'x'.repeat(75));
});

test('foldLine wraps at 75 octets with a leading space on continuations', () => {
  const folded = foldLine('SUMMARY:' + 'x'.repeat(120));
  const parts = folded.split('\r\n');
  assert.equal(parts.length, 2);
  assert.equal(Buffer.byteLength(parts[0], 'utf8'), 75);
  assert.equal(parts[1].startsWith(' '), true);
  // Unfolding is removing the CRLF and the one space that follows it.
  assert.equal(folded.replaceAll('\r\n ', ''), 'SUMMARY:' + 'x'.repeat(120));
});

test('foldLine measures bytes, so a multi-byte name is never split mid-character', () => {
  // Each of these is two octets, so a naive 75-character fold would cut one in
  // half and the client would render mojibake.
  const folded = foldLine('SUMMARY:' + 'é'.repeat(60));
  for (const part of folded.split('\r\n')) {
    assert.ok(Buffer.byteLength(part, 'utf8') <= 75, 'a folded segment exceeded 75 octets');
  }
  assert.equal(folded.replaceAll('\r\n ', ''), 'SUMMARY:' + 'é'.repeat(60));
  assert.equal(folded.includes('�'), false, 'a character was split across the fold');
});

test('icsDate and icsStamp render the two time formats', () => {
  assert.equal(icsDate('2027-04-15'), '20270415');
  assert.equal(icsStamp('2027-04-15T13:00:00.000Z'), '20270415T130000Z');
  // A row with no updated_at must not produce "InvalidDate" in the file.
  assert.match(icsStamp('not a date'), /^\d{8}T\d{6}Z$/);
});

test('nextDay rolls over months, years and leap days', () => {
  assert.equal(nextDay('2027-04-15'), '2027-04-16');
  assert.equal(nextDay('2027-04-30'), '2027-05-01');
  assert.equal(nextDay('2027-12-31'), '2028-01-01');
  assert.equal(nextDay('2028-02-28'), '2028-02-29');
});

test('buildCalendar writes an all-day event with an exclusive end date', () => {
  const ics = buildCalendar({
    calendarName: 'Ptrainer workouts',
    origin: 'https://app.example.com',
    now: new Date('2027-04-01T00:00:00.000Z'),
    events: [{ id: 'assigned_abc', date: '2027-04-15', title: 'Back Workout', updatedAt: '2027-03-30T12:00:00.000Z' }]
  });
  const lines = linesOf(ics);
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20270415'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20270416'), 'a same-day DTEND renders as a zero-length event');
  assert.ok(lines.includes('SUMMARY:Back Workout'));
  assert.ok(lines.includes('UID:assigned_abc@app.example.com'));
  assert.ok(lines.includes('LAST-MODIFIED:20270330T120000Z'));
  assert.ok(lines.includes('END:VCALENDAR'));
  assert.ok(ics.endsWith('\r\n'));
});

test('buildCalendar carries no programme detail', () => {
  const ics = buildCalendar({
    origin: 'https://app.example.com',
    events: [{ id: 'assigned_abc', date: '2027-04-15', title: 'Jordan Lee · Back Workout' }]
  });
  // The whole point of the name-only decision: a person holding the URL, or
  // anyone the subscriber shares their calendar with, learns the day and the
  // name and nothing about the programming.
  assert.equal(/DESCRIPTION/.test(ics), false);
  assert.equal(/reps|sets|\bkg\b|\blb\b/i.test(ics), false);
});

test('buildCalendar stays valid with no events and with a broken origin', () => {
  const empty = buildCalendar({ events: [] });
  assert.ok(empty.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(empty.trimEnd().endsWith('END:VCALENDAR'));
  assert.equal(empty.includes('BEGIN:VEVENT'), false);

  const broken = buildCalendar({ origin: 'not a url', events: [{ id: 'assigned_abc', date: '2027-04-15', title: 'Leg day' }] });
  assert.ok(broken.includes('UID:assigned_abc@ptrainer'), 'a malformed origin must not break the UID');
});

test('buildCalendar skips a row with no date rather than emitting a broken event', () => {
  // Unscheduled work exists; it has no square to sit in and no day to claim.
  const ics = buildCalendar({ events: [{ id: 'assigned_abc', date: null, title: 'Someday' }, { id: 'assigned_def', date: '2027-04-15', title: 'Leg day' }] });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.includes('SUMMARY:Leg day'));
});
