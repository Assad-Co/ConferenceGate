import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function safe(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function materialView(sourceType, snapshot) {
  if (sourceType === 'internal_need') {
    return {
      status: snapshot?.status || 'unavailable',
      priceAmount: snapshot?.priceAmount ?? null,
      priceOnRequest: Boolean(snapshot?.priceOnRequest),
      deadline: snapshot?.deadline || null,
      totalSlots: Number(snapshot?.totalSlots || 0),
      title: snapshot?.title || null,
    };
  }
  if (sourceType === 'package') {
    return {
      status: snapshot?.status || 'available',
      price: snapshot?.price ?? null,
      availableSlots: Number(snapshot?.availableSlots ?? 0),
      totalSlots: Number(snapshot?.totalSlots ?? 0),
      tier: snapshot?.tier || null,
    };
  }
  return {
    status: snapshot?.status || 'unavailable',
    startDate: snapshot?.startDate || null,
    actionUrl: snapshot?.actionUrl || null,
    actionLabel: snapshot?.actionLabel || null,
    hasPublishedPricing: Boolean(snapshot?.hasPublishedPricing),
    packages: Array.isArray(snapshot?.packages)
      ? snapshot.packages.map((pkg) => ({
          name: pkg?.name || null,
          priceText: pkg?.priceText ?? pkg?.price_text ?? null,
          priceAmount: pkg?.priceAmount ?? pkg?.price_amount ?? null,
          currency: pkg?.currency || null,
        }))
      : [],
  };
}

function changeSummary(sourceType, before, after, title) {
  const changes = [];
  if ((before?.status || 'unavailable') !== (after?.status || 'unavailable')) {
    changes.push(after?.status === 'available' || after?.status === 'active'
      ? 'is available again'
      : 'is no longer available');
  }

  if (sourceType === 'internal_need') {
    if ((before?.priceAmount ?? null) !== (after?.priceAmount ?? null) ||
        Boolean(before?.priceOnRequest) !== Boolean(after?.priceOnRequest)) {
      changes.push('pricing changed');
    }
    if ((before?.deadline || null) !== (after?.deadline || null)) changes.push('deadline changed');
    if (Number(before?.totalSlots || 0) !== Number(after?.totalSlots || 0)) changes.push('available inventory changed');
  } else if (sourceType === 'package') {
    if ((before?.price ?? null) !== (after?.price ?? null)) changes.push('package price changed');
    if (Number(before?.availableSlots ?? 0) !== Number(after?.availableSlots ?? 0)) changes.push('available slots changed');
  } else {
    if (Boolean(before?.hasPublishedPricing) !== Boolean(after?.hasPublishedPricing)) {
      changes.push(after?.hasPublishedPricing ? 'published pricing is now available' : 'published pricing changed');
    }
    if ((before?.actionUrl || null) !== (after?.actionUrl || null)) changes.push('official sponsorship link changed');
    if ((before?.startDate || null) !== (after?.startDate || null)) changes.push('conference date changed');
    if (JSON.stringify(before?.packages || []) !== JSON.stringify(after?.packages || [])) changes.push('official package details changed');
  }

  const detail = changes.length ? changes.slice(0, 3).join(', ') : 'saved opportunity details changed';
  return `${title}: ${detail}.`;
}

async function ensureTables(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS sponsor_watch_alert_events (
    id TEXT PRIMARY KEY,
    saved_opportunity_id TEXT NOT NULL REFERENCES sponsor_saved_opportunities(id),
    sponsor_id TEXT NOT NULL REFERENCES users(id),
    fingerprint TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(saved_opportunity_id, fingerprint)
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sponsor_watch_alert_events_saved
    ON sponsor_watch_alert_events(saved_opportunity_id, created_at)`);
}

async function currentSnapshot(db, saved) {
  const old = safe(saved.snapshot, {});

  if (saved.source_type === 'internal_need') {
    const result = await db.execute({
      sql: "SELECT * FROM sponsorship_needs WHERE id=?",
      args: [saved.source_id],
    });
    const row = result.rows?.[0];
    if (!row) return { ...old, status: 'unavailable' };
    return {
      id: String(row.id),
      conferenceId: String(row.conference_id),
      conferenceTitle: String(row.conference_title),
      organizerId: String(row.organizer_id),
      title: String(row.title),
      description: row.description ? String(row.description) : '',
      categories: safe(row.categories, []),
      targetSectors: safe(row.target_sectors, []),
      regions: safe(row.regions, []),
      opportunityTypes: safe(row.opportunity_types, []),
      priceAmount: row.price_amount === null ? null : Number(row.price_amount),
      priceOnRequest: Boolean(row.price_on_request),
      totalSlots: Number(row.total_slots || 0),
      benefits: safe(row.benefits, []),
      deadline: row.deadline ? String(row.deadline) : null,
      status: String(row.status || 'active'),
      createdAt: row.created_at ? String(row.created_at) : null,
      matchScore: old?.matchScore ?? null,
    };
  }

  if (saved.source_type === 'package') {
    const result = await db.execute({
      sql: `SELECT sp.*,
                   MAX(0, sp.total_slots - COALESCE(SUM(CASE WHEN sa.status='Approved' THEN 1 ELSE 0 END),0)) AS available_slots
              FROM sponsorship_packages sp
              LEFT JOIN sponsorship_applications sa ON sa.package_id=sp.id
             WHERE sp.id=?
             GROUP BY sp.id`,
      args: [saved.source_id],
    });
    const row = result.rows?.[0];
    if (!row) return { ...old, status: 'unavailable', availableSlots: 0 };
    return {
      id: String(row.id),
      conferenceId: String(row.conference_id),
      conferenceTitle: String(row.conference_title),
      organizerId: String(row.organizer_id),
      tier: String(row.tier),
      price: Number(row.price || 0),
      benefits: safe(row.benefits, []),
      boothSpace: row.booth_space ? String(row.booth_space) : '',
      speakingOps: row.speaking_ops ? String(row.speaking_ops) : '',
      totalSlots: Number(row.total_slots || 0),
      availableSlots: Number(row.available_slots || 0),
      sourceOpportunityId: row.source_opportunity_id ? String(row.source_opportunity_id) : null,
      status: Number(row.available_slots || 0) > 0 ? 'available' : 'unavailable',
    };
  }

  const result = await db.execute({
    sql: "SELECT * FROM discovery_sponsorship_opportunities WHERE event_id=?",
    args: [saved.source_id],
  }).catch(() => ({ rows: [] }));
  const row = result.rows?.[0];
  if (!row) return { ...old, status: 'unavailable' };
  return {
    conferenceId: String(row.event_id),
    conferenceTitle: String(row.conference_title || saved.conference_title || ''),
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    city: row.city ? String(row.city) : null,
    country: row.country ? String(row.country) : null,
    officialUrl: row.official_url ? String(row.official_url) : null,
    sponsorUrl: row.sponsor_url ? String(row.sponsor_url) : null,
    actionUrl: row.action_url ? String(row.action_url) : null,
    actionLabel: row.action_label ? String(row.action_label) : 'Inquire Now',
    hasPublishedPricing: Boolean(row.has_published_pricing),
    categories: safe(row.categories, []),
    packages: safe(row.packages, []),
    checkedAt: row.checked_at ? String(row.checked_at) : null,
    status: String(row.status || 'available'),
  };
}

async function cadenceAllows(db, sponsorId, frequency) {
  if (frequency === 'instant') return true;
  const minHours = frequency === 'weekly' ? 168 : 24;
  const result = await db.execute({
    sql: `SELECT (julianday('now') - julianday(MAX(created_at))) * 24.0 AS age_hours
            FROM sponsor_watch_alert_events
           WHERE sponsor_id=?`,
    args: [sponsorId],
  });
  const age = result.rows?.[0]?.age_hours;
  return age === null || age === undefined || Number(age) >= minHours;
}

async function notificationRecipients(db, sponsorId) {
  const result = await db.execute({
    sql: `SELECT ? AS user_id
           UNION
           SELECT m.user_id
             FROM account_workspace_members m
             JOIN account_workspaces w ON w.id=m.workspace_id
            WHERE w.owner_id=? AND w.account_role='sponsor' AND m.status='active'`,
    args: [sponsorId, sponsorId],
  }).catch(() => ({ rows: [{ user_id: sponsorId }] }));
  return [...new Set((result.rows || []).map((row) => String(row.user_id)).filter(Boolean))];
}

async function notify(db, sponsorId, title, message) {
  const recipients = await notificationRecipients(db, sponsorId);
  for (const userId of recipients) {
    await db.execute({
      sql: "INSERT INTO notifications(id,user_id,type,title,message) VALUES(?,?,'sponsorship',?,?)",
      args: [`ntf_${crypto.randomUUID()}`, userId, title, message],
    });
  }
}

async function main() {
  const localPath = path.resolve(
    process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')
  );
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const db = createClient({ url: 'file:' + localPath });

  try {
    await ensureTables(db);
    const result = await db.execute(`
      SELECT s.*, COALESCE(p.alert_frequency,'instant') AS alert_frequency
        FROM sponsor_saved_opportunities s
        LEFT JOIN sponsor_preferences p ON p.sponsor_id=s.sponsor_id
       ORDER BY s.updated_at ASC
    `);

    let checked = 0;
    let changed = 0;
    let notified = 0;
    let disabledSynced = 0;
    let cadenceDeferred = 0;
    const digestChanges = new Map();

    for (const saved of result.rows || []) {
      checked += 1;
      const before = safe(saved.snapshot, {});
      const after = await currentSnapshot(db, saved);
      const beforeMaterial = materialView(String(saved.source_type), before);
      const afterMaterial = materialView(String(saved.source_type), after);
      const beforeFingerprint = fingerprint(beforeMaterial);
      const afterFingerprint = fingerprint(afterMaterial);

      if (beforeFingerprint === afterFingerprint) continue;
      changed += 1;

      if (!Boolean(saved.alert_enabled)) {
        await db.execute({
          sql: "UPDATE sponsor_saved_opportunities SET snapshot=?,updated_at=datetime('now') WHERE id=?",
          args: [JSON.stringify(after), saved.id],
        });
        disabledSynced += 1;
        continue;
      }

      const existingEvent = await db.execute({
        sql: "SELECT id FROM sponsor_watch_alert_events WHERE saved_opportunity_id=? AND fingerprint=?",
        args: [saved.id, afterFingerprint],
      });
      if ((existingEvent.rows || []).length) {
        await db.execute({
          sql: "UPDATE sponsor_saved_opportunities SET snapshot=?,updated_at=datetime('now') WHERE id=?",
          args: [JSON.stringify(after), saved.id],
        });
        continue;
      }

      const frequency = String(saved.alert_frequency || 'instant');
      const summary = changeSummary(
        String(saved.source_type),
        beforeMaterial,
        afterMaterial,
        String(saved.conference_title || saved.title || 'Saved sponsorship opportunity')
      );

      if (frequency === 'instant') {
        await notify(db, String(saved.sponsor_id), 'Saved sponsorship opportunity updated', summary);
        await db.execute({
          sql: `INSERT OR IGNORE INTO sponsor_watch_alert_events(
                  id,saved_opportunity_id,sponsor_id,fingerprint,summary
                ) VALUES(?,?,?,?,?)`,
          args: [
            `swa_${crypto.randomUUID()}`,
            saved.id,
            saved.sponsor_id,
            afterFingerprint,
            summary,
          ],
        });
        await db.execute({
          sql: "UPDATE sponsor_saved_opportunities SET snapshot=?,updated_at=datetime('now') WHERE id=?",
          args: [JSON.stringify(after), saved.id],
        });
        notified += 1;
        continue;
      }

      const sponsorId = String(saved.sponsor_id);
      const group = digestChanges.get(sponsorId) || {
        frequency,
        changes: [],
      };
      group.changes.push({ saved, after, fingerprint: afterFingerprint, summary });
      digestChanges.set(sponsorId, group);
    }

    for (const [sponsorId, group] of digestChanges.entries()) {
      if (!(await cadenceAllows(db, sponsorId, group.frequency))) {
        cadenceDeferred += group.changes.length;
        continue;
      }

      const labels = group.changes.slice(0, 3).map((change) => change.summary.replace(/\.$/, ''));
      const extra = group.changes.length > 3 ? ` and ${group.changes.length - 3} more` : '';
      const digestMessage =
        `${group.changes.length} saved sponsorship opportunit${group.changes.length === 1 ? 'y has' : 'ies have'} changed: ` +
        labels.join('; ') + extra + '.';

      await notify(
        db,
        sponsorId,
        group.frequency === 'weekly' ? 'Weekly sponsorship watchlist update' : 'Daily sponsorship watchlist update',
        digestMessage
      );

      for (const change of group.changes) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO sponsor_watch_alert_events(
                  id,saved_opportunity_id,sponsor_id,fingerprint,summary
                ) VALUES(?,?,?,?,?)`,
          args: [
            `swa_${crypto.randomUUID()}`,
            change.saved.id,
            change.saved.sponsor_id,
            change.fingerprint,
            change.summary,
          ],
        });
        await db.execute({
          sql: "UPDATE sponsor_saved_opportunities SET snapshot=?,updated_at=datetime('now') WHERE id=?",
          args: [JSON.stringify(change.after), change.saved.id],
        });
      }
      notified += 1;
    }

    console.log(JSON.stringify({
      checked,
      changed,
      notified,
      disabledSynced,
      cadenceDeferred,
      digestAccounts: digestChanges.size,
    }));
  } finally {
    db.close();
  }
}

await main();
