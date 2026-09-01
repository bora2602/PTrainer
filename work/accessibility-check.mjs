// Structural accessibility invariants for the app shell.
//
// Deliberately dependency-free rather than a headless-browser audit. This
// project has two runtime dependencies and no build step; pulling in a browser
// harness to assert "every input has a label" would cost more than it returns.
// What a static check can prove, it proves here. What it cannot - contrast in
// the rendered theme, focus order, screen-reader phrasing - is called out at the
// bottom as still needing a person.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'app', 'index.html'), 'utf8');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// A page needs a language for pronunciation and a way past the navigation.
check(/<html[^>]*\blang="[a-z]{2}/.test(html), 'the document declares no language');
check(/skip/i.test(html), 'there is no skip link past the navigation');
check(/<main\b/.test(html), 'there is no main landmark');
check(/name="viewport"[^>]*width=device-width/.test(html), 'the viewport is not responsive');

// Every control a person types into needs a name, and a placeholder is not one:
// it disappears as soon as they start typing.
const labelFor = new Set([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map(match => match[1]));
const unlabelled = [];
for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
  const tag = match[0];
  const type = (tag.match(/type="([^"]+)"/) || [])[1] || 'text';
  if (['hidden', 'submit', 'button'].includes(type)) continue;
  if (/aria-label=|aria-labelledby=/.test(tag)) continue;
  const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
  if (id && labelFor.has(id)) continue;
  const before = html.slice(Math.max(0, match.index - 400), match.index);
  if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) continue;
  unlabelled.push(tag.slice(0, 80));
}
check(unlabelled.length === 0, `form controls with no accessible name: ${unlabelled.join(' | ')}`);

// A modal announced as only "dialog" tells somebody nothing about where they are.
const unnamedDialogs = [...html.matchAll(/<dialog\b[^>]*>/g)]
  .filter(match => !/aria-label=|aria-labelledby=/.test(match[0]))
  .map(match => (match[0].match(/id="([^"]+)"/) || [])[1] || '(no id)');
check(unnamedDialogs.length === 0, `dialogs with no accessible name: ${unnamedDialogs.join(', ')}`);

// Anything a screen reader cannot parse needs a text equivalent nearby.
check(/id="progressChart"[^>]*role="img"/.test(html), 'the progress chart is not marked as an image');
check(/id="progressChart"[^>]*aria-label=/.test(html), 'the progress chart has no description');
check(/id="progressEntries"/.test(html), 'the chart has no text alternative listing the entries');

// Errors and status updates have to reach somebody who cannot see them appear.
check((html.match(/aria-live=/g) || []).length >= 2, 'too few live regions for status messages');
check((html.match(/role="alert"/g) || []).length >= 5, 'form errors are not announced');

// Images carry alt text, decorative ones say so.
for (const match of html.matchAll(/<img\b[^>]*>/g)) {
  check(/\balt=/.test(match[0]), `image without alt: ${match[0].slice(0, 60)}`);
}

// Touch targets: the workout logger is used one-handed, mid-set.
const css = readFileSync(join(root, 'app', 'styles.css'), 'utf8')
  + readFileSync(join(root, 'app', 'aurora.css'), 'utf8');
check(/min-height:\s*4[4-9]px|min-height:\s*[5-9]\dpx/.test(css), 'no touch-sized targets defined for small screens');

if (failures.length) {
  console.error('accessibility check failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log(JSON.stringify({
  documentLanguage: 'pass',
  skipLinkAndLandmarks: 'pass',
  everyControlNamed: 'pass',
  everyDialogNamed: 'pass',
  chartHasTextAlternative: 'pass',
  statusMessagesAnnounced: 'pass',
  imagesHaveAlt: 'pass',
  touchTargets: 'pass',
  stillNeedsAPerson: 'contrast in both themes, focus order, and screen-reader phrasing'
}, null, 2));
