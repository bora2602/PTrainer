// Unit tests for the rules that decide what the API accepts.
//
// These run with `node --test` and touch nothing: no server, no database, no
// network. Everything the API suites cover goes through HTTP, which is the right
// level for authorization but a slow and indirect way to pin down that 180 lb is
// 81.647 kg or that a nine-character password is rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validPassword, validName, validEmail, cleanEmail, validDateOnly,
  convertUnit, normalizedProgressValue, normalizeProgressEntry,
  normalizeWorkoutInput, normalizeSetRows, exerciseCompletion,
  nutritionValues, normalizeNutritionEntry,
  normalizeExerciseInput, normalizeTrainerNote, normalizeSchedule, normalizeDateWindow,
  normalizeRelationshipPermissions, relationshipPermissions,
  encodeCursor, decodeCursor,
  prescriptionExtras, normalizeTemplateExercises, sessionStart, sessionDuration,
  sniffAttachmentType, attachmentFileName, normalizeAttachments, contentDisposition,
  MAX_ATTACHMENT_BYTES
} from './validation.mjs';

test('validPassword requires length and four character classes', () => {
  assert.equal(validPassword('LongEnough1!'), true);
  assert.equal(validPassword('Short1!'), false, 'under ten characters');
  assert.equal(validPassword('alllowercase1!'), false, 'no uppercase');
  assert.equal(validPassword('ALLUPPERCASE1!'), false, 'no lowercase');
  assert.equal(validPassword('NoDigitsHere!!'), false, 'no digit');
  assert.equal(validPassword('NoSymbolsHere1'), false, 'no symbol');
  assert.equal(validPassword('A1!' + 'a'.repeat(126)), false, 'over 128 characters');
  assert.equal(validPassword(null), false);
});

test('name and email rules', () => {
  assert.equal(validName('Jo'), true);
  assert.equal(validName(' J '), false, 'trimmed length under two');
  assert.equal(validName('x'.repeat(81)), false);
  assert.equal(cleanEmail('  Person@Example.COM '), 'person@example.com');
  assert.equal(cleanEmail(42), '', 'a non-string is not an address');
  assert.equal(validEmail('person@example.com'), true);
  assert.equal(validEmail('no-at-sign'), false);
  assert.equal(validEmail('spaces in@example.com'), false);
  assert.equal(validEmail('a'.repeat(250) + '@example.com'), false, 'over 254 characters');
});

test('validDateOnly rejects dates that do not exist', () => {
  assert.equal(validDateOnly('2026-02-28'), true);
  assert.equal(validDateOnly('2026-02-30'), false, 'February has no thirtieth');
  assert.equal(validDateOnly('2026-13-01'), false);
  assert.equal(validDateOnly('26-01-01'), false);
  assert.equal(validDateOnly(''), false);
});

test('convertUnit converts within a dimension and refuses across one', () => {
  assert.equal(convertUnit(180, 'lb', 'kg'), 81.647);
  // Converting back does not land exactly on 180, because 81.647 is itself a
  // rounded figure. This is precisely why the entered value and unit are stored
  // untouched and only the derived pair is normalized: round-tripping a stored
  // conversion would drift a little further every time.
  assert.equal(convertUnit(81.647, 'kg', 'lb'), 180.001);
  assert.equal(convertUnit(10, 'in', 'cm'), 25.4);
  assert.equal(convertUnit(5, 'kg', 'kg'), 5, 'same unit is a passthrough');
  // A kilogram is not a centimetre, and returning a plausible number here would
  // put a silently wrong value on a chart.
  assert.equal(convertUnit(80, 'kg', 'cm'), null);
  assert.equal(convertUnit(80, 'kg', 'nonsense'), null);
  assert.equal(convertUnit(Number.NaN, 'kg', 'lb'), null);
});

test('normalizedProgressValue targets the canonical unit of the dimension', () => {
  assert.deepEqual(normalizedProgressValue(180, 'lb'), { value: 81.647, unit: 'kg' });
  assert.deepEqual(normalizedProgressValue(32, 'in'), { value: 81.28, unit: 'cm' });
  assert.deepEqual(normalizedProgressValue(18, 'percent'), { value: 18, unit: 'percent' });
  assert.equal(normalizedProgressValue(1, 'furlong'), null);
});

