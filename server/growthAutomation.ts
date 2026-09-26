import crypto from "crypto";
import { dbAll, dbGet, dbRun } from "./db";

export type GrowthLeadRole = "organizer" | "sponsor";
export type GrowthLeadStage =
  | "new"
  | "contacted"
  | "qualified"
  | "invited"
  | "signup"
  | "activated"
  | "paid"
  | "lost";

const LEAD_STAGES: GrowthLeadStage[] = [
  "new",
  "contacted",
  "qualified",
  "invited",
  "signup",
  "activated",
  "paid",
  "lost",
];

export async function initGrowthAutomationSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS growth_leads (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('organizer','sponsor')),
      organization TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      website TEXT,
      source TEXT,
      campaign TEXT,
      stage TEXT NOT NULL DEFAULT 'new',
      score INTEGER NOT NULL DEFAULT 0,
      next_action TEXT,
      next_action_at TEXT,
      converted_user_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_growth_leads_role_stage ON growth_leads(role,stage)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_growth_leads_next_action ON growth_leads(next_action_at)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_growth_leads_email ON growth_leads(lower(email))");

  await dbRun(`
    CREATE TABLE IF NOT EXISTS growth_outreach_events (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(lead_id) REFERENCES growth_leads(id) ON DELETE CASCADE
    )
  `);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_growth_outreach_lead ON growth_outreach_events(lead_id,created_at)");

  await dbRun(`
    CREATE TABLE IF NOT EXISTS growth_referral_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      owner_user_id TEXT,
      role_target TEXT CHECK(role_target IN ('organizer','sponsor') OR role_target IS NULL),
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS growth_referral_conversions (
      id TEXT PRIMARY KEY,
      referral_code_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(referral_code_id,referred_user_id),
      FOREIGN KEY(referral_code_id) REFERENCES growth_referral_codes(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS growth_targets (
      key TEXT PRIMARY KEY,
      target_value REAL NOT NULL,
      label TEXT NOT NULL,
      role TEXT,
      period TEXT NOT NULL DEFAULT 'current',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const defaults = [
    ["organizer_pipeline", 10, "Qualified Organizer leads", "organizer"],
    ["sponsor_pipeline", 20, "Qualified Sponsor leads", "sponsor"],
    ["active_inventory", 10, "Active sponsorship opportunities", null],
    ["sponsor_to_inventory_ratio", 2, "Sponsors per active opportunity", null],
    ["inquiry_coverage_pct", 30, "Inventory with inquiry coverage (%)", null],
  ] as const;
  for (const [key, targetValue, label, role] of defaults) {
    await dbRun(
      "INSERT OR IGNORE INTO growth_targets(key,target_value,label,role) VALUES(?,?,?,?)",
      [key, targetValue, label, role],
    );
  }
}

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

function clean(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function stage(value: unknown): GrowthLeadStage | null {
  const candidate = String(value || "").toLowerCase() as GrowthLeadStage;
  return LEAD_STAGES.includes(candidate) ? candidate : null;
}

export async function createGrowthLead(input: {
  role: GrowthLeadRole;
  organization?: string;
  contactName?: string;
  email?: string;
  website?: string;
  source?: string;
  campaign?: string;
  score?: number;
  nextAction?: string;
  nextActionAt?: string;
  notes?: string;
}) {
  const id = `glead_${crypto.randomUUID()}`;
  await dbRun(
    `INSERT INTO growth_leads(
      id,role,organization,contact_name,email,website,source,campaign,score,next_action,next_action_at,notes
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.role,
      clean(input.organization, 240) || "",
      clean(input.contactName, 180) || "",
      clean(input.email, 240)?.toLowerCase() || "",
      clean(input.website, 500),
      clean(input.source, 120),
      clean(input.campaign, 120),
      Math.max(0, Math.min(100, Math.round(n(input.score)))),
      clean(input.nextAction, 400),
      clean(input.nextActionAt, 40),
      clean(input.notes, 1200),
    ],
  );
  return getGrowthLead(id);
}

export async function getGrowthLead(id: string) {
  return dbGet<any>("SELECT * FROM growth_leads WHERE id=?", [id]);
}

