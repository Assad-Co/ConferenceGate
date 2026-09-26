import crypto from "crypto";
import { Router, type NextFunction, type Response } from "express";
import { asyncHandler } from "./asyncHandler";
import { requireAuth, type AuthedRequest } from "./auth";
import { dbAll, dbGet, dbRun } from "./db";
import {
  canAdminWorkspace,
  resolvePaidAccountContext,
  type PaidAccountContext,
  type PaidAccountRole,
} from "./workspaceAccess";

export const enterpriseRouter = Router();
export const enterpriseApiRouter = Router();

type EnterpriseScope = "portfolio:read" | "conferences:read" | "sponsorship:read";
const ALLOWED_SCOPES: EnterpriseScope[] = [
  "portfolio:read",
  "conferences:read",
  "sponsorship:read",
];

export async function initEnterpriseSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS enterprise_workspace_settings (
      workspace_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_role TEXT NOT NULL CHECK(account_role IN ('organizer','sponsor')),
      brand_name TEXT,
      logo_url TEXT,
      primary_color TEXT,
      support_email TEXT,
      custom_domain TEXT,
      sso_mode TEXT NOT NULL DEFAULT 'off' CHECK(sso_mode IN ('off','oidc')),
      sso_issuer TEXT,
      sso_client_id TEXT,
      sso_email_domain TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id,account_role)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS enterprise_api_keys (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      account_role TEXT NOT NULL CHECK(account_role IN ('organizer','sponsor')),
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    )
  `);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_enterprise_api_keys_account ON enterprise_api_keys(account_id,account_role,revoked_at)");

  await dbRun(`
    CREATE TABLE IF NOT EXISTS enterprise_api_audit (
      id TEXT PRIMARY KEY,
      api_key_id TEXT,
      account_id TEXT NOT NULL,
      account_role TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_enterprise_api_audit_account ON enterprise_api_audit(account_id,account_role,created_at)");
}

