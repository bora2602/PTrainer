// Look inside the running database without remembering psql invocations.
//
//   node scripts/db.mjs              row counts for every table
//   node scripts/db.mjs users        accounts, roles, and status
//   node scripts/db.mjs activity     recent audit events
//   node scripts/db.mjs sql "..."    run one statement
//   node scripts/db.mjs psql         interactive session
//   node scripts/db.mjs backup       write a dump to backups/
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';

const [command = 'summary', ...rest] = process.argv.slice(2);

const QUERIES = {
  summary: `SELECT table_name AS table,
                   (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS rows
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY rows DESC, table_name;`,
  users: `SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at;`,
  activity: `SELECT created_at, actor_id, action, entity_type, entity_id FROM audit_events ORDER BY created_at DESC LIMIT 25;`
};

function psql(args) {
  return spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'ptrainer', '-d', 'ptrainer', ...args],
    { stdio: 'inherit' });
}

if (command === 'psql') {
  // Interactive needs a TTY, so -T is deliberately omitted here.
  spawn('docker', ['compose', 'exec', 'postgres', 'psql', '-U', 'ptrainer', '-d', 'ptrainer'], { stdio: 'inherit' })
    .on('exit', code => process.exit(code ?? 0));
} else if (command === 'sql') {
  const statement = rest.join(' ');
  if (!statement) { console.error('Usage: node scripts/db.mjs sql "SELECT ..."'); process.exit(1); }
  process.exit(psql(['-c', statement]).status ?? 0);
} else if (command === 'backup') {
  mkdirSync('backups', { recursive: true });
  const file = `backups/ptrainer-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
  const out = createWriteStream(file);
  const dump = spawn('docker', ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'ptrainer', '-d', 'ptrainer'], {
    stdio: ['ignore', 'pipe', 'inherit']
  });
  dump.stdout.pipe(out);
  dump.on('exit', code => {
    console.log(code === 0 ? `Wrote ${file}` : `pg_dump failed with code ${code}`);
    process.exit(code ?? 0);
  });
} else if (QUERIES[command]) {
  process.exit(psql(['-c', QUERIES[command]]).status ?? 0);
} else {
  console.error(`Unknown command: ${command}\nTry: summary, users, activity, sql, psql, backup`);
  process.exit(1);
}