test('normalizeProgressEntry keeps the entered value and derives the comparable one', () => {
  const entry = normalizeProgressEntry({ metricType: 'weight', value: 180, unit: 'lb', measuredAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(entry.value, 180, 'what the person typed is untouched');
  assert.equal(entry.unit, 'lb');
  assert.equal(entry.normalizedValue, 81.647);
  assert.equal(entry.normalizedUnit, 'kg');

  assert.equal(normalizeProgressEntry({ metricType: 'weight', value: -1, unit: 'kg' }), null);
  assert.equal(normalizeProgressEntry({ metricType: 'weight', value: 10001, unit: 'kg' }), null);
  assert.equal(normalizeProgressEntry({ metricType: 'weight', value: 80, unit: 'stone' }), null);
  assert.equal(normalizeProgressEntry({ metricType: '9lives', value: 80, unit: 'kg' }), null, 'metric keys start with a letter');
  assert.equal(normalizeProgressEntry({ metricType: 'weight', value: 80, unit: 'kg', measuredAt: 'not a date' }), null);

  // A known metric fixes what it measures.
  const metrics = new Map([['waist', { key: 'waist', dimension: 'LENGTH', canonicalUnit: 'cm' }]]);
  assert.equal(normalizeProgressEntry({ metricType: 'waist', value: 80, unit: 'kg' }, metrics), null, 'a waist is not a mass');
  assert.ok(normalizeProgressEntry({ metricType: 'waist', value: 80, unit: 'cm' }, metrics));
});

test('normalizeWorkoutInput bounds every prescribed field', () => {
  const good = { name: 'Leg day', dueDate: '2026-03-01', exercises: [{ name: 'Back squat', sets: 5, reps: 5, restSeconds: 180 }] };
  assert.ok(normalizeWorkoutInput(good));
  assert.equal(normalizeWorkoutInput({ ...good, name: 'ab' }), null, 'name under three characters');
  assert.equal(normalizeWorkoutInput({ ...good, dueDate: '2026-02-30' }), null, 'impossible date');
  assert.equal(normalizeWorkoutInput({ ...good, exercises: [] }), null);
  assert.equal(normalizeWorkoutInput({ ...good, exercises: Array(31).fill(good.exercises[0]) }), null, 'over thirty movements');
  assert.equal(normalizeWorkoutInput({ ...good, exercises: [{ name: 'Squat', sets: 0, reps: 5, restSeconds: 0 }] }), null, 'zero sets');
  assert.equal(normalizeWorkoutInput({ ...good, exercises: [{ name: 'Squat', sets: 3, reps: 5, restSeconds: 901 }] }), null, 'rest over the cap');
  assert.equal(normalizeWorkoutInput({ ...good, exercises: [{ name: 'Squat', sets: 1.5, reps: 5, restSeconds: 0 }] }), null, 'fractional sets');
});

test('normalizeSetRows refuses an index the workout never prescribed', () => {
  // Two exercises, so index 2 does not exist.
  assert.equal(normalizeSetRows([{ exerciseIndex: 2, setIndex: 0 }], 2), null);
  assert.equal(normalizeSetRows([{ exerciseIndex: -1, setIndex: 0 }], 2), null);
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 50 }], 2), null);
  assert.deepEqual(normalizeSetRows(null, 2), [], 'absent sets are not an error');
  assert.equal(normalizeSetRows('not an array', 2), null);
  assert.equal(normalizeSetRows(Array(201).fill({ exerciseIndex: 0, setIndex: 0 }), 2), null, 'over the row cap');

  // The same slot twice would collide with the unique index in the table.
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 0 }, { exerciseIndex: 0, setIndex: 0 }], 2), null);

  // A measurement without its unit is not a measurement.
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 0, loadValue: 100 }], 2), null);
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 0, distanceValue: 5 }], 2), null);
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 0, loadValue: 100, loadUnit: 'stone' }], 2), null);
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 0, exertion: 11 }], 2), null, 'RPE tops out at ten');
  assert.equal(normalizeSetRows([{ exerciseIndex: 0, setIndex: 0, reps: 1.5 }], 2), null, 'reps are whole');

  const rows = normalizeSetRows([
    { exerciseIndex: 1, setIndex: 1, reps: 8, completed: true },
    { exerciseIndex: 0, setIndex: 0, reps: 5, loadValue: 100, loadUnit: 'KG', exertion: 8, note: '  steady  ' }
  ], 2);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].exerciseIndex, rows[0].setIndex], [0, 0], 'rows come back in workout order');
  assert.equal(rows[0].loadUnit, 'kg', 'units are folded to lower case');
  assert.equal(rows[0].note, 'steady', 'notes are trimmed');
  assert.equal(rows[0].completed, false);
});