function clean(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function roleFrom(value: unknown): PaidAccountRole | undefined {
  return value === "organizer" || value === "sponsor" ? value : undefined;
}

function workspaceKey(accountId: string, role: PaidAccountRole) {
  return `${accountId}:${role}`;
}

function validColor(value: unknown): string | null {
  const candidate = clean(value, 16);
  if (!candidate) return null;
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : null;
}

function safeHttpsUrl(value: unknown): string | null {
  const candidate = clean(value, 1000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeDomain(value: unknown): string | null {
  const candidate = clean(value, 240)?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!candidate) return null;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(candidate) ? candidate : null;
}

async function contextFor(req: AuthedRequest): Promise<PaidAccountContext> {
  const requestedRole = roleFrom(req.query.role);
  const context = await resolvePaidAccountContext(req.userId!, requestedRole);
  if (!context) throw Object.assign(new Error("Organizer or Sponsor workspace required."), { status: 403 });
  if (!context.paid) throw Object.assign(new Error("Active paid workspace required."), { status: 402 });
  return context;
}

function requireEnterpriseAdmin(context: PaidAccountContext) {
  if (!canAdminWorkspace(context.workspaceRole)) {
    throw Object.assign(new Error("Workspace owner or admin permission required."), { status: 403 });
  }
}

async function settingsFor(accountId: string, role: PaidAccountRole) {
  const row = await dbGet<any>(
    "SELECT * FROM enterprise_workspace_settings WHERE account_id=? AND account_role=?",
    [accountId, role],
  );
  return {
    accountId,
    accountRole: role,
    brandName: row?.brand_name || null,
    logoUrl: row?.logo_url || null,
    primaryColor: row?.primary_color || "#1D4ED8",
    supportEmail: row?.support_email || null,
    customDomain: row?.custom_domain || null,
    sso: {
      mode: row?.sso_mode || "off",
      issuer: row?.sso_issuer || null,
      clientId: row?.sso_client_id || null,
      emailDomain: row?.sso_email_domain || null,
      loginEnabled: false,
      status:
        row?.sso_mode === "oidc" && row?.sso_issuer && row?.sso_client_id
          ? "configuration_saved_provider_activation_required"
          : "not_configured",
    },
    updatedAt: row?.updated_at || null,
  };
}

async function teamSummary(accountId: string, role: PaidAccountRole) {
  const workspace = await dbGet<any>(
    "SELECT * FROM account_workspaces WHERE owner_id=? AND account_role=? LIMIT 1",
    [accountId, role],
  );
  if (!workspace) {
    return { workspaceId: null, members: 1, admins: 1, viewers: 0, seatLimit: 1 };
  }
  const rows = await dbAll<any>(
    "SELECT member_role,COUNT(*) AS count FROM account_workspace_members WHERE workspace_id=? AND status='active' GROUP BY member_role",
    [workspace.id],
  );
  const counts = Object.fromEntries(rows.map((row) => [String(row.member_role), Number(row.count || 0)]));
  return {
    workspaceId: String(workspace.id),
    members: Object.values(counts).reduce((sum: number, value) => sum + Number(value || 0), 0),
    admins: Number(counts.owner || 0) + Number(counts.admin || 0),
    viewers: Number(counts.viewer || 0),
    seatLimit: Number(workspace.seat_limit || 1),
  };
}

export async function buildEnterprisePortfolio(accountId: string, role: PaidAccountRole) {
  await initEnterpriseSchema();
  const team = await teamSummary(accountId, role);

  if (role === "organizer") {
    const conferenceRows = await dbAll<{ id: string; data: string }>(
      "SELECT id,data FROM created_conferences WHERE organizer_id=? ORDER BY created_at DESC",
      [accountId],
    );
    const conferenceIds = conferenceRows.map((row) => row.id);
    const placeholders = conferenceIds.map(() => "?").join(",");
    const today = new Date().toISOString().slice(0, 10);
    const upcomingCount = conferenceRows.reduce((count, row) => {
      try {
        const data = JSON.parse(row.data || "{}");
        const start =
          data?.dates?.start ||
          data?.startDate ||
          data?.start_date ||
          null;
        return start && String(start).slice(0, 10) >= today ? count + 1 : count;
      } catch {
        return count;
      }
    }, 0);

    const [
      registrations,
      submissions,
      accepted,
      sponsorshipNeeds,
      inquiries,
      deals,
      completedDeals,
    ] = await Promise.all([
      conferenceIds.length
        ? dbGet<{ count: number }>(
            `SELECT COUNT(*) AS count FROM conference_registrations WHERE conference_id IN (${placeholders})`,
            conferenceIds,
          )
        : Promise.resolve({ count: 0 }),
      conferenceIds.length
        ? dbGet<{ count: number }>(
            `SELECT COUNT(*) AS count FROM submissions WHERE conference_id IN (${placeholders})`,
            conferenceIds,
          )
        : Promise.resolve({ count: 0 }),
      conferenceIds.length
        ? dbGet<{ count: number }>(
            `SELECT COUNT(*) AS count FROM submissions
              WHERE conference_id IN (${placeholders}) AND lower(COALESCE(status,''))='accepted'`,
            conferenceIds,
          )
        : Promise.resolve({ count: 0 }),
      dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsorship_needs WHERE organizer_id=?", [accountId]),
      dbGet<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM sponsorship_need_inquiries i
           JOIN sponsorship_needs n ON n.id=i.need_id
          WHERE n.organizer_id=?`,
        [accountId],
      ),
      dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsorship_deals WHERE organizer_id=?", [accountId]),
      dbGet<{ count: number }>(
        "SELECT COUNT(*) AS count FROM sponsorship_deals WHERE organizer_id=? AND status='completed'",
        [accountId],
      ),
    ]);
    return {
      role,
      team,
      conferences: {
        total: conferenceRows.length,
        upcoming: upcomingCount,
        registrations: Number(registrations?.count || 0),
        submissions: Number(submissions?.count || 0),
        accepted: Number(accepted?.count || 0),
      },
      sponsorship: {
        opportunities: Number(sponsorshipNeeds?.count || 0),
        inquiries: Number(inquiries?.count || 0),
        dealRooms: Number(deals?.count || 0),
        completedDeals: Number(completedDeals?.count || 0),
      },
    };
  }

  const [preferences, saved, inquiries, deals, completedDeals, requests, acceptedResponses] = await Promise.all([
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsor_preferences WHERE sponsor_id=?", [accountId]),
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsor_saved_opportunities WHERE sponsor_id=?", [accountId]),
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsorship_need_inquiries WHERE sponsor_id=?", [accountId]),
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsorship_deals WHERE sponsor_id=?", [accountId]),
    dbGet<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sponsorship_deals WHERE sponsor_id=? AND status='completed'",
      [accountId],
    ),
    dbGet<{ count: number }>("SELECT COUNT(*) AS count FROM sponsor_requests WHERE sponsor_id=?", [accountId]),
    dbGet<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM sponsor_request_responses r
         JOIN sponsor_requests q ON q.id=r.request_id
        WHERE q.sponsor_id=? AND r.status='accepted'`,
      [accountId],
    ),
  ]);

  return {
    role,
    team,
    sponsorship: {
      preferencesConfigured: Number(preferences?.count || 0) > 0,
      savedOpportunities: Number(saved?.count || 0),
      inquiries: Number(inquiries?.count || 0),
      dealRooms: Number(deals?.count || 0),
      completedDeals: Number(completedDeals?.count || 0),
      requests: Number(requests?.count || 0),
      acceptedOrganizerResponses: Number(acceptedResponses?.count || 0),
    },
  };
}

async function listApiKeys(accountId: string, role: PaidAccountRole) {
  const rows = await dbAll<any>(
    `SELECT id,name,key_prefix,scopes,created_at,last_used_at,revoked_at
       FROM enterprise_api_keys
      WHERE account_id=? AND account_role=?
      ORDER BY created_at DESC`,
    [accountId, role],
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    prefix: String(row.key_prefix),
    scopes: jsonArray(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

enterpriseRouter.use(requireAuth);

enterpriseRouter.get(
  "/overview",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const context = await contextFor(req);
    const [settings, portfolio, apiKeys] = await Promise.all([
      settingsFor(context.accountId, context.effectiveRole),
      buildEnterprisePortfolio(context.accountId, context.effectiveRole),
      listApiKeys(context.accountId, context.effectiveRole),
    ]);
    res.json({
      enterprise: {
        role: context.effectiveRole,
        workspaceRole: context.workspaceRole,
        canAdmin: canAdminWorkspace(context.workspaceRole),
        settings,
        portfolio,
        apiKeys,
      },
    });
  }),
);

enterpriseRouter.patch(
  "/settings",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const context = await contextFor(req);
    requireEnterpriseAdmin(context);

    const current = await settingsFor(context.accountId, context.effectiveRole);
    const brandName = req.body?.brandName === undefined ? current.brandName : clean(req.body.brandName, 180);
    const logoUrl = req.body?.logoUrl === undefined ? current.logoUrl : safeHttpsUrl(req.body.logoUrl);
    const primaryColor =
      req.body?.primaryColor === undefined ? current.primaryColor : validColor(req.body.primaryColor);
    const supportEmail =
      req.body?.supportEmail === undefined ? current.supportEmail : clean(req.body.supportEmail, 240)?.toLowerCase() || null;
    const customDomain =
      req.body?.customDomain === undefined ? current.customDomain : normalizeDomain(req.body.customDomain);
    const ssoMode =
      req.body?.sso?.mode === "oidc" ? "oidc" : req.body?.sso?.mode === "off" ? "off" : current.sso.mode;
    const ssoIssuer =
      req.body?.sso?.issuer === undefined ? current.sso.issuer : safeHttpsUrl(req.body.sso.issuer);
    const ssoClientId =
      req.body?.sso?.clientId === undefined ? current.sso.clientId : clean(req.body.sso.clientId, 300);
    const ssoEmailDomain =
      req.body?.sso?.emailDomain === undefined ? current.sso.emailDomain : normalizeDomain(req.body.sso.emailDomain);

    await dbRun(
      `INSERT INTO enterprise_workspace_settings(
         workspace_key,account_id,account_role,brand_name,logo_url,primary_color,support_email,custom_domain,
         sso_mode,sso_issuer,sso_client_id,sso_email_domain,updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(workspace_key) DO UPDATE SET
         brand_name=excluded.brand_name,
         logo_url=excluded.logo_url,
         primary_color=excluded.primary_color,
         support_email=excluded.support_email,
         custom_domain=excluded.custom_domain,
         sso_mode=excluded.sso_mode,
         sso_issuer=excluded.sso_issuer,
         sso_client_id=excluded.sso_client_id,
         sso_email_domain=excluded.sso_email_domain,
         updated_at=datetime('now')`,
      [
        workspaceKey(context.accountId, context.effectiveRole),
        context.accountId,
        context.effectiveRole,
        brandName,
        logoUrl,
        primaryColor,
        supportEmail,
        customDomain,
        ssoMode,
        ssoIssuer,
        ssoClientId,
        ssoEmailDomain,
      ],
    );

    res.json({ settings: await settingsFor(context.accountId, context.effectiveRole) });
  }),
);

enterpriseRouter.post(
  "/api-keys",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const context = await contextFor(req);
    requireEnterpriseAdmin(context);

    const name = clean(req.body?.name, 120);
    if (!name) return res.status(400).json({ error: "API key name is required." });
    const requested = Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : ["portfolio:read"];
    const scopes = [...new Set(requested.filter((scope) => ALLOWED_SCOPES.includes(scope as EnterpriseScope)))] as EnterpriseScope[];
    if (!scopes.length) return res.status(400).json({ error: "At least one supported read scope is required." });

    const raw = `cg_ent_${crypto.randomBytes(30).toString("base64url")}`;
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const id = `eak_${crypto.randomUUID()}`;
    const prefix = raw.slice(0, 16);

    await dbRun(
      `INSERT INTO enterprise_api_keys(id,account_id,account_role,name,key_prefix,key_hash,scopes,created_by)
       VALUES(?,?,?,?,?,?,?,?)`,
      [id, context.accountId, context.effectiveRole, name, prefix, hash, JSON.stringify(scopes), req.userId!],
    );

    res.status(201).json({
      apiKey: {
        id,
        name,
        key: raw,
        prefix,
        scopes,
        note: "This key is shown only once. Store it securely.",
      },
    });
  }),
);

