// Keeps "every view has a skeleton" true after today.
//
// skeleton.js wraps loaders by name, so a new loader silently gets no loading
// state and a renamed container silently stops receiving one - nothing throws.
// This reads the source and fails the build on either, and also holds the two
// motion rules design.md sets for anything that animates.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../app/${file}`, import.meta.url), 'utf8');
const [skeleton, html, css, server] = await Promise.all([read('skeleton.js'), read('index.html'), read('theme.css'), read('server.mjs')]);
const scripts = Object.fromEntries(await Promise.all(['app.js', 'workouts.js', 'messages.js', 'auth.js'].map(async file => [file, await read(file)])));
const failures = [];
const ok = [];

// ---- Every loader has a skeleton or a stated reason not to. -------------
const registered = new Set([...skeleton.matchAll(/loader: '(\w+)'/g)].map(match => match[1]));
const exemptBlock = skeleton.match(/const SKELETON_EXEMPT = \{([\s\S]*?)\};/)?.[1] || '';
const exempt = new Set([...exemptBlock.matchAll(/(\w+):/g)].map(match => match[1]));
const loaders = [];
for (const [file, source] of Object.entries(scripts)) {
  for (const [, name] of source.matchAll(/async function (load[A-Z]\w*)\(/g)) loaders.push([file, name]);
}
for (const [file, name] of loaders) {
  if (!registered.has(name) && !exempt.has(name)) failures.push(`${file}: ${name}() has no skeleton - add it to SKELETON_VIEWS or to SKELETON_EXEMPT with a reason`);
}
for (const name of exempt) {
  if (!loaders.some(([, loader]) => loader === name)) failures.push(`SKELETON_EXEMPT names ${name}(), which is not a loader`);
}
for (const name of registered) {
  if (!loaders.some(([, loader]) => loader === name)) failures.push(`SKELETON_VIEWS names ${name}(), which no longer exists`);
}
ok.push(`${loaders.length} loaders: ${registered.size} with skeletons, ${exempt.size} exempt with a reason`);

// ---- Every registered container exists in the page. --------------------
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const classes = new Set([...html.matchAll(/\bclass="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)));
const selectors = new Set([...skeleton.matchAll(/\['([#.][^']+)',\s*'(\w+)'/g)].map(match => match[1]));
for (const selector of selectors) {
  for (const part of selector.split(/\s+/)) {
    const tokens = part.match(/[#.][A-Za-z0-9_-]+/g) || [];
    for (const token of tokens) {
      const found = token.startsWith('#') ? ids.has(token.slice(1)) : classes.has(token.slice(1));
      if (!found) failures.push(`skeleton target "${selector}": ${token} is not in index.html`);
    }
  }
}
ok.push(`all ${selectors.size} skeleton targets exist in index.html`);

// ---- Shapes named in the registry are shapes that exist. ----------------
const shapeNames = new Set([...skeleton.matchAll(/^\s{2}(\w+): (?:\(|count)/gm)].map(match => match[1]));
for (const [, , shape] of skeleton.matchAll(/\['([#.][^']+)',\s*'(\w+)'/g)) {
  if (!shapeNames.has(shape) && !['mask', 'text'].includes(shape)) failures.push(`unknown skeleton shape "${shape}"`);
}
ok.push('every shape the registry uses is defined');

// ---- Served, and loaded where its globals exist. -----------------------
assert.match(server, /PUBLIC_FILES[^;]*'skeleton\.js'/, 'skeleton.js must be in PUBLIC_FILES');
const at = file => html.indexOf(`src="${file}`);
if (!(at('auth.js') > 0 && at('auth.js') < at('skeleton.js') && at('skeleton.js') < at('messages.js'))) failures.push('skeleton.js must load after auth.js (whose loader it wraps) and before messages.js (which calls initialize())');
if (!/installSkeletons\(\)/.test(scripts['app.js'])) failures.push('initialize() must call installSkeletons() before the first loader runs');
ok.push('skeleton.js is served and loads between auth.js and messages.js');

// ---- design.md's motion rules. ------------------------------------------
const skCss = css.slice(css.indexOf('Skeleton loading states'));
for (const [, name, body] of skCss.matchAll(/@keyframes ([\w-]+) \{([^}]*\}[^}]*)\}/g)) {
  const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map(match => match[1]);
  const allowed = name === 'boot-failsafe' ? ['opacity', 'visibility', 'pointer-events'] : ['opacity', 'transform'];
  for (const property of properties) if (!allowed.includes(property)) failures.push(`@keyframes ${name} animates ${property}; design.md allows only transform and opacity`);
}
if (!/prefers-reduced-motion: reduce[\s\S]*\.sk-bar/.test(skCss)) failures.push('the skeleton pulse has no reduced-motion override');
if (!/boot-failsafe/.test(skCss)) failures.push('the boot screen has no failsafe: a script error would leave it covering the page');
ok.push('skeleton motion is opacity-only, stops under reduced motion, and the boot screen has its failsafe');

// ---- No text placeholder left where a skeleton now belongs. ------------
for (const leftover of ['<div class="template-item"><span>Loading…</span></div>', 'Loading exercises…']) {
  if (html.includes(leftover) || Object.values(scripts).some(source => source.includes(leftover))) failures.push(`a "${leftover}" text placeholder is still in use`);
}
ok.push('no list still shows a bare "Loading…" line instead of a skeleton');

if (failures.length) {
  console.error('\nSkeleton coverage is broken:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('');
  process.exit(1);
}
for (const line of ok) console.log(`  ok  ${line}`);
console.log('\nEvery loader has a skeleton or a reason not to.\n');