test('exerciseCompletion derives from sets when the client sends none', () => {
  const sets = [
    { exerciseIndex: 0, setIndex: 0, completed: true },
    { exerciseIndex: 0, setIndex: 1, completed: true },
    { exerciseIndex: 1, setIndex: 0, completed: false }
  ];
  assert.deepEqual(exerciseCompletion({}, sets, 2), [true, false], 'every recorded set must be done');
  assert.deepEqual(exerciseCompletion({}, [], 2), [false, false], 'no sets means nothing is complete');
  // Explicit flags win, and are padded to the workout's own length.
  assert.deepEqual(exerciseCompletion({ exercises: [{ completed: true }] }, sets, 2), [true, false]);
  assert.equal(exerciseCompletion({ exercises: [{}, {}, {}] }, sets, 2), null, 'more flags than exercises');
});

test('nutrition values are bounded and typed', () => {
  assert.deepEqual(nutritionValues({ calories: 500, proteinG: 30 }),
    { calories: 500, proteinG: 30, carbsG: null, fatG: null, waterMl: null });
  assert.equal(nutritionValues({ calories: -1 }), null);
  assert.equal(nutritionValues({ calories: 100001 }), null);
  assert.equal(nutritionValues({ calories: 12.5 }), null, 'calories are whole');
  assert.equal(nutritionValues({ waterMl: 12.5 }), null, 'millilitres are whole');
  assert.deepEqual(nutritionValues({ calories: '' }).calories, null, 'an empty field is absent, not zero');
});

test('normalizeNutritionEntry needs a date, a type, and something to record', () => {
  const base = { entryDate: '2026-01-01', entryType: 'lunch', description: 'Rice and chicken' };
  assert.ok(normalizeNutritionEntry(base));
  assert.equal(normalizeNutritionEntry(base).entryType, 'LUNCH');
  assert.equal(normalizeNutritionEntry({ ...base, entryType: 'BRUNCH' }), null);
  assert.equal(normalizeNutritionEntry({ ...base, entryDate: '2026-02-30' }), null);
  assert.equal(normalizeNutritionEntry({ entryDate: '2026-01-01', entryType: 'LUNCH' }), null,
    'an entry with neither description nor numbers records nothing');
  assert.equal(normalizeNutritionEntry({ ...base, foodBarcode: 'not-a-barcode' }), null);
  assert.equal(normalizeNutritionEntry({ ...base, foodQuantityG: 0 }), null, 'a zero quantity is not a quantity');
  assert.equal(normalizeNutritionEntry({ ...base, description: 'x'.repeat(1001) }), null);
});

test('exercise and note inputs', () => {
  assert.ok(normalizeExerciseInput({ name: 'Sled push', difficulty: 'advanced' }));
  assert.equal(normalizeExerciseInput({ name: 'Sled push', difficulty: 'advanced' }).difficulty, 'ADVANCED');
  assert.equal(normalizeExerciseInput({ name: 'x' }), null, 'name under two characters');
  assert.equal(normalizeExerciseInput({ name: 'Sled push', difficulty: 'IMPOSSIBLE' }), null);
  // A javascript: or http: reference has no business in a media field.
  assert.equal(normalizeExerciseInput({ name: 'Sled push', mediaUrl: 'javascript:alert(1)' }), null);
  assert.equal(normalizeExerciseInput({ name: 'Sled push', mediaUrl: 'http://example.com/x.mp4' }), null);
  assert.ok(normalizeExerciseInput({ name: 'Sled push', mediaUrl: 'https://example.com/x.mp4' }));

  assert.deepEqual(normalizeTrainerNote({ body: ' Watch the knee ' }), { body: 'Watch the knee', visibility: 'PRIVATE' });
  assert.equal(normalizeTrainerNote({ body: '   ' }), null, 'whitespace is not a note');
  assert.equal(normalizeTrainerNote({ body: 'ok', visibility: 'PUBLIC' }), null);
});

