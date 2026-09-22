import { createClient } from '@libsql/client';
import path from 'node:path';

const isTest = process.env.NODE_ENV === 'test';
const testDatabasePath = process.env.TEST_DATABASE_PATH?.trim();
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (isTest && !testDatabasePath) throw new Error('NODE_ENV=test requires TEST_DATABASE_PATH for growth schema.');
if (isTest && (tursoUrl || tursoAuthToken)) throw new Error('Refusing growth schema tests with production Turso credentials.');

const db = isTest
  ? createClient({ url: `file:${path.resolve(testDatabasePath)}` })
  : tursoUrl
    ? createClient({ url: tursoUrl, authToken: tursoAuthToken })
    : createClient({ url: `file:${path.resolve('data/app.db')}` });

try {
  const usersTable = await db.execute("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1");
  if (!usersTable.rows[0]) {
    console.log(JSON.stringify({ growthSchema: 'skipped', reason: 'users table not initialized yet' }));
    process.exitCode = 0;
  } else {
    await db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS account_acquisition (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        role TEXT NOT NULL CHECK(role IN ('organizer','sponsor')),
        source TEXT NOT NULL,
        medium TEXT,
        campaign TEXT,
        content TEXT,
        term TEXT,
        referral_code TEXT,
        landing_path TEXT,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_account_acquisition_source ON account_acquisition(source,role);
      CREATE INDEX IF NOT EXISTS idx_account_acquisition_campaign ON account_acquisition(campaign,role);

      CREATE TABLE IF NOT EXISTS subscription_status_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK(role IN ('organizer','sponsor')),
        from_status TEXT,
        to_status TEXT NOT NULL,
        provider TEXT,
        plan TEXT,
        period_end TEXT,
        reason TEXT NOT NULL DEFAULT 'status_change',
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_subscription_history_user ON subscription_status_history(user_id,changed_at);
      CREATE INDEX IF NOT EXISTS idx_subscription_history_transition ON subscription_status_history(to_status,changed_at);

      CREATE TABLE IF NOT EXISTS growth_schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO growth_schema_meta(key,value)
        VALUES('subscription_history_started_at',datetime('now'));

      CREATE TRIGGER IF NOT EXISTS trg_users_subscription_status_history
      AFTER UPDATE OF subscription_status ON users
      WHEN NEW.role IN ('organizer','sponsor')
       AND COALESCE(OLD.subscription_status,'') <> COALESCE(NEW.subscription_status,'')
      BEGIN
        INSERT INTO subscription_status_history(
          id,user_id,role,from_status,to_status,provider,plan,period_end,reason
        ) VALUES(
          'gsh_' || lower(hex(randomblob(16))),
          NEW.id,
          NEW.role,
          OLD.subscription_status,
          NEW.subscription_status,
          NEW.subscription_provider,
          NEW.subscription_plan,
          NEW.subscription_period_end,
          'status_change'
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_users_subscription_period_history
      AFTER UPDATE OF subscription_period_end ON users
      WHEN NEW.role IN ('organizer','sponsor')
       AND NEW.subscription_status IN ('active','trialing')
       AND COALESCE(OLD.subscription_period_end,'') <> COALESCE(NEW.subscription_period_end,'')
       AND COALESCE(OLD.subscription_status,'') = COALESCE(NEW.subscription_status,'')
      BEGIN
        INSERT INTO subscription_status_history(
          id,user_id,role,from_status,to_status,provider,plan,period_end,reason
        ) VALUES(
          'gsh_' || lower(hex(randomblob(16))),
          NEW.id,
          NEW.role,
          OLD.subscription_status,
          NEW.subscription_status,
          NEW.subscription_provider,
          NEW.subscription_plan,
          NEW.subscription_period_end,
          'period_end_changed'
        );
      END;
    `);

    await db.execute(`
      INSERT INTO subscription_status_history(
        id,user_id,role,from_status,to_status,provider,plan,period_end,reason,changed_at
      )
      SELECT 'gsh_' || lower(hex(randomblob(16))),
             u.id,u.role,NULL,u.subscription_status,u.subscription_provider,u.subscription_plan,
             u.subscription_period_end,'baseline_observed_state',datetime('now')
        FROM users u
       WHERE u.role IN ('organizer','sponsor')
         AND u.subscription_status IN ('active','trialing','past_due','canceled')
         AND NOT EXISTS (
           SELECT 1 FROM subscription_status_history h WHERE h.user_id=u.id
         )
    `);

    const meta = await db.execute("SELECT value FROM growth_schema_meta WHERE key='subscription_history_started_at'");
    const history = await db.execute('SELECT COUNT(*) AS count FROM subscription_status_history');
    console.log(JSON.stringify({
      growthSchema: 'ready',
      subscriptionHistoryStartedAt: meta.rows[0]?.value || null,
      observedHistoryRows: Number(history.rows[0]?.count || 0),
    }));
  }
} finally {
  db.close();
}
