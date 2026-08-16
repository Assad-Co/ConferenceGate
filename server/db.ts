import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('professional', 'organizer', 'sponsor')),
    name TEXT NOT NULL,
    organization TEXT,
    title TEXT,
    avatar TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

let existingColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;

if (!existingColumns.some((col) => col.name === "avatar")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
  existingColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
}

// password_hash was originally NOT NULL and there was no google_id column — SQLite can't
// drop a NOT NULL constraint in place, so rebuild the table for databases created before
// Google Sign-In support was added.
if (!existingColumns.some((col) => col.name === "google_id")) {
  db.exec(`
    BEGIN TRANSACTION;
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('professional', 'organizer', 'sponsor')),
      name TEXT NOT NULL,
      organization TEXT,
      title TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, email, password_hash, google_id, role, name, organization, title, avatar, created_at)
      SELECT id, email, password_hash, NULL, role, name, organization, title, avatar, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    COMMIT;
  `);
}

const PROFILE_COLUMNS = ["department", "city", "country", "bio"] as const;
for (const col of PROFILE_COLUMNS) {
  if (!existingColumns.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    existingColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  }
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  google_id: string | null;
  role: "professional" | "organizer" | "sponsor";
  name: string;
  organization: string | null;
  title: string | null;
  department: string | null;
  city: string | null;
  country: string | null;
  bio: string | null;
  avatar: string | null;
  created_at: string;
}
