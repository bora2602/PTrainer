#!/usr/bin/env node
/**
 * The only supported way to rebuild the PTrainer knowledge graph.
 *
 * Run it as `pnpm --dir app run graph` (or `node scripts/graph-build.mjs`).
 * Do not call `graphify extract` by hand: this script owns the scope decision,
 * and a bare extract at the wrong root produces a graph that looks fine and
 * answers wrong.
 *
 * Why a script rather than a command:
 *
 *   1. Scope is asserted, not assumed. The graph must contain app/, work/ and
 *      scripts/ and nothing else. If a vendored dependency, a build output or a
 *      generated vault ever lands in the graph, the build FAILS here rather than
 *      quietly re-weighting every hub in the graph.
 *   2. Nothing replaces a good graph until a new one has passed those checks.
 *      The build stages into .graph-build/ and swaps at the end, so a crashed or
 *      rejected run leaves the previous graph intact.
 *   3. --code-only is passed on every extract. Without it graphify sends every
 *      markdown/doc file in scope through a third-party LLM. This repo holds
 *      unreleased product planning, a privacy checklist and health-domain
 *      schema; none of it should leave the machine.
 *
 * Scope rationale is in CLAUDE.md under "Code knowledge graph".
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, readdirSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'graphify-out');
const BUILD_DIR = join(REPO_ROOT, '.graph-build');
const STAGED_OUT = join(BUILD_DIR, 'graphify-out');

/** The directories that ARE this project. Everything else is not the project. */
const GRAPHED_DIRS = ['app', 'work', 'scripts'];

/** Extensions that can move the graph. A CSS or markdown edit cannot. */
const CODE_EXTENSIONS = ['.mjs', '.js', '.sql', '.py'];

/** graphify silently degrades graph.html into an aggregated blob past 5000. */
const NODE_CEILING = 5000;
const NODE_WARN = 4000;

/** Refuse a rebuild that loses more than a quarter of the graph, unless --force. */
const SHRINK_TOLERANCE = 0.75;

/** Watch mode waits for this much quiet before rebuilding. See watchMode(). */
const IDLE_MS = 10_000;

const args = process.argv.slice(2);
const WATCH = args.includes('--watch');
const FORCE = args.includes('--force');

const log = (...m) => console.log('[graph]', ...m);
const warn = (...m) => console.warn('[graph] WARNING:', ...m);

function fail(...m) {
  console.error('[graph] FAILED:', ...m);
  cleanIntermediates();
  // In watch mode a bad build must not take the watcher down with it - the
  // previous graph is still in place and the next save should get another go.
  if (WATCH) throw new Error(m.join(' '));
  process.exit(1);
}

/**
 * Clean on the way IN as well as out. A stale staging directory from a crashed
 * run would otherwise be treated as current and swapped in as if it were fresh.
 */
function cleanIntermediates() {
  rmSync(BUILD_DIR, { recursive: true, force: true });
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.graph-') && entry.name !== '.graph-build') {
      rmSync(join(REPO_ROOT, entry.name), { recursive: true, force: true });
    }
  }
}

/** Synchronous sleep - the build is deliberately sequential top to bottom. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows fails a directory rename with EPERM/EBUSY whenever anything still
 * holds a handle inside it - antivirus scanning the ~630 vault notes the export
 * just wrote is enough, and it is timing-dependent rather than reproducible.
 * Observed in watch mode: the swap threw, and the graph was left moved aside.
 */
function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const transient = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code);
      if (!transient || attempt === attempts) throw err;
      sleepSync(120 * attempt);
    }
  }
}

function graphify(step, argv) {
  log(`${step}...`);
  const res = spawnSync('python', ['-m', 'graphify', ...argv], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // networkx's louvain clustering iterates string-keyed sets whose order is
    // randomised per process by PYTHONHASHSEED, so community assignments churn
    // between runs on identical code. Unpinned, two builds of the same commit
    // gave 41 and then 44 communities. Pin it so the graph is reproducible.
    env: { ...process.env, PYTHONHASHSEED: '0' },
  });
  if (res.error) fail(`could not run python -m graphify (${res.error.message})`);
  if (res.status !== 0) fail(`${step} exited ${res.status}`);
}

