// Browser replacement for database.mjs. Same exported API, backed by PGlite
// (PostgreSQL compiled to WebAssembly) persisted in IndexedDB. Migrations are
// fetched from the static site instead of read from disk.
import { PGlite } from './vendor/pglite/index.js';

const STORAGE = 'idb://ptrainer';
let client;
let mode;

function normalizeResult(result) {
  const rows = result.rows || [];
  const rowCount = rows.length || result.affectedRows || result.rowCount || 0;
  return { rows, rowCount };
}

export async function initializeDatabase() {
  if (client) return { mode };
  client = await PGlite.create(STORAGE);
  mode = 'pglite-browser';
  await migrate();
  return { mode };
}

async function migrate() {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const manifestUrl = new URL('./migrations/manifest.json', import.meta.url);
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Unable to load migration manifest (${response.status})`);
  const files = await response.json();
  for (const name of files) {
    const existing = await query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;
    const sqlResponse = await fetch(new URL(`./migrations/${name}`, import.meta.url));
    if (!sqlResponse.ok) throw new Error(`Unable to load migration ${name} (${sqlResponse.status})`);
    await client.exec(await sqlResponse.text());
    await query('INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    console.log(`Applied database migration ${name}`);
  }
}

export async function query(text, params = []) {
  return normalizeResult(await client.query(text, params));
}

export async function transaction(callback) {
  return client.transaction(async connection => callback((text, params = []) => connection.query(text, params).then(normalizeResult)));
}

export function databaseMode() { return mode; }

export async function closeDatabase() {
  if (!client) return;
  await client.close();
  client = undefined;
  mode = undefined;
}
