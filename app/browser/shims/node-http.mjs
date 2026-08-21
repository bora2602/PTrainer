// Captures the request handler so the fetch bridge can dispatch to it in-page.
export function createServer(handler) {
  const server = {
    handler,
    listen(port, host, ready) {
      const done = typeof host === 'function' ? host : ready;
      globalThis.__ptrainerRegisterHandler?.(handler);
      if (typeof done === 'function') queueMicrotask(done);
      return server;
    },
    close(done) { if (typeof done === 'function') queueMicrotask(done); return server; }
  };
  return server;
}
export default { createServer };