function readGraph(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Raw extraction writes edges under `edges`; `cluster-only` rewrites the file
 * into networkx node-link format, where they are under `links`. Read both, or
 * anything inspecting a clustered graph silently sees zero edges.
 */
function edgesOf(graph) {
  if (Array.isArray(graph?.edges)) return graph.edges;
  if (Array.isArray(graph?.links)) return graph.links;
  return [];
}

/** Top-level directory of a graph node's source_file, or null for externals. */
function topDir(sourceFile) {
  if (!sourceFile) return null;
  const normalized = String(sourceFile).replace(/\\/g, '/');
  const slash = normalized.indexOf('/');
  return slash === -1 ? normalized : normalized.slice(0, slash);
}

/**
 * The scope assertion. This is what replaces extracting each directory
 * separately and merging: rather than restricting what graphify is allowed to
 * see and hoping the restriction holds, we let it see the repo (which preserves
 * the work/ -> app/ import edges a split extract destroys) and then refuse the
 * result if anything outside the project got in.
 */
function validate(graph) {
  if (!graph || !Array.isArray(graph.nodes)) fail('staged graph.json is missing or unparseable');

  const nodes = graph.nodes;
  const edges = edgesOf(graph);
  if (nodes.length === 0) fail('staged graph has zero nodes');
  if (edges.length === 0) fail('staged graph has zero edges');

  const offenders = new Map();
  for (const node of nodes) {
    const dir = topDir(node.source_file);
    if (dir === null) continue; // external / stdlib symbol, carries no path
    if (!GRAPHED_DIRS.includes(dir)) {
      // Keyed by file, not by node: one offending file holds many symbols and
      // listing it once per symbol makes the report look like a different bug.
      const files = offenders.get(dir) ?? new Set();
      files.add(node.source_file);
      offenders.set(dir, files);
    }
  }
  if (offenders.size > 0) {
    console.error('[graph] out-of-scope files entered the graph:');
    for (const [dir, files] of offenders) {
      const shown = [...files].slice(0, 5).join(', ');
      const rest = files.size > 5 ? ` (+${files.size - 5} more)` : '';
      console.error(`         ${dir} - ${shown}${rest}`);
    }
    fail(
      'refusing to publish. Either add the directory to GRAPHED_DIRS in this ' +
        'script (if it really is part of the project) or add it to .gitignore.',
    );
  }

  // The SQL grammar is a separate install (pip install "graphifyy[sql]"). Without
  // it graphify only warns, and all 18 migrations extract to nothing - the data
  // model silently leaves the graph. That is ~7% of nodes, well inside the shrink
  // tolerance below, so it needs its own check or it passes unnoticed.
  if (!nodes.some((n) => String(n.source_file ?? '').endsWith('.sql'))) {
    fail(
      'no SQL nodes in the graph, so app/migrations/ contributed nothing. ' +
        'Install the grammar with: pip install "graphifyy[sql]"',
    );
  }

  if (nodes.length >= NODE_CEILING) {
    fail(
      `${nodes.length} nodes is at or past graphify's ${NODE_CEILING}-node ceiling. ` +
        'Past it, graph.html silently degrades into an aggregated community blob. ' +
        'Narrow GRAPHED_DIRS before publishing.',
    );
  }
  if (nodes.length >= NODE_WARN) {
    warn(`${nodes.length} nodes - approaching the ${NODE_CEILING}-node ceiling.`);
  }

  const previous = readGraph(join(OUT_DIR, 'graph.json'));
  if (previous?.nodes?.length && !FORCE) {
    const ratio = nodes.length / previous.nodes.length;
    if (ratio < SHRINK_TOLERANCE) {
      fail(
        `graph shrank from ${previous.nodes.length} to ${nodes.length} nodes ` +
          `(${Math.round(ratio * 100)}%). If that is a real deletion, re-run with --force.`,
      );
    }
  }

  return { nodes: nodes.length, edges: edges.length };
}

function summarise(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const composition = new Map();
  for (const node of graph.nodes) {
    const dir = topDir(node.source_file);
    if (dir) composition.set(dir, (composition.get(dir) ?? 0) + 1);
  }

  const degree = new Map();
  for (const edge of edgesOf(graph)) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const hubs = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, deg]) => `${byId.get(id)?.label ?? id} (${deg})`);

  log('composition:', [...composition].map(([d, c]) => `${d}=${c}`).join('  '));
  log('hubs:', hubs.join(', '));
}

