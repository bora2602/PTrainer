/**
 * Find a Python interpreter that can run graphify.
 *
 * `python` is a Windows-ism: on most macOS and Linux setups only `python3`
 * exists, and on some Windows installs only the `py` launcher does. Hardcoding
 * any one of them means the graph build works on one machine and not the next.
 */

import { spawnSync } from 'node:child_process';

/** Candidates in preference order, with any args needed before `-m`. */
const CANDIDATES = [
  { cmd: 'python3', prefixArgs: [] },
  { cmd: 'python', prefixArgs: [] },
  { cmd: 'py', prefixArgs: ['-3'] },
];

/**
 * @returns {{cmd: string, prefixArgs: string[], display: string} | null}
 */
export function findPython() {
  for (const candidate of CANDIDATES) {
    const res = spawnSync(candidate.cmd, [...candidate.prefixArgs, '-c', 'import sys'], {
      stdio: 'ignore',
    });
    if (!res.error && res.status === 0) {
      return { ...candidate, display: [candidate.cmd, ...candidate.prefixArgs].join(' ') };
    }
  }
  return null;
}

/** Build the argv for a `graphify` subcommand under the given interpreter. */
export function graphifyArgs(python, argv) {
  return [...python.prefixArgs, '-m', 'graphify', ...argv];
}