test('normalizeSchedule expands a repeat and refuses an endless one', () => {
  assert.deepEqual(normalizeSchedule({ dueDate: '2026-09-01' }).dates, ['2026-09-01']);
  assert.deepEqual(normalizeSchedule({}).dates, [null], 'a workout with no date is allowed');
  assert.deepEqual(
    normalizeSchedule({ startDate: '2026-09-01', endDate: '2026-09-29', frequency: 'WEEKLY' }).dates,
    ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  assert.equal(normalizeSchedule({ startDate: '2026-09-01', frequency: 'WEEKLY' }), null, 'a repeat needs an end');
  assert.equal(normalizeSchedule({ startDate: '2026-09-10', endDate: '2026-09-01', frequency: 'WEEKLY' }), null, 'end before start');
  assert.equal(normalizeSchedule({ startDate: '2026-09-01', endDate: '2026-09-08', frequency: 'YEARLY' }), null);
  // One request must not be able to create thousands of rows.
  assert.equal(normalizeSchedule({ startDate: '2026-01-01', endDate: '2030-01-01', frequency: 'DAILY' }).dates.length, 52);
});

test('normalizeDateWindow takes both ends of a bounded window or none', () => {
  assert.deepEqual(normalizeDateWindow('2026-09-01', '2026-09-30'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(normalizeDateWindow(null, null), { from: null, to: null }, 'no window is not an error');
  assert.deepEqual(normalizeDateWindow('2026-09-01', '2026-09-01'), { from: '2026-09-01', to: '2026-09-01' },
    'a single day is a window');
  // Half a window would have to guess the other end, and a guessed month is the
  // wrong month.
  assert.equal(normalizeDateWindow('2026-09-01', ''), null, 'a start with no end is refused');
  assert.equal(normalizeDateWindow('', '2026-09-30'), null, 'an end with no start is refused');
  assert.equal(normalizeDateWindow('2026-09-30', '2026-09-01'), null, 'end before start');
  assert.equal(normalizeDateWindow('2026-02-30', '2026-03-01'), null, 'a date that does not exist');
  assert.equal(normalizeDateWindow('not-a-date', '2026-09-30'), null);
  // An unbounded range is a full-table scan wearing a date filter.
  assert.deepEqual(normalizeDateWindow('2026-01-01', '2027-01-01'), { from: '2026-01-01', to: '2027-01-01' },
    'a year is the most a calendar shows at once');
  assert.equal(normalizeDateWindow('2026-01-01', '2027-01-02'), null, 'more than a year is refused');
});

test('relationship permissions default closed for writing and merge over stored values', () => {
  assert.deepEqual(relationshipPermissions(null),
    { view_progress: true, view_nutrition: true, log_on_behalf: false });
  // A relationship stored before the column existed still answers every flag.
  assert.equal(relationshipPermissions({ permissions: { view_nutrition: false } }).view_progress, true);
  assert.equal(relationshipPermissions({ permissions: { view_nutrition: false } }).view_nutrition, false);

  assert.deepEqual(normalizeRelationshipPermissions({ log_on_behalf: true }),
    { view_progress: true, view_nutrition: true, log_on_behalf: true });
  assert.equal(normalizeRelationshipPermissions('everything'), null);
  assert.equal(normalizeRelationshipPermissions([true]), null);
  assert.equal(normalizeRelationshipPermissions(null), null);
  // Unknown keys are dropped rather than stored.
  assert.deepEqual(Object.keys(normalizeRelationshipPermissions({ be_admin: true })).sort(),
    ['log_on_behalf', 'view_nutrition', 'view_progress']);
});

test('cursors round-trip and reject anything else', () => {
  const cursor = encodeCursor(['2026-01-01T00:00:00.000Z', 'progress_abc']);
  assert.deepEqual(decodeCursor(cursor, 2), ['2026-01-01T00:00:00.000Z', 'progress_abc']);
  assert.equal(decodeCursor(cursor, 3), null, 'a cursor for a different sort key is refused');
  assert.equal(decodeCursor('not-base64url!!', 2), null);
  assert.equal(decodeCursor(encodeCursor({ not: 'an array' }), 2), null);
  assert.equal(decodeCursor('', 2), null);
  assert.equal(decodeCursor(null, 2), null);
});

test('a prescription keeps a target weight only with its unit', () => {
  assert.deepEqual(prescriptionExtras({}), { targetLoad: null, loadUnit: null, note: '' });
  assert.deepEqual(prescriptionExtras({ targetLoad: '62.5', loadUnit: 'kg', note: ' Pause at the bottom ' }),
    { targetLoad: 62.5, loadUnit: 'kg', note: 'Pause at the bottom' });
  assert.equal(prescriptionExtras({ targetLoad: 60 }), null, 'a weight with no unit is refused, not guessed');
  assert.equal(prescriptionExtras({ targetLoad: 60, loadUnit: 'stone' }), null);
  assert.equal(prescriptionExtras({ targetLoad: -5, loadUnit: 'kg' }), null);
  assert.equal(prescriptionExtras({ note: 'x'.repeat(201) }), null);
  // A unit on its own is harmless and dropped, so an emptied weight field saves.
  assert.deepEqual(prescriptionExtras({ targetLoad: '', loadUnit: 'lb' }), { targetLoad: null, loadUnit: null, note: '' });
});

test('template exercises are clamped, and their prescription checked strictly', () => {
  const [exercise] = normalizeTemplateExercises([{ name: ' Squat ', sets: 99, reps: 0, restSeconds: -1, targetLoad: 100, loadUnit: 'kg', exerciseId: 'ex_1' }]);
  assert.deepEqual(exercise, { name: 'Squat', sets: 20, reps: 1, restSeconds: 0, exerciseId: 'ex_1', targetLoad: 100, loadUnit: 'kg', note: '' });
  assert.equal(normalizeTemplateExercises([]), null);
  assert.equal(normalizeTemplateExercises([{ name: 'S' }]), null, 'a one-letter name');
  assert.equal(normalizeTemplateExercises([{ name: 'Squat', targetLoad: 100 }]), null, 'a weight without a unit');
  assert.equal(normalizeTemplateExercises([{ name: 'Squat', exerciseId: '../x' }])[0].exerciseId, null);
});

test('normalizeWorkoutInput carries the optional prescription too', () => {
  const good = { name: 'Leg day', exercises: [{ name: 'Back squat', sets: 5, reps: 5, restSeconds: 180, targetLoad: 225, loadUnit: 'lb' }] };
  assert.equal(normalizeWorkoutInput(good).exercises[0].targetLoad, 225);
  assert.equal(normalizeWorkoutInput(good).exercises[0].loadUnit, 'lb');
  assert.equal(normalizeWorkoutInput({ ...good, exercises: [{ ...good.exercises[0], loadUnit: '' }] }), null);
});

test('a session start has to be plausible, and a duration is bounded', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');
  assert.equal(sessionStart('2026-09-25T11:15:00.000Z', now).toISOString(), '2026-09-25T11:15:00.000Z');
  assert.equal(sessionStart('2026-09-25T12:10:00.000Z', now), null, 'too far in the future');
  assert.equal(sessionStart('2026-09-23T12:00:00.000Z', now), null, 'more than a day ago');
  assert.equal(sessionStart('yesterday', now), null);
  assert.equal(sessionStart(1695643200000, now), null, 'only a timestamp string is accepted');
  assert.equal(sessionDuration('2026-09-25T11:15:00.000Z', now), 45 * 60);
  assert.equal(sessionDuration('2026-09-25T12:30:00.000Z', now), 0, 'clock skew never goes negative');
  assert.equal(sessionDuration(null, now), null);
});

const bytesOf = (...values) => Buffer.from(values.flat());
const padded = head => Buffer.concat([Buffer.isBuffer(head) ? head : Buffer.from(head), Buffer.alloc(32)]);

test('attachment types come from the file bytes, never the name', () => {
  assert.equal(sniffAttachmentType(padded(bytesOf(0xff, 0xd8, 0xff, 0xe0))), 'image/jpeg');
  assert.equal(sniffAttachmentType(padded(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))), 'image/png');
  assert.equal(sniffAttachmentType(padded('GIF89a')), 'image/gif');
  assert.equal(sniffAttachmentType(padded(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))), 'image/webp');
  assert.equal(sniffAttachmentType(padded('%PDF-1.7')), 'application/pdf');
  assert.equal(sniffAttachmentType(padded('<html><script>')), null, 'markup is never an attachment');
  assert.equal(sniffAttachmentType(padded('<svg xmlns')), null, 'SVG can carry script, so it is not accepted');
  assert.equal(sniffAttachmentType(Buffer.from([0xff, 0xd8])), null, 'too short to be anything');
});