function build() {
  const started = Date.now();
  cleanIntermediates();

  // --code-only is load-bearing, not a speed flag: it keeps every doc in this
  // repo off a third-party LLM. --no-cluster here so that clustering runs as an
  // explicit, LLM-free step below.
  graphify('extracting', ['extract', '.', '--code-only', '--no-cluster', '--out', BUILD_DIR]);

  const stagedGraph = join(STAGED_OUT, 'graph.json');
  const graph = readGraph(stagedGraph);
  const counts = validate(graph);
  log(`staged graph passed checks - ${counts.nodes} nodes, ${counts.edges} edges`);

  // --no-label keeps "Community N" placeholders instead of calling an LLM to
  // name them. Naming communities would ship code structure off the machine.
  graphify('clustering', ['cluster-only', BUILD_DIR, '--no-label']);
  graphify('exporting obsidian vault', [
    'export',
    'obsidian',
    '--graph',
    stagedGraph,
    '--dir',
    join(STAGED_OUT, 'obsidian'),
  ]);

  for (const artifact of ['graph.json', 'graph.html', 'GRAPH_REPORT.md', 'obsidian']) {
    if (!existsSync(join(STAGED_OUT, artifact))) fail(`build produced no ${artifact}`);
  }

  // Swap last, so a failure anywhere above leaves the previous graph in place.
  // The window between the two renames is the one moment no graph is published,
  // so if the second fails the first is rolled back rather than left undone.
  const retired = join(REPO_ROOT, 'graphify-out.previous');
  rmSync(retired, { recursive: true, force: true });
  let movedAside = false;
  if (existsSync(OUT_DIR)) {
    renameWithRetry(OUT_DIR, retired);
    movedAside = true;
  }
  try {
    renameWithRetry(STAGED_OUT, OUT_DIR);
  } catch (err) {
    if (movedAside) {
      try {
        renameWithRetry(retired, OUT_DIR);
        warn('could not publish the new graph; restored the previous one.');
      } catch {
        console.error(
          `[graph] the previous graph is at ${retired} - rename it back to graphify-out/`,
        );
      }
    }
    throw err;
  }
  rmSync(retired, { recursive: true, force: true });

  cleanIntermediates();
  summarise(readGraph(join(OUT_DIR, 'graph.json')) ?? graph);
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s -> graphify-out/`);
}

/**
 * Debounce on IDLE, not on a throttle. A rebuild costs ~15s; saving every few
 * seconds queues rebuilds faster than they drain. Waiting for quiet also means
 * what gets graphed is the code you stopped to think about, rather than every
 * keystroke on the way there.
 */
function watchMode() {
  let timer = null;
  let building = false;
  let queued = false;

  const idle = () => log(`watching ${GRAPHED_DIRS.join(', ')} - rebuild after ${IDLE_MS / 1000}s idle`);

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, IDLE_MS);
  };

  function rebuild() {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      build();
    } catch (err) {
      warn('rebuild failed:', err.message);
    } finally {
      building = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
    idle();
  }

  for (const dir of GRAPHED_DIRS) {
    const target = join(REPO_ROOT, dir);
    if (!existsSync(target)) continue;
    watch(target, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const name = String(filename).replace(/\\/g, '/');
      if (name.includes('node_modules/') || name.includes('data/')) return;
      if (!CODE_EXTENSIONS.some((ext) => name.endsWith(ext))) return;
      schedule();
    });
  }

  idle();
  log('building once now...');
  rebuild();
}

if (WATCH) watchMode();
else build();