enterpriseRouter.delete(
  "/api-keys/:id",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const context = await contextFor(req);
    requireEnterpriseAdmin(context);
    const row = await dbGet<any>(
      "SELECT * FROM enterprise_api_keys WHERE id=? AND account_id=? AND account_role=?",
      [req.params.id, context.accountId, context.effectiveRole],
    );
    if (!row) return res.status(404).json({ error: "API key not found." });
    await dbRun("UPDATE enterprise_api_keys SET revoked_at=datetime('now') WHERE id=?", [row.id]);
    res.json({ ok: true });
  }),
);

interface EnterpriseApiRequest extends AuthedRequest {
  enterpriseApiKey?: {
    id: string;
    accountId: string;
    role: PaidAccountRole;
    scopes: string[];
  };
}

async function requireEnterpriseApiKey(req: EnterpriseApiRequest, res: Response, next: NextFunction) {
  await initEnterpriseSchema();
  const supplied =
    req.get("x-conferencegate-key") ||
    (req.get("authorization")?.replace(/^Bearer\s+/i, "") || "");
  if (!supplied || !supplied.startsWith("cg_ent_")) {
    return res.status(401).json({ error: "Enterprise API key required." });
  }
  const hash = crypto.createHash("sha256").update(supplied).digest("hex");
  const row = await dbGet<any>(
    "SELECT * FROM enterprise_api_keys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1",
    [hash],
  );
  if (!row) return res.status(401).json({ error: "Invalid or revoked Enterprise API key." });

  req.enterpriseApiKey = {
    id: String(row.id),
    accountId: String(row.account_id),
    role: row.account_role === "sponsor" ? "sponsor" : "organizer",
    scopes: jsonArray(row.scopes),
  };
  await dbRun("UPDATE enterprise_api_keys SET last_used_at=datetime('now') WHERE id=?", [row.id]);
  next();
}