test('attachment names are made safe and agree with the real type', () => {
  assert.equal(attachmentFileName('../../etc/passwd', 'image/png'), '.. .. etc passwd.png');
  assert.equal(attachmentFileName('Squat form.HEIC', 'image/jpeg'), 'Squat form.jpg');
  assert.equal(attachmentFileName('evil"\r\nSet-Cookie: x.pdf', 'application/pdf'), 'evil Set-Cookie x.pdf');
  assert.equal(attachmentFileName('', 'image/gif'), 'attachment.gif');
  assert.ok(attachmentFileName('a'.repeat(500), 'image/jpeg').length <= 124);
});

test('normalizeAttachments enforces count, size and type', () => {
  const jpeg = padded(bytesOf(0xff, 0xd8, 0xff, 0xe0)).toString('base64');
  const ok = normalizeAttachments([{ name: 'form.jpg', data: jpeg }]);
  assert.equal(ok.attachments.length, 1);
  assert.equal(ok.attachments[0].contentType, 'image/jpeg');
  assert.equal(ok.attachments[0].byteSize, 36);
  assert.equal(normalizeAttachments([{ name: 'x.jpg', data: `data:image/jpeg;base64,${jpeg}` }]).attachments.length, 1, 'a data URL prefix is tolerated');
  assert.deepEqual(normalizeAttachments(undefined), { attachments: [] });
  assert.equal(normalizeAttachments('nope').error, 'ATTACHMENTS_INVALID');
  assert.equal(normalizeAttachments(Array(5).fill({ name: 'x.jpg', data: jpeg })).error, 'TOO_MANY_ATTACHMENTS');
  assert.equal(normalizeAttachments([{ name: 'x.jpg', data: 'not base64!' }]).error, 'ATTACHMENTS_INVALID');
  assert.equal(normalizeAttachments([{ name: 'x.txt', data: Buffer.from('hello there, plain text').toString('base64') }]).error, 'ATTACHMENT_TYPE_UNSUPPORTED');
  const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 3); big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  assert.equal(normalizeAttachments([{ name: 'big.jpg', data: big.toString('base64') }]).error, 'ATTACHMENT_TOO_LARGE');
  const four = Buffer.alloc(3 * 1024 * 1024); four[0] = 0xff; four[1] = 0xd8; four[2] = 0xff;
  assert.equal(normalizeAttachments(Array(4).fill({ name: 'x.jpg', data: four.toString('base64') })).error, 'ATTACHMENT_TOO_LARGE', 'over the per-message total');
});

test('contentDisposition cannot be broken out of by a file name', () => {
  assert.equal(contentDisposition('inline', 'form.jpg'), `inline; filename="form.jpg"; filename*=UTF-8''form.jpg`);
  assert.equal(contentDisposition('attachment', 'Plan (v2) é.pdf'), `attachment; filename="Plan (v2) _.pdf"; filename*=UTF-8''Plan%20%28v2%29%20%C3%A9.pdf`);
});