export async function updateGrowthLead(
  id: string,
  input: {
    stage?: GrowthLeadStage;
    score?: number;
    nextAction?: string | null;
    nextActionAt?: string | null;
    notes?: string | null;
    convertedUserId?: string | null;
  },
) {
  const current = await getGrowthLead(id);
  if (!current) return null;

  const nextStage = input.stage ? stage(input.stage) : current.stage;
  const scoreValue =
    input.score === undefined
      ? n(current.score)
      : Math.max(0, Math.min(100, Math.round(n(input.score))));

  await dbRun(
    `UPDATE growth_leads
        SET stage=?,score=?,next_action=?,next_action_at=?,notes=?,converted_user_id=?,updated_at=datetime('now')
      WHERE id=?`,
    [
      nextStage || current.stage,
      scoreValue,
      input.nextAction === undefined ? current.next_action : clean(input.nextAction, 400),
      input.nextActionAt === undefined ? current.next_action_at : clean(input.nextActionAt, 40),
      input.notes === undefined ? current.notes : clean(input.notes, 1200),
      input.convertedUserId === undefined ? current.converted_user_id : clean(input.convertedUserId, 120),
      id,
    ],
  );
  return getGrowthLead(id);
}

export async function addGrowthOutreachEvent(input: {
  leadId: string;
  channel: string;
  eventType: string;
  note?: string;
}) {
  const lead = await getGrowthLead(input.leadId);
  if (!lead) return null;
  const id = `gout_${crypto.randomUUID()}`;
  await dbRun(
    "INSERT INTO growth_outreach_events(id,lead_id,channel,event_type,note) VALUES(?,?,?,?,?)",
    [
      id,
      input.leadId,
      clean(input.channel, 80) || "other",
      clean(input.eventType, 80) || "note",
      clean(input.note, 800),
    ],
  );
  await dbRun(
    "UPDATE growth_leads SET updated_at=datetime('now') WHERE id=?",
    [input.leadId],
  );
  return dbGet<any>("SELECT * FROM growth_outreach_events WHERE id=?", [id]);
}

export async function createGrowthReferralCode(input: {
  ownerUserId?: string;
  roleTarget?: GrowthLeadRole;
  label?: string;
}) {
  const code = crypto.randomBytes(6).toString("base64url").toLowerCase();
  const id = `gref_${crypto.randomUUID()}`;
  await dbRun(
    "INSERT INTO growth_referral_codes(id,code,owner_user_id,role_target,label) VALUES(?,?,?,?,?)",
    [
      id,
      code,
      clean(input.ownerUserId, 120),
      input.roleTarget || null,
      clean(input.label, 180),
    ],
  );
  return dbGet<any>("SELECT * FROM growth_referral_codes WHERE id=?", [id]);
}

export async function setGrowthTarget(key: string, targetValue: number) {
  const existing = await dbGet<any>("SELECT * FROM growth_targets WHERE key=?", [key]);
  if (!existing) return null;
  await dbRun(
    "UPDATE growth_targets SET target_value=?,updated_at=datetime('now') WHERE key=?",
    [Math.max(0, n(targetValue)), key],
  );
  return dbGet<any>("SELECT * FROM growth_targets WHERE key=?", [key]);
}

export async function listGrowthLeads(limit = 100) {
  return dbAll<any>(
    `SELECT l.*,
            (SELECT COUNT(*) FROM growth_outreach_events e WHERE e.lead_id=l.id) AS outreach_count,
            (SELECT MAX(created_at) FROM growth_outreach_events e WHERE e.lead_id=l.id) AS last_outreach_at,
            COALESCE(l.converted_user_id,(
              SELECT u.id FROM users u
               WHERE l.email<>'' AND lower(u.email)=lower(l.email)
               LIMIT 1
            )) AS matched_user_id
       FROM growth_leads l
      ORDER BY
        CASE WHEN l.next_action_at IS NOT NULL AND l.next_action_at<>'' AND datetime(l.next_action_at)<=datetime('now') THEN 0 ELSE 1 END,
        l.score DESC,l.updated_at DESC
      LIMIT ?`,
    [Math.max(1, Math.min(500, Math.round(limit)))],
  );
}

