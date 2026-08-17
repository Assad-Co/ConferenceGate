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

if (!existingColumns.some((c) => c.name === "reviewer_available")) {
  db.exec("ALTER TABLE users ADD COLUMN reviewer_available INTEGER NOT NULL DEFAULT 0");
  existingColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
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
  reviewer_available: number;
  created_at: string;
}

// Real tracked activity: submissions, peer reviews, reviewer volunteering, and
// conference registrations — replaces the earlier client-only mock/placeholder data.
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    submitter_id TEXT NOT NULL REFERENCES users(id),
    conference_id TEXT NOT NULL,
    conference_title TEXT NOT NULL,
    title TEXT NOT NULL,
    track TEXT,
    topic TEXT,
    keywords TEXT NOT NULL DEFAULT '[]',
    abstract_text TEXT NOT NULL,
    preferred_type TEXT NOT NULL DEFAULT 'Oral',
    primary_author_name TEXT NOT NULL,
    primary_author_email TEXT NOT NULL,
    primary_author_affiliation TEXT,
    primary_author_bio TEXT,
    co_authors TEXT NOT NULL DEFAULT '[]',
    conflict_of_interest TEXT,
    status TEXT NOT NULL DEFAULT 'Submitted',
    submission_date TEXT NOT NULL DEFAULT (datetime('now')),
    revisions_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS submission_revisions (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    author_id TEXT NOT NULL REFERENCES users(id),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submission_reviews (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    reviewer_id TEXT NOT NULL REFERENCES users(id),
    reviewer_name TEXT NOT NULL,
    reviewer_org TEXT,
    scores TEXT NOT NULL,
    overall_score REAL NOT NULL,
    comments_to_author TEXT NOT NULL,
    confidential_comments TEXT,
    recommendation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS review_volunteers (
    id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL REFERENCES users(id),
    opportunity_id TEXT NOT NULL,
    conference_title TEXT NOT NULL,
    topic TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(reviewer_id, opportunity_id)
  );

  CREATE TABLE IF NOT EXISTS conference_registrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    conference_id TEXT NOT NULL,
    conference_title TEXT NOT NULL,
    package_id TEXT,
    package_name TEXT,
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, conference_id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_a TEXT NOT NULL REFERENCES users(id),
    user_b TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_a, user_b)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    sender_id TEXT NOT NULL REFERENCES users(id),
    text TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conference_interactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    conference_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('saved', 'followed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, conference_id, type)
  );

  CREATE TABLE IF NOT EXISTS organizer_broadcasts (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES users(id),
    recipient_group TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS created_conferences (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES users(id),
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conference_interest_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    conference_id TEXT NOT NULL,
    conference_title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('committee_interest', 'sponsorship_inquiry')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, conference_id, kind)
  );

  CREATE TABLE IF NOT EXISTS conference_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    conference_id TEXT,
    conference_title TEXT NOT NULL,
    role TEXT NOT NULL,
    ratings TEXT NOT NULL,
    overall_score REAL NOT NULL,
    comment TEXT,
    recipient_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const submissionColumns = db.prepare("PRAGMA table_info(submissions)").all() as Array<{ name: string }>;
if (!submissionColumns.some((c) => c.name === "revisions_count")) {
  db.exec("ALTER TABLE submissions ADD COLUMN revisions_count INTEGER NOT NULL DEFAULT 0");
}

export interface SubmissionRow {
  id: string;
  submitter_id: string;
  conference_id: string;
  conference_title: string;
  title: string;
  track: string | null;
  topic: string | null;
  keywords: string;
  abstract_text: string;
  preferred_type: string;
  primary_author_name: string;
  primary_author_email: string;
  primary_author_affiliation: string | null;
  primary_author_bio: string | null;
  co_authors: string;
  conflict_of_interest: string | null;
  status: string;
  submission_date: string;
  revisions_count: number;
}

export interface SubmissionRevisionRow {
  id: string;
  submission_id: string;
  author_id: string;
  note: string;
  created_at: string;
}

export interface SubmissionReviewRow {
  id: string;
  submission_id: string;
  reviewer_id: string;
  reviewer_name: string;
  reviewer_org: string | null;
  scores: string;
  overall_score: number;
  comments_to_author: string;
  confidential_comments: string | null;
  recommendation: string;
  created_at: string;
}

export interface ReviewVolunteerRow {
  id: string;
  reviewer_id: string;
  opportunity_id: string;
  conference_title: string;
  topic: string | null;
  created_at: string;
}

export interface ConferenceRegistrationRow {
  id: string;
  user_id: string;
  conference_id: string;
  conference_title: string;
  package_id: string | null;
  package_name: string | null;
  registered_at: string;
}

export interface ConversationRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  read_at: string | null;
  created_at: string;
}

export interface ConferenceInteractionRow {
  id: string;
  user_id: string;
  conference_id: string;
  type: "saved" | "followed";
  created_at: string;
}

export interface OrganizerBroadcastRow {
  id: string;
  organizer_id: string;
  recipient_group: string;
  subject: string;
  body: string;
  created_at: string;
}

export interface CreatedConferenceRow {
  id: string;
  organizer_id: string;
  data: string;
  created_at: string;
}

export interface ConferenceInterestActionRow {
  id: string;
  user_id: string;
  conference_id: string;
  conference_title: string;
  kind: "committee_interest" | "sponsorship_inquiry";
  created_at: string;
}

export interface ConferenceFeedbackRow {
  id: string;
  user_id: string;
  conference_id: string | null;
  conference_title: string;
  role: string;
  ratings: string;
  overall_score: number;
  comment: string | null;
  recipient_email: string | null;
  created_at: string;
}
