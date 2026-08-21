// Static assets are served by the host, so the server's file reads never run.
const missing = path => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
export async function readFile(path) { throw missing(path); }
export async function stat(path) { throw missing(path); }
export async function readdir(path) { throw missing(path); }
export async function mkdir() { return undefined; }
export default { readFile, stat, readdir, mkdir };