export async function buildGrowthAutomationSnapshot() {
  await initGrowthAutomationSchema();

  const [leads, stages, overdue, targets, referrals, activeInventory, sponsorAccounts, inquiryInventory] =
    await Promise.all([
      listGrowthLeads(200),
      dbAll<any>(
        "SELECT role,stage,COUNT(*) AS count FROM growth_leads GROUP BY role,stage ORDER BY role,stage"
      ),
      dbGet<{ count: number }>(
        `SELECT COUNT(*) AS count FROM growth_leads
          WHERE stage NOT IN ('paid','lost')
            AND next_action_at IS NOT NULL AND next_action_at<>''
            AND datetime(next_action_at)<=datetime('now')`
      ),
      dbAll<any>("SELECT * FROM growth_targets ORDER BY key"),
      dbAll<any>(
        `SELECT c.id,c.code,c.owner_user_id,c.role_target,c.label,c.active,c.created_at,
                COUNT(v.id) AS conversions
           FROM growth_referral_codes c
           LEFT JOIN growth_referral_conversions v ON v.referral_code_id=c.id
          GROUP BY c.id
          ORDER BY c.created_at DESC
          LIMIT 100`
      ),
      dbGet<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sponsorship_needs
          WHERE status='active' AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))`
      ),
      dbGet<{ count: number }>(
        `SELECT COUNT(*) AS count FROM users u
          WHERE u.role='sponsor'
             OR EXISTS(SELECT 1 FROM sponsor_preferences p WHERE p.sponsor_id=u.id)`
      ),
      dbGet<{ count: number }>(
        `SELECT COUNT(DISTINCT n.id) AS count
           FROM sponsorship_needs n
           JOIN sponsorship_need_inquiries i ON i.need_id=n.id
          WHERE n.status='active' AND (n.deadline IS NULL OR n.deadline='' OR date(n.deadline)>=date('now'))`
      ),
    ]);

  const byRole = {
    organizer: { total: 0, qualified: 0, signup: 0, activated: 0, paid: 0 },
    sponsor: { total: 0, qualified: 0, signup: 0, activated: 0, paid: 0 },
  };

  for (const row of leads) {
    const role = row.role === "sponsor" ? "sponsor" : "organizer";
    const bucket = byRole[role];
    bucket.total += 1;
    if (["qualified","invited","signup","activated","paid"].includes(String(row.stage))) bucket.qualified += 1;
    if (["signup","activated","paid"].includes(String(row.stage)) || row.matched_user_id) bucket.signup += 1;
    if (["activated","paid"].includes(String(row.stage))) bucket.activated += 1;
    if (String(row.stage) === "paid") bucket.paid += 1;
  }

  const inventory = n(activeInventory?.count);
  const sponsors = n(sponsorAccounts?.count);
  const inquiryCovered = n(inquiryInventory?.count);
  const targetMap = Object.fromEntries(targets.map((row) => [String(row.key), n(row.target_value)]));

  const liquidity = {
    activeInventory: inventory,
    sponsorAccounts: sponsors,
    sponsorToInventoryRatio: inventory ? Math.round((sponsors / inventory) * 100) / 100 : null,
    inquiryCoveragePct: pct(inquiryCovered, inventory),
    targets: {
      organizerPipeline: targetMap.organizer_pipeline ?? 10,
      sponsorPipeline: targetMap.sponsor_pipeline ?? 20,
      activeInventory: targetMap.active_inventory ?? 10,
      sponsorToInventoryRatio: targetMap.sponsor_to_inventory_ratio ?? 2,
      inquiryCoveragePct: targetMap.inquiry_coverage_pct ?? 30,
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    leads,
    stageCounts: stages.map((row) => ({
      role: String(row.role),
      stage: String(row.stage),
      count: n(row.count),
    })),
    overdueFollowUps: n(overdue?.count),
    organizer: {
      ...byRole.organizer,
      leadToSignupPct: pct(byRole.organizer.signup, byRole.organizer.total),
      leadToPaidPct: pct(byRole.organizer.paid, byRole.organizer.total),
    },
    sponsor: {
      ...byRole.sponsor,
      leadToSignupPct: pct(byRole.sponsor.signup, byRole.sponsor.total),
      leadToPaidPct: pct(byRole.sponsor.paid, byRole.sponsor.total),
    },
    referrals,
    targets,
    liquidity,
    definitions: {
      qualifiedLead: "stage qualified or later",
      overdueFollowUp: "next action time has passed and the lead is not paid/lost",
      sponsorToInventoryRatio: "Sponsor accounts divided by active Organizer sponsorship opportunities",
      inquiryCoverage: "share of active sponsorship opportunities with at least one inquiry",
    },
  };
}
