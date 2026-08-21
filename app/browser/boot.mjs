// Starts the Ptrainer server inside the page. Globals must exist before
// server.mjs is evaluated, so the import is dynamic rather than static.
import { Buffer } from './buffer.mjs';

globalThis.Buffer = Buffer;
globalThis.process = globalThis.process || {
  env: {},
  argv: ['browser', 'ptrainer'],
  platform: 'browser',
  version: 'v24.0.0',
  on() {},
  exit() {},
  nextTick(callback, ...args) { queueMicrotask(() => callback(...args)); }
};

try {
  await import('../server.mjs');
} catch (error) {
  console.error('ptrainer_browser_boot_failed', error);
  globalThis.__ptrainerBootFailed?.(error);
}