function requireScope(scope: EnterpriseScope) {
  return (req: EnterpriseApiRequest, res: Response, next: NextFunction) => {
    if (!req.enterpriseApiKey?.scopes.includes(scope)) {
      return res.status(403).json({ error: `API key requires scope: ${scope}` });
    }
    next();
  };
}

async function auditApi(req: EnterpriseApiRequest, action: string, detail?: Record<string, unknown>) {
  const key = req.enterpriseApiKey!;
  await dbRun(
    "INSERT INTO enterprise_api_audit(id,api_key_id,account_id,account_role,action,detail) VALUES(?,?,?,?,?,?)",
    [
      `eaa_${crypto.randomUUID()}`,
      key.id,
      key.accountId,
      key.role,
      action,
      detail ? JSON.stringify(detail) : null,
    ],
  );
}

enterpriseApiRouter.use(requireEnterpriseApiKey);

enterpriseApiRouter.get(
  "/portfolio",
  requireScope("portfolio:read"),
  asyncHandler(async (req: EnterpriseApiRequest, res: Response) => {
    const key = req.enterpriseApiKey!;
    await auditApi(req, "portfolio.read");
    res.json({
      portfolio: await buildEnterprisePortfolio(key.accountId, key.role),
      generatedAt: new Date().toISOString(),
    });
  }),
);

