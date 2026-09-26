// WCAG 2.2 contrast for the palette, computed rather than eyeballed.
//
// design.md states specific ratios as the reason certain colours are what they
// are ("the soft coral measures 3.09:1 on this paper, so it never carries
// text"). Nothing checked those numbers, so a well-meaning tweak to a token
// could quietly break the contrast the design document promises.
//
// It also checks the one thing a ratio cannot: that the error colour is
// perceptually distinct from the brand coral. With a red accent, an error that
// looks like the brand is the failure mode, and WCAG contrast is blind to it -
// two colours of equal lightness measure 1.00:1 however different their hue.
// That pair is measured as an OKLab distance instead.
//
// This converts the OKLCH tokens to sRGB and computes the real ratios. It cannot
// tell you whether a colour is used where the check assumes, which is why the
// pairs below are written out explicitly and named.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'app', 'tokens.css'), 'utf8');

// --- OKLCH to linear sRGB -------------------------------------------------
function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}

// Relative luminance takes linear values directly, so no gamma round trip.
const clamp = value => Math.min(1, Math.max(0, value));
function luminance(L, C, h) {
  const [r, g, b] = oklchToLinearSrgb(L, C, h).map(clamp);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const high = Math.max(a, b), low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

// --- read the tokens ------------------------------------------------------
// Day is :root - light is the everyday theme; Night is the [data-theme="dark"] block.
const darkIndex = css.indexOf('[data-theme="dark"]');
assert.notEqual(darkIndex, -1, 'tokens.css declares no [data-theme="dark"] block');
const nightBlock = css.slice(darkIndex);
const dayBlock = css.slice(0, darkIndex);

function readTokens(block) {
  const tokens = new Map();     // token -> relative luminance, for contrast ratios
  const coords = new Map();     // token -> [L, C, h], for the OKLab distance check
  for (const match of block.matchAll(/(--color-[a-z0-9-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)/g)) {
    if (!tokens.has(match[1])) {
      const L = Number(match[2]) / 100, C = Number(match[3]), h = Number(match[4]);
      tokens.set(match[1], luminance(L, C, h));
      coords.set(match[1], [L, C, h]);
    }
  }
  tokens.coords = coords;
  return tokens;
}

const themes = { Day: readTokens(dayBlock), Night: readTokens(nightBlock) };

// --- the pairs that actually appear on screen -----------------------------
// AA: 4.5 for body text, 3.0 for large text and for the boundary of a control.
const PAIRS = [
  ['body text on the page', '--color-ink', '--color-paper', 4.5],
  ['body text on a card', '--color-ink', '--color-paper-2', 4.5],
  ['secondary text on the page', '--color-ink-2', '--color-paper', 4.5],
  ['muted text on the page', '--color-muted', '--color-paper', 4.5],
  // design.md assigns this the smallest legible role, so hold it to large-text AA.
  ['faint text on the page', '--color-faint', '--color-paper', 3.0],
  ['accent link on the page', '--color-accent', '--color-paper', 4.5],
  ['accent link on a card', '--color-accent', '--color-paper-2', 4.5],
  ['text on a primary button', '--color-accent-ink', '--color-accent', 4.5],
  ['focus ring against the page', '--color-focus', '--color-paper', 3.0],
  ['positive state on the page', '--color-positive', '--color-paper', 3.0],
  ['caution state on the page', '--color-caution', '--color-paper', 3.0],
  ['critical state on the page', '--color-critical', '--color-paper', 3.0],
  // The soft coral is a mark, not a word. 3:1 is the graphical-object floor;
  // if somebody raises this to 4.5 the brand colour itself has to change.
  ['brand mark against the page', '--color-brand', '--color-paper', 3.0],
  ['muted text on a card', '--color-muted', '--color-paper-2', 4.5],
  ['body text on the deepest surface', '--color-ink', '--color-paper-4', 4.5],
  ['accent on the sunk surface', '--color-accent', '--color-paper-sunk', 4.5],
  ['accent hover step on the page', '--color-accent-hi', '--color-paper', 4.5],
  ['critical state on a card', '--color-critical', '--color-paper-2', 3.0],
  ['positive state on a card', '--color-positive', '--color-paper-2', 3.0],
  ['caution state on a card', '--color-caution', '--color-paper-2', 3.0]
];

// OKLab distance, for the one pair a contrast ratio cannot judge. 0.05 is a
// comfortably perceptible separation; a just-noticeable difference is ~0.02.
const MIN_BRAND_ERROR_DISTANCE = 0.05;
function oklabDistance(a, b) {
  const toLab = ([L, C, h]) => {
    const rad = (h * Math.PI) / 180;
    return [L, C * Math.cos(rad), C * Math.sin(rad)];
  };
  const [l1, a1, b1] = toLab(a), [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const failures = [];
const report = {};

for (const [themeName, tokens] of Object.entries(themes)) {
  const rows = [];
  for (const [label, foreground, background, minimum] of PAIRS) {
    if (!tokens.has(foreground) || !tokens.has(background)) {
      failures.push(`${themeName}: ${label} references a token that is not defined in this theme`);
      continue;
    }
    const measured = ratio(tokens.get(foreground), tokens.get(background));
    const rounded = Math.round(measured * 100) / 100;
    rows.push(`${label}: ${rounded}:1 (needs ${minimum})`);
    if (measured < minimum) {
      failures.push(`${themeName}: ${label} measures ${rounded}:1, below the ${minimum}:1 minimum`);
    }
  }

  // With a coral accent, "is this an error or is this the brand?" is a real
  // question a ratio cannot answer. Measure it as a perceptual distance.
  const brand = tokens.coords.get('--color-brand');
  const critical = tokens.coords.get('--color-critical');
  if (!brand || !critical) {
    failures.push(`${themeName}: --color-brand or --color-critical is not defined`);
  } else {
    const distance = oklabDistance(brand, critical);
    const shown = Math.round(distance * 1000) / 1000;
    rows.push(`error colour vs brand coral: dE ${shown} (needs ${MIN_BRAND_ERROR_DISTANCE})`);
    if (distance < MIN_BRAND_ERROR_DISTANCE) {
      failures.push(`${themeName}: the error colour is dE ${shown} from the brand coral, closer than ${MIN_BRAND_ERROR_DISTANCE} - an error would read as the brand`);
    }
  }
  report[themeName] = rows;
}

for (const [themeName, rows] of Object.entries(report)) {
  console.log(`${themeName}:`);
  for (const row of rows) console.log(`  ${row}`);
}

if (failures.length) {
  console.error('\ncontrast check failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

assert.equal(failures.length, 0);
console.log('\nAll measured pairs meet WCAG 2.2 AA in both themes, and the error colour is perceptually clear of the brand coral.');
