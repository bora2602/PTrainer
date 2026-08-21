export function extname(path) {
  const base = String(path).split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}
export function join(...parts) {
  return normalize(parts.filter(Boolean).join('/'));
}
export function normalize(path) {
  const isAbsolute = String(path).startsWith('/');
  const segments = [];
  for (const segment of String(path).split(/[\/]+/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (segments.length && segments.at(-1) !== '..') segments.pop(); else if (!isAbsolute) segments.push('..'); continue; }
    segments.push(segment);
  }
  return (isAbsolute ? '/' : '') + segments.join('/');
}
export function dirname(path) {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? (normalized.startsWith('/') ? '/' : '.') : normalized.slice(0, index);
}
export default { extname, join, normalize, dirname };
