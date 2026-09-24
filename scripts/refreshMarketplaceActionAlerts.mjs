import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = path.resolve(
  process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')
);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = createClient({ url: 'file:' + dbPath });

function n(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function one(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows?.[0] || null;
}

async function all(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows || [];
}

async function ensureTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS marketplace_nudge_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('organizer','sponsor')),
    action_key TEXT NOT NULL,
    entity_key TEXT NOT NULL DEFAULT 'account',
    summary TEXT NOT NULL,
    notified_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, role, action_key, entity_key)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_marketplace_nudge_events_account
    ON marketplace_nudge_events(account_id, role, notified_at)`);
}

async function recipients(accountId, role) {
  const result = await db.execute({
    sql: `SELECT ? AS user_id
           UNION
           SELECT m.user_id
             FROM account_workspace_members m
             JOIN account_workspaces w ON w.id=m.workspace_id
            WHERE w.owner_id=?
              AND w.account_role=?
              AND m.status='active'
              AND m.member_role IN ('owner','admin','member')`,
    args: [accountId, accountId, role],
  }).catch(() => ({ rows: [{ user_id: accountId }] }));
  return [...new Set((result.rows || []).map((row) => String(row.user_id)).filter(Boolean))];
}

async function nudge({
  accountId,
  role,
  actionKey,
  entityKey = 'account',
  title,
  summary,
  cooldownHours = 72,
}) {
  const existing = await one(
    `SELECT (julianday('now')-julianday(notified_at))*24.0 AS age_hours
       FROM marketplace_nudge_events
      WHERE account_id=? AND role=? AND action_key=? AND entity_key=?`,
    [accountId, role, actionKey, entityKey]
  );
  if (existing && n(existing.age_hours) < cooldownHours) return false;

  const userIds = await recipients(accountId, role);
  for (const userId of userIds) {
    await db.execute({
      sql: `INSERT INTO notifications(id,user_id,type,title,message)
            VALUES(?,?,'sponsorship',?,?)`,
      args: [`ntf_${crypto.randomUUID()}`, userId, title, summary],
    });
  }

  await db.execute({
    sql: `INSERT INTO marketplace_nudge_events(
            id,account_id,role,action_key,entity_key,summary,notified_at
          ) VALUES(?,?,?,?,?,?,datetime('now'))
          ON CONFLICT(account_id,role,action_key,entity_key)
          DO UPDATE SET summary=excluded.summary,notified_at=datetime('now')`,
    args: [
      `mne_${crypto.randomUUID()}`,
      accountId,
      role,
      actionKey,
      entityKey,
      summary,
    ],
  });
  return true;
}

async function organizerNudges(accountId) {
  let emitted = 0;

  const inquiry = await one(
    `SELECT i.id,n.title,n.conference_title,
            CAST(julianday('now')-julianday(i.created_at) AS INTEGER) AS age_days
       FROM sponsorship_need_inquiries i
       JOIN sponsorship_needs n ON n.id=i.need_id
      WHERE n.organizer_id=?
        AND i.status IN ('new','contacted')
        AND i.created_at<=datetime('now','-2 days')
      ORDER BY i.created_at ASC
      LIMIT 1`,
    [accountId]
  );
  if (inquiry) {
    emitted += await nudge({
      accountId,
      role: 'organizer',
      actionKey: 'respond_to_sponsor_inquiry',
      entityKey: String(inquiry.id),
      title: 'Sponsor inquiry needs follow-up',
      summary: `A Sponsor inquiry for ${String(inquiry.title || inquiry.conference_title || 'your sponsorship opportunity')} has been waiting ${n(inquiry.age_days)} days. Open Organizer Pro and respond or advance it.`,
      cooldownHours: 72,
    }) ? 1 : 0;
  }

  const deal = await one(
    `SELECT id,opportunity_title,conference_title,
            CAST(julianday('now')-julianday(updated_at) AS INTEGER) AS age_days
       FROM sponsorship_deals
      WHERE organizer_id=?
        AND status NOT IN ('completed','canceled')
        AND updated_at<=datetime('now','-5 days')
      ORDER BY updated_at ASC
      LIMIT 1`,
    [accountId]
  );
  if (deal) {
    emitted += await nudge({
      accountId,
      role: 'organizer',
      actionKey: 'advance_stalled_deal',
      entityKey: String(deal.id),
      title: 'Deal Room has stalled',
      summary: `${String(deal.opportunity_title || deal.conference_title || 'A sponsorship Deal Room')} has had no recorded update for ${n(deal.age_days)} days.`,
      cooldownHours: 72,
    }) ? 1 : 0;
  }

  const inventoryGap = await one(
    `SELECT
        (SELECT COUNT(*) FROM created_conferences c
          WHERE c.organizer_id=? AND c.created_at<=datetime('now','-1 day')) AS conferences,
        (SELECT COUNT(*) FROM sponsorship_needs n
          WHERE n.organizer_id=? AND n.status='active'
            AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))) AS active_needs`,
    [accountId, accountId]
  );
  if (n(inventoryGap?.conferences) > 0 && n(inventoryGap?.active_needs) === 0) {
    emitted += await nudge({
      accountId,
      role: 'organizer',
      actionKey: 'publish_sponsorship_inventory',
      title: 'Your conference has no active sponsorship inventory',
      summary: 'Publish at least one sponsorship need so Sponsor Pro accounts can discover and inquire about your conference.',
      cooldownHours: 168,
    }) ? 1 : 0;
  }

  return emitted;
}

async function sponsorNudges(accountId, createdAt) {
  let emitted = 0;

  const preference = await one("SELECT sponsor_id FROM sponsor_preferences WHERE sponsor_id=?", [accountId]);
  const accountAge = await one(
    "SELECT (julianday('now')-julianday(?))*24.0 AS age_hours",
    [createdAt]
  );
  if (!preference && n(accountAge?.age_hours) >= 24) {
    emitted += await nudge({
      accountId,
      role: 'sponsor',
      actionKey: 'complete_matching_preferences',
      title: 'Complete Sponsor matching preferences',
      summary: 'Add business sectors, categories, regions or opportunity types so ConferenceGate can prioritize relevant sponsorship opportunities.',
      cooldownHours: 168,
    }) ? 1 : 0;
  }

  const saved = await one(
    `SELECT s.id,s.source_id,s.title,s.conference_title,
            CAST(julianday('now')-julianday(s.created_at) AS INTEGER) AS age_days
       FROM sponsor_saved_opportunities s
      WHERE s.sponsor_id=?
        AND s.source_type='internal_need'
        AND s.created_at<=datetime('now','-3 days')
        AND NOT EXISTS(
          SELECT 1 FROM sponsorship_need_inquiries i
           WHERE i.need_id=s.source_id AND i.sponsor_id=s.sponsor_id
        )
      ORDER BY s.created_at ASC
      LIMIT 1`,
    [accountId]
  );
  if (saved) {
    emitted += await nudge({
      accountId,
      role: 'sponsor',
      actionKey: 'act_on_saved_opportunity',
      entityKey: String(saved.source_id),
      title: 'Saved sponsorship opportunity is waiting',
      summary: `${String(saved.title || saved.conference_title || 'A saved opportunity')} has been in your watchlist for ${n(saved.age_days)} days without an inquiry.`,
      cooldownHours: 72,
    }) ? 1 : 0;
  }

  const deal = await one(
    `SELECT id,opportunity_title,conference_title,
            CAST(julianday('now')-julianday(updated_at) AS INTEGER) AS age_days
       FROM sponsorship_deals
      WHERE sponsor_id=?
        AND status NOT IN ('completed','canceled')
        AND updated_at<=datetime('now','-5 days')
      ORDER BY updated_at ASC
      LIMIT 1`,
    [accountId]
  );
  if (deal) {
    emitted += await nudge({
      accountId,
      role: 'sponsor',
      actionKey: 'advance_stalled_deal',
      entityKey: String(deal.id),
      title: 'Sponsorship Deal Room needs attention',
      summary: `${String(deal.opportunity_title || deal.conference_title || 'A sponsorship Deal Room')} has had no recorded update for ${n(deal.age_days)} days.`,
      cooldownHours: 72,
    }) ? 1 : 0;
  }

  return emitted;
}

async function main() {
  try {
    await ensureTable();
    const accounts = await all(
      `SELECT id,role,created_at
         FROM users
        WHERE role IN ('organizer','sponsor')
          AND subscription_status IN ('active','trialing')
        ORDER BY created_at ASC`
    );

    let emitted = 0;
    let organizerAccounts = 0;
    let sponsorAccounts = 0;
    for (const account of accounts) {
      if (account.role === 'organizer') {
        organizerAccounts += 1;
        emitted += await organizerNudges(String(account.id));
      } else if (account.role === 'sponsor') {
        sponsorAccounts += 1;
        emitted += await sponsorNudges(String(account.id), String(account.created_at));
      }
    }

    console.log(JSON.stringify({
      marketplaceActionAlerts: 'completed',
      database: dbPath,
      organizerAccounts,
      sponsorAccounts,
      notificationsEmitted: emitted,
    }));
  } finally {
    db.close();
  }
}

await main();
