import { createClient, type Client, type InValue } from "@libsql/client";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

export const db: Client = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${path.join(DATA_DIR, "app.db")}` });

if (!TURSO_URL) {
  console.warn(
    "[db] TURSO_DATABASE_URL is not set — using a local SQLite file. On hosts without a persistent " +
      "disk (e.g. a default Render web service), this file resets on every restart or redeploy, wiping " +
      "all data. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (e.g. from a free Turso database) in " +
      "production so data survives restarts."
  );
}

/** Fetch a single row, or undefined if none matched. */
export async function dbGet<T = any>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  const result = await db.execute({ sql, args });
  return result.rows[0] as unknown as T | undefined;
}

/** Fetch all matching rows. */
export async function dbAll<T = any>(sql: string, args: InValue[] = []): Promise<T[]> {
  const result = await db.execute({ sql, args });
  return result.rows as unknown as T[];
}

/** Run an INSERT/UPDATE/DELETE statement. */
export async function dbRun(sql: string, args: InValue[] = []): Promise<void> {
  await db.execute({ sql, args });
}

async function tableColumns(table: string): Promise<Array<{ name: string }>> {
  return dbAll<{ name: string }>(`PRAGMA table_info(${table})`);
}

export async function initDb(): Promise<void> {
  await db.executeMultiple(`
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

  let existingColumns = await tableColumns("users");

  if (!existingColumns.some((col) => col.name === "avatar")) {
    await db.executeMultiple("ALTER TABLE users ADD COLUMN avatar TEXT;");
    existingColumns = await tableColumns("users");
  }

  // password_hash was originally NOT NULL and there was no google_id column — SQLite can't
  // drop a NOT NULL constraint in place, so rebuild the table for databases created before
  // Google Sign-In support was added.
  if (!existingColumns.some((col) => col.name === "google_id")) {
    await db.executeMultiple(`
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
      await db.executeMultiple(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
      existingColumns = await tableColumns("users");
    }
  }

  if (!existingColumns.some((c) => c.name === "reviewer_available")) {
    await db.executeMultiple("ALTER TABLE users ADD COLUMN reviewer_available INTEGER NOT NULL DEFAULT 0;");
    existingColumns = await tableColumns("users");
  }

  // Real tracked activity: submissions, peer reviews, reviewer volunteering, and
  // conference registrations — replaces the earlier client-only mock/placeholder data.
  await db.executeMultiple(`
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

    CREATE TABLE IF NOT EXISTS app_secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS sponsorship_packages (
      id TEXT PRIMARY KEY,
      conference_id TEXT NOT NULL,
      conference_title TEXT NOT NULL,
      organizer_id TEXT NOT NULL REFERENCES users(id),
      tier TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      benefits TEXT NOT NULL DEFAULT '[]',
      booth_space TEXT,
      speaking_ops TEXT,
      total_slots INTEGER NOT NULL DEFAULT 1,
      source_opportunity_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sponsorship_applications (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL REFERENCES sponsorship_packages(id),
      sponsor_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT,
      UNIQUE(package_id, sponsor_id)
    );

    CREATE TABLE IF NOT EXISTS sponsor_reviews (
      id TEXT PRIMARY KEY,
      sponsor_id TEXT NOT NULL REFERENCES users(id),
      organizer_id TEXT NOT NULL REFERENCES users(id),
      conference_title TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id),
      author_name TEXT NOT NULL,
      author_title TEXT,
      author_org TEXT,
      author_avatar TEXT,
      author_user_id TEXT REFERENCES users(id),
      content TEXT NOT NULL,
      post_type TEXT NOT NULL DEFAULT 'announcement',
      conference_id TEXT,
      conference_title TEXT,
      celebration_kind TEXT,
      celebration_headline TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_reactions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      reaction TEXT NOT NULL CHECK(reaction IN ('like', 'celebrate', 'insightful', 'kudos')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id),
      author_id TEXT NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_reposts (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_saves (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id)
    );
  `);

  const submissionColumns = await tableColumns("submissions");
  if (!submissionColumns.some((c) => c.name === "revisions_count")) {
    await db.executeMultiple("ALTER TABLE submissions ADD COLUMN revisions_count INTEGER NOT NULL DEFAULT 0;");
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
  reviewer_available: number;
  created_at: string;
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

export interface SponsorshipPackageRow {
  id: string;
  conference_id: string;
  conference_title: string;
  organizer_id: string;
  tier: string;
  price: number;
  benefits: string;
  booth_space: string | null;
  speaking_ops: string | null;
  total_slots: number;
  source_opportunity_id: string | null;
  created_at: string;
}

export interface SponsorshipApplicationRow {
  id: string;
  package_id: string;
  sponsor_id: string;
  status: "Pending" | "Approved" | "Rejected";
  created_at: string;
  decided_at: string | null;
}

export interface SponsorReviewRow {
  id: string;
  sponsor_id: string;
  organizer_id: string;
  conference_title: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface PostRow {
  id: string;
  author_id: string;
  author_name: string;
  author_title: string | null;
  author_org: string | null;
  author_avatar: string | null;
  author_user_id: string | null;
  content: string;
  post_type: string;
  conference_id: string | null;
  conference_title: string | null;
  celebration_kind: string | null;
  celebration_headline: string | null;
  created_at: string;
}

export interface PostReactionRow {
  id: string;
  post_id: string;
  user_id: string;
  reaction: "like" | "celebrate" | "insightful" | "kudos";
  created_at: string;
}

export interface PostCommentRow {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  created_at: string;
}

export interface PostRepostRow {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
}

export interface PostSaveRow {
  id: string;
  post_id: string;
  user_id: string;
  created_at: string;
}
