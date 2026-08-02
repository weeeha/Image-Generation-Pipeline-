import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import fs from 'node:fs';
import path from 'node:path';

export const LIBRARY_ROOT = path.resolve(process.env.LIBRARY_ROOT ?? './library');

function create() {
  fs.mkdirSync(LIBRARY_ROOT, { recursive: true });
  const sqlite = new Database(path.join(LIBRARY_ROOT, 'library.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

const g = globalThis as unknown as { __fdsDb?: ReturnType<typeof create> };
export const db = (g.__fdsDb ??= create());
export * as tables from './schema';
