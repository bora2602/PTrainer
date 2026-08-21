// Minimal Buffer for the browser build. The server uses Buffer.from,
// Buffer.concat, .toString('utf8'|'hex'|'base64url') and .length only.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64Url = bytes => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = text => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export class Buffer extends Uint8Array {
  static from(value, encoding) {
    if (typeof value === 'string') {
      if (encoding === 'hex') {
        const bytes = new Uint8Array(Math.floor(value.length / 2));
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.substr(i * 2, 2), 16);
        return new Buffer(bytes);
      }
      if (encoding === 'base64url' || encoding === 'base64') return new Buffer(fromBase64Url(value));
      return new Buffer(encoder.encode(value));
    }
    if (value instanceof ArrayBuffer) return new Buffer(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return new Buffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return new Buffer(Uint8Array.from(value || []));
  }

  static concat(list, totalLength) {
    const parts = list.map(item => item instanceof Uint8Array ? item : Buffer.from(item));
    const size = totalLength ?? parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Buffer(size);
    let offset = 0;
    for (const part of parts) {
      if (offset + part.length > size) { out.set(part.subarray(0, size - offset), offset); break; }
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  static isBuffer(value) { return value instanceof Buffer; }
  static byteLength(value) { return typeof value === 'string' ? encoder.encode(value).length : value.length; }
  static alloc(size) { return new Buffer(size); }

  toString(encoding = 'utf8') {
    if (encoding === 'hex') return Array.from(this, byte => byte.toString(16).padStart(2, '0')).join('');
    if (encoding === 'base64url' || encoding === 'base64') return toBase64Url(this);
    return decoder.decode(this);
  }
}
