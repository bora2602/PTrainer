// iCalendar (RFC 5545) text for the subscribable workout feed.
//
// This is string building and nothing else - no database, no clock it does not
// own, no request - so the format can be asserted directly in a unit test. The
// server decides who may read a feed and what goes on each line; this file only
// decides how those lines are spelled.
//
// Two rules shape everything below.
//
// A workout has a due date and no due time: assigned_workouts.due_date is a bare
// DATE. So every event is an all-day event (VALUE=DATE) rather than an invented
// 9am block, and nothing here touches timezones - an all-day event has none.
//
// A subscribed client replaces its whole copy of the calendar on each poll, so
// an assignment that was rescheduled, deleted or archived simply stops being
// written here and disappears on the next refresh. That is why there are no
// STATUS:CANCELLED tombstones and no sequence numbers to keep in step.

// RFC 5545 section 3.3.11. Backslash first, or it escapes the escapes.
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Lines fold at 75 *octets*, not 75 characters. A client named "José" or a
// workout called "Epaules" spelled with its accent would otherwise be cut
// mid-codepoint and arrive as mojibake, so the width is measured in UTF-8 bytes
// and a character is never split across the boundary.
export function foldLine(line) {
  const text = String(line ?? '');
  if (Buffer.byteLength(text, 'utf8') <= 75) return text;
  const pieces = [];
  let current = '';
  let limit = 75;
  for (const character of text) {
    const width = Buffer.byteLength(character, 'utf8');
    if (Buffer.byteLength(current, 'utf8') + width > limit) {
      pieces.push(current);
      current = '';
      // Continuation lines carry a leading space that is not part of the value,
      // so they hold one octet less.
      limit = 74;
    }
    current += character;
  }
  if (current) pieces.push(current);
  return pieces.join('\r\n ');
}

// 2027-04-15 -> 20270415. Text in, text out: parsing a bare date into a Date is
// exactly the mistake the rest of this codebase avoids, because the answer
// depends on which midnight the runtime picks.
export const icsDate = value => String(value ?? '').slice(0, 10).replace(/-/g, '');

// An instant, unlike a due date, really is an instant, so UTC is correct here.
export function icsStamp(value) {
  const parsed = value ? new Date(value) : new Date();
  const instant = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

// DTEND on an all-day event is exclusive: a workout on the 15th ends on the
// 16th, or calendars draw it as a zero-length event. Done on the date text
// through UTC arithmetic, which has no daylight saving to get wrong.
export function nextDay(value) {
  const text = String(value ?? '').slice(0, 10);
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return text;
  return new Date(parsed + 86400000).toISOString().slice(0, 10);
}

const property = (name, value) => foldLine(`${name}:${value}`);

// events: [{ id, date, title, updatedAt }]
export function buildCalendar({ calendarName = 'Ptrainer', events = [], origin = '', now = new Date() } = {}) {
  const stamp = icsStamp(now);
  let host = 'ptrainer';
  try { if (origin) host = new URL(origin).host || host; } catch { /* a malformed origin only affects the UID suffix */ }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ptrainer//Workout Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    property('X-WR-CALNAME', escapeIcsText(calendarName)),
    // Both a hint, and both ignored by clients that have their own idea. Apple
    // honours the first; Google polls on its own schedule regardless.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];
  for (const event of events) {
    if (!event || !event.date) continue;
    lines.push(
      'BEGIN:VEVENT',
      property('UID', `${event.id}@${host}`),
      property('DTSTAMP', stamp),
      property('LAST-MODIFIED', icsStamp(event.updatedAt || now)),
      property('DTSTART;VALUE=DATE', icsDate(event.date)),
      property('DTEND;VALUE=DATE', icsDate(nextDay(event.date))),
      property('SUMMARY', escapeIcsText(event.title)),
      // The event carries a name and a day. It deliberately carries no
      // DESCRIPTION: sets, reps, loads and exercise names are the part of a
      // program that should not travel in a file anyone holding the URL - or
      // anyone the subscriber shares their calendar with - can read.
      ...(origin ? [property('URL', origin)] : []),
      // Workouts should not make somebody look busy to colleagues reading their
      // free/busy time.
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
