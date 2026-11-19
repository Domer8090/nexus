import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nexusHome } from "./paths";

/** Local SQLite store at ~/.nexus/nexus.db. Holds metadata only: no provider credentials, ever. */

let db: DatabaseSync | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL, last_opened_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, preset TEXT NOT NULL, goal TEXT NOT NULL, brief TEXT NOT NULL, created_at TEXT NOT NULL, saved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, project_id TEXT NOT NULL, workflow_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_workflow ON sessions(workflow_id);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, id);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skill_installs (id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id TEXT NOT NULL, project_id TEXT, scope TEXT NOT NULL, agent TEXT NOT NULL, source_url TEXT, commit_sha TEXT, license TEXT, review TEXT, installed_path TEXT, action TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
`;

export function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(path.join(nexusHome(), "nexus.db"));
  db.exec(SCHEMA);
  return db;
}

export function cacheGet<T>(key: string, maxAgeMs: number): { value: T; fetchedAt: number } | null {
  const row = getDb().prepare("SELECT value, fetched_at FROM cache WHERE key = ?").get(key) as { value: string; fetched_at: number } | undefined;
  if (!row || Date.now() - row.fetched_at > maxAgeMs) return null;
  return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at };
}

export function cacheSet(key: string, value: unknown) {
  getDb().prepare("INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at").run(key, JSON.stringify(value), Date.now());
}

export function kvGet<T>(key: string): T | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function kvSet(key: string, value: unknown) {
  getDb().prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