enterpriseApiRouter.get(
  "/conferences",
  requireScope("conferences:read"),
  asyncHandler(async (req: EnterpriseApiRequest, res: Response) => {
    const key = req.enterpriseApiKey!;
    if (key.role !== "organizer") {
      return res.status(403).json({ error: "Conference portfolio API is available to Organizer workspaces." });
    }
    const rows = await dbAll<any>(
      `SELECT id,data,created_at
         FROM created_conferences
        WHERE organizer_id=?
        ORDER BY created_at DESC
        LIMIT 500`,
      [key.accountId],
    );
    const conferences = rows.map((row) => {
      let data: any = {};
      try { data = JSON.parse(row.data || "{}"); } catch {}
      return {
        id: row.id,
        title: data.title || "",
        dates: data.dates || null,
        location: data.location || null,
        format: data.format || null,
        topics: Array.isArray(data.topics) ? data.topics : [],
        createdAt: row.created_at,
      };
    });
    await auditApi(req, "conferences.read", { count: conferences.length });
    res.json({ conferences });
  }),
);

enterpriseApiRouter.get(
  "/sponsorship",
  requireScope("sponsorship:read"),
  asyncHandler(async (req: EnterpriseApiRequest, res: Response) => {
    const key = req.enterpriseApiKey!;
    const deals = await dbAll<any>(
      `SELECT id,conference_title,opportunity_title,status,agreed_amount,updated_at
         FROM sponsorship_deals
        WHERE ${key.role === "organizer" ? "organizer_id" : "sponsor_id"}=?
        ORDER BY updated_at DESC
        LIMIT 500`,
      [key.accountId],
    );
    await auditApi(req, "sponsorship.read", { count: deals.length });
    res.json({ deals });
  }),
);
