import { initializeDatabase, databaseMode } from '../database.mjs';
await initializeDatabase();
console.log(`Database ready using ${databaseMode()}`);
