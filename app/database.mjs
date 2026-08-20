import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
let client;
let mode;

function normalizeResult(result) {
  const rows = result.rows || [];
  const rowCount = rows.length || result.affectedRows || result.rowCount || 0;
  return { rows, rowCount };
}

export async function initializeDatabase() {
  if (client) return { mode };
  if (process.env.DATABASE_URL) {
    client = new pg.Pool({ connectionString:process.env.DATABASE_URL, max:8, idleTimeoutMillis:30000, connectionTimeoutMillis:5000 });
    await client.query('SELECT 1'); mode = 'postgresql';
  } else {
    const dataDir = join(root, 'data', 'ptrainer-pgdata');
    await mkdir(dirname(dataDir), { recursive:true });
    client = await PGlite.create(dataDir); mode = 'pglite-postgresql';
  }
  await migrate();
  return { mode };
}

async function migrate() {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const migrationsDir = join(root, 'migrations');
  const files = (await readdir(migrationsDir)).filter(name => name.endsWith('.sql')).sort();
  for (const name of files) {
    const existing = await query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;
    const sql = await readFile(join(migrationsDir, name), 'utf8');
    if (mode === 'postgresql') await client.query(sql); else await client.exec(sql);
    await query('INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    console.log(`Applied database migration ${name}`);
  }
}

export async function query(text, params = []) {
  return normalizeResult(await client.query(text, params));
}

export async function transaction(callback) {
  if (mode === 'postgresql') {
    const connection = await client.connect();
    try {
      await connection.query('BEGIN');
      const result = await callback((text, params = []) => connection.query(text, params).then(normalizeResult));
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  return client.transaction(async connection => callback((text, params = []) => connection.query(text, params).then(normalizeResult)));
}

export function databaseMode() { return mode; }

export async function closeDatabase() {
  if (!client) return;
  if (mode === 'postgresql') await client.end();
  else await client.close();
  client = undefined;
  mode = undefined;
}
