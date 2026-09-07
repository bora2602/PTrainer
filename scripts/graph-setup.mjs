#!/usr/bin/env node
/**
 * Set up (and health-check) the code knowledge graph on this machine.
 *
 *   pnpm --dir app run graph:setup    - install what is missing, wire the hooks,
 *                                       build the graph if it is not there yet
 *   pnpm --dir app run graph:check    - report only, exit 1 if anything is wrong
 *
 * Run this after cloning. Most of the graph tooling is committed, but three
 * things cannot be: the graph itself (generated, gitignored), the Python
 * packages it needs, and the git hooks - .git/ is never pushed, so a fresh
 * clone has no hooks at all until core.hooksPath is pointed at .githooks/.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython, graphifyArgs } from './graph-python.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'graphify-out');
const HOOKS_DIR = '.githooks';

const CHECK_ONLY = process.argv.includes('--check');

let problems = 0;
let fixed = 0;

const pass = (m, detail) => console.log(`  ok    ${m}${detail ? ` - ${detail}` : ''}`);
const warn = (m, detail) => console.log(`  warn  ${m}${detail ? ` - ${detail}` : ''}`);
const bad = (m, detail) => {
  problems++;
  console.log(`  FAIL  ${m}${detail ? ` - ${detail}` : ''}`);
};
const didFix = (m) => {
  fixed++;
  console.log(`  fixed ${m}`);
};

function run(cmd, argv, opts = {}) {
  return spawnSync(cmd, argv, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
}

function git(...argv) {
  return run('git', argv);
}

console.log('\nCode knowledge graph - environment check\n');

// ---------------------------------------------------------------- interpreter
const python = findPython();
if (!python) {
  bad('Python not found', 'install Python 3, then re-run');
} else {
  const ver = run(python.cmd, [...python.prefixArgs, '--version']).stdout?.trim();
  pass(`Python (${python.display})`, ver);
}

// ------------------------------------------------------------------- graphify
let graphifyOk = false;
if (python) {
  const res = run(python.cmd, graphifyArgs(python, ['--version']));
  if (res.status === 0) {
    graphifyOk = true;
    pass('graphify', res.stdout?.trim());
  } else if (CHECK_ONLY) {
    bad('graphify not installed', 'pip install "graphifyy[sql]"');
  } else {
    console.log('  ...   installing graphifyy[sql]');
    const install = run(python.cmd, [
      ...python.prefixArgs,
      '-m',
      'pip',
      'install',
      'graphifyy[sql]',
    ], { stdio: 'inherit' });
    if (install.status === 0) {
      graphifyOk = true;
      didFix('installed graphifyy[sql]');
    } else {
      bad('could not install graphifyy', 'run: pip install "graphifyy[sql]"');
    }
  }
}

// --------------------------------------------------------------- SQL grammar
// Without this the 18 migrations extract to nothing and graphify only warns,
// so the data model silently leaves the graph.
if (graphifyOk && python) {
  const res = run(python.cmd, [...python.prefixArgs, '-c', 'import tree_sitter_sql']);
  if (res.status === 0) {
    pass('tree-sitter SQL grammar', 'migrations will be graphed');
  } else if (CHECK_ONLY) {
    bad('SQL grammar missing', 'migrations would be dropped - pip install "graphifyy[sql]"');
  } else {
    console.log('  ...   installing the SQL grammar');
    const install = run(python.cmd, [
      ...python.prefixArgs,
      '-m',
      'pip',
      'install',
      'graphifyy[sql]',
    ], { stdio: 'inherit' });
    if (install.status === 0) didFix('installed the SQL grammar');
    else bad('SQL grammar missing', 'pip install "graphifyy[sql]"');
  }
}

// ------------------------------------------------------------------ git hooks
const insideRepo = git('rev-parse', '--is-inside-work-tree').status === 0;
if (!insideRepo) {
  warn('not a git repository', 'hooks skipped');
} else {
  const current = git('config', '--get', 'core.hooksPath').stdout?.trim();
  if (current === HOOKS_DIR) {
    pass('git hooks', `core.hooksPath -> ${HOOKS_DIR}`);
  } else if (CHECK_ONLY) {
    bad(
      'git hooks not wired',
      `core.hooksPath is ${current || 'unset'} - run: pnpm --dir app run graph:setup`,
    );
  } else {
    const res = git('config', 'core.hooksPath', HOOKS_DIR);
    if (res.status === 0) didFix(`pointed core.hooksPath at ${HOOKS_DIR}`);
    else bad('could not set core.hooksPath');
  }

  for (const hook of ['post-commit', 'post-checkout']) {
    if (existsSync(join(REPO_ROOT, HOOKS_DIR, hook))) pass(`${HOOKS_DIR}/${hook}`, 'present');
    else bad(`${HOOKS_DIR}/${hook}`, 'missing from the repo');
  }
}

// ---------------------------------------------------------------- the graph
function graphState() {
  const file = join(OUT_DIR, 'graph.json');
  if (!existsSync(file)) return null;
  try {
    const g = JSON.parse(readFileSync(file, 'utf8'));
    return {
      nodes: g.nodes?.length ?? 0,
      builtAt: g.built_at_commit,
      sql: (g.nodes ?? []).filter((n) => String(n.source_file ?? '').endsWith('.sql')).length,
    };
  } catch {
    return null;
  }
}

let state = graphState();
if (!state) {
  if (CHECK_ONLY) {
    bad('no graph built', 'run: pnpm --dir app run graph');
  } else if (graphifyOk) {
    console.log('  ...   building the graph for the first time (~10s)');
    const res = run('node', [join(REPO_ROOT, 'scripts', 'graph-build.mjs')], { stdio: 'inherit' });
    if (res.status === 0) {
      didFix('built the graph');
      state = graphState();
    } else {
      bad('first build failed', 'see the output above');
    }
  } else {
    bad('no graph built', 'fix the errors above first');
  }
}

if (state) {
  pass('graph', `${state.nodes} nodes, ${state.sql} from SQL migrations`);
  const head = git('rev-parse', 'HEAD').stdout?.trim();
  if (state.builtAt && head && state.builtAt !== head) {
    warn('graph is stale', `built at ${state.builtAt.slice(0, 7)}, HEAD is ${head.slice(0, 7)}`);
  } else if (state.builtAt) {
    pass('graph is current', `built at ${state.builtAt.slice(0, 7)}`);
  }
  if (state.sql === 0) {
    bad('graph has no SQL nodes', 'the migrations were dropped - install the SQL grammar');
  }
}

// ------------------------------------------------------------------- verdict
console.log('');
if (problems > 0) {
  console.log(`${problems} problem(s) found. Fix the FAIL lines above, then re-run.\n`);
  process.exit(1);
}
console.log(
  fixed > 0
    ? `Ready (${fixed} thing(s) set up). Try: ${queryHint()}\n`
    : `All good. Try: ${queryHint()}\n`,
);

function queryHint() {
  const p = python ? python.display : 'python3';
  return `${p} -m graphify explain "accessibleTrainee"`;
}
