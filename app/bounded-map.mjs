// A Map that cannot grow without limit.
//
// Every in-process cache in this app was an ordinary Map that only ever gained
// entries: one session per anonymous request, one rate-limit bucket per address
// and email pair, one entry per idempotency key, one per barcode. None of them
// had an eviction path, so memory growth was bounded only by how long the
// process stayed up and how much traffic reached it - which is a slow leak in
// normal use and a cheap exhaustion vector for anyone who wants one.
//
// Entries expire by age and, once the cap is reached, the least recently used
// entry is dropped. JavaScript Maps iterate in insertion order, so re-inserting
// on read is what keeps "least recently used" meaningful.
export class BoundedMap {
  #entries = new Map();
  #maxEntries;
  #ttlMs;

  constructor({ maxEntries = 10000, ttlMs = 60 * 60 * 1000 } = {}) {
    this.#maxEntries = maxEntries;
    this.#ttlMs = ttlMs;
  }

  get size() { return this.#entries.size; }

  #expired(entry) { return this.#ttlMs > 0 && Date.now() - entry.touchedAt > this.#ttlMs; }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (this.#expired(entry)) { this.#entries.delete(key); return undefined; }
    // Re-insert so this key moves to the young end of the iteration order.
    this.#entries.delete(key);
    entry.touchedAt = Date.now();
    this.#entries.set(key, entry);
    return entry.value;
  }

  has(key) { return this.get(key) !== undefined; }

  set(key, value) {
    this.#entries.delete(key);
    this.#entries.set(key, { value, touchedAt: Date.now() });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
    return this;
  }

  delete(key) { return this.#entries.delete(key); }

  clear() { this.#entries.clear(); }

  // Drops everything past its TTL. Cheap to call on a timer; the LRU cap alone
  // would keep a quiet process holding stale entries indefinitely.
  prune() {
    let removed = 0;
    for (const [key, entry] of this.#entries) {
      if (this.#expired(entry)) { this.#entries.delete(key); removed += 1; }
    }
    return removed;
  }

  *entries() {
    for (const [key, entry] of this.#entries) {
      if (!this.#expired(entry)) yield [key, entry.value];
    }
  }

  [Symbol.iterator]() { return this.entries(); }

  values() {
    return [...this.entries()].map(([, value]) => value);
  }

  keys() {
    return [...this.entries()].map(([key]) => key);
  }
}
