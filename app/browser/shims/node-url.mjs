// serveStatic never runs in the browser build (static files are served by the
// host), so a stable placeholder root is all the server needs.
export function fileURLToPath(url) {
  const text = String(url instanceof URL ? url.href : url);
  return text.replace(/^file:\/\//, '') || '/app/';
}
export default { fileURLToPath };
