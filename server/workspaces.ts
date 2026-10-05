import { Router, Response } from "express";
import crypto from "crypto";
import { promises as dns } from "dns";
import { asyncHandler } from "./asyncHandler";
import { AuthedRequest, requireAuth } from "./auth";
import { isOwnerPreviewEmail } from "./ownerPreview";
import { discoveryFetch, isHtmlLike } from "./discovery/httpClient";
import { extractStructuredEvents } from "./discovery/structuredData";
import { extractFromHtml } from "./discovery/htmlExtract";
import { fetchRenderedHtml, isBrowserRenderingUnavailable } from "./browserFetch";
import { jinaReadPageDetailed, isJinaConfigured } from "./jinaReader";
import { isSafeExternalUrl } from "./urlSafety";
import { emptyRawExtraction, type RawEventExtraction } from "./discovery/types";
import {
  dbAll,
  dbGet,
  dbRun,
  UserRow,
  AccountWorkspaceRow,
  AccountWorkspaceMemberRow,
  AccountWorkspaceAuditRow,
} from "./db";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

function parseDetails(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function ensurePaidWorkspace(userId: string): Promise<{
  user: UserRow;
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}> {
  const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [userId]);
  if (!user || (user.role !== "organizer" && user.role !== "sponsor")) {
    throw Object.assign(new Error("Organizer or Sponsor account required."), { status: 403 });
  }

  let membership = await dbGet<AccountWorkspaceMemberRow>(
    `SELECT m.*
       FROM account_workspace_members m
       JOIN account_workspaces w ON w.id=m.workspace_id
      WHERE m.user_id=? AND m.status='active' AND w.account_role=?
      ORDER BY CASE WHEN m.member_role='owner' THEN 0 ELSE 1 END, m.created_at ASC
      LIMIT 1`,
    [userId, user.role]
  );

  if (membership) {
    const workspace = await dbGet<AccountWorkspaceRow>(
      "SELECT * FROM account_workspaces WHERE id=?",
      [membership.workspace_id]
    );
    if (!workspace) {
      throw Object.assign(new Error("Workspace not found."), { status: 404 });
    }
    const owner = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [workspace.owner_id]);
    if (!owner || !["active", "trialing"].includes(owner.subscription_status || "")) {
      throw Object.assign(new Error("The workspace owner's paid subscription is not active."), { status: 402 });
    }
    return { user, workspace, membership };
  }

  if (!["active", "trialing"].includes(user.subscription_status || "") && !isOwnerPreviewEmail(user.email)) {
    throw Object.assign(new Error("Paid workspace subscription required."), { status: 402 });
  }

  let workspace = await dbGet<AccountWorkspaceRow>(
    "SELECT * FROM account_workspaces WHERE owner_id=? AND account_role=?",
    [userId, user.role]
  );
  if (!workspace) {
    const workspaceId = `ws_${crypto.randomUUID()}`;
    const defaultName =
      user.organization?.trim() ||
      `${user.name}'s ${user.role === "organizer" ? "Organizer" : "Sponsor"} Workspace`;
    const seatLimit = Math.max(2, Math.min(1000, Number(process.env.WORKSPACE_SEAT_LIMIT || 10)));
    await dbRun(
      "INSERT INTO account_workspaces(id,owner_id,account_role,name,seat_limit) VALUES(?,?,?,?,?)",
      [workspaceId, userId, user.role, defaultName, seatLimit]
    );
    workspace = (await dbGet<AccountWorkspaceRow>("SELECT * FROM account_workspaces WHERE id=?", [workspaceId]))!;
  }

  const memberId = `wsm_${crypto.randomUUID()}`;
  await dbRun(
    "INSERT OR IGNORE INTO account_workspace_members(id,workspace_id,user_id,member_role,status) VALUES(?,?,?,'owner','active')",
    [memberId, workspace.id, userId]
  );
  membership = (await dbGet<AccountWorkspaceMemberRow>(
    "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=?",
    [workspace.id, userId]
  ))!;

  return { user, workspace, membership };
}

async function audit(
  workspaceId: string,
  actorId: string,
  action: string,
  targetUserId: string | null = null,
  details: Record<string, unknown> | null = null
) {
  await dbRun(
    "INSERT INTO account_workspace_audit(id,workspace_id,actor_id,action,target_user_id,details) VALUES(?,?,?,?,?,?)",
    [
      `wsa_${crypto.randomUUID()}`,
      workspaceId,
      actorId,
      action,
      targetUserId,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function ensureEnterpriseSettingsSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS account_workspace_enterprise_settings (
      workspace_id TEXT PRIMARY KEY,
      require_allowed_domain INTEGER NOT NULL DEFAULT 0,
      allowed_email_domains TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(workspace_id) REFERENCES account_workspaces(id) ON DELETE CASCADE
    )
  `);
}

async function ensureWorkspaceDataControlsSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS account_workspace_data_controls (
      workspace_id TEXT PRIMARY KEY,
      admins_can_manage_members INTEGER NOT NULL DEFAULT 1,
      allow_admin_exports INTEGER NOT NULL DEFAULT 1,
      audit_visibility_days INTEGER NOT NULL DEFAULT 365,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(workspace_id) REFERENCES account_workspaces(id) ON DELETE CASCADE
    )
  `);
}

function clampAuditDays(value: unknown): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 365;
  return Math.max(30, Math.min(3650, parsed));
}

async function workspaceDataControlsDTO(workspaceId: string) {
  await ensureWorkspaceDataControlsSchema();
  const row = await dbGet<any>(
    "SELECT * FROM account_workspace_data_controls WHERE workspace_id=?",
    [workspaceId]
  );
  return {
    adminsCanManageMembers: row ? Boolean(row.admins_can_manage_members) : true,
    allowAdminExports: row ? Boolean(row.allow_admin_exports) : true,
    auditVisibilityDays: clampAuditDays(row?.audit_visibility_days ?? 365),
    updatedAt: row?.updated_at || null,
  };
}

async function canManageWorkspaceMembers(context: {
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}) {
  if (context.membership.member_role === "owner") return true;
  if (context.membership.member_role !== "admin") return false;
  const controls = await workspaceDataControlsDTO(context.workspace.id);
  return controls.adminsCanManageMembers;
}

async function ensureEnterpriseDomainVerificationSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS account_workspace_domain_verifications (
      workspace_id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      token TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified')),
      verified_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(workspace_id) REFERENCES account_workspaces(id) ON DELETE CASCADE
    )
  `);
}

async function enterpriseDomainVerificationDTO(workspaceId: string) {
  await ensureEnterpriseDomainVerificationSchema();
  const row = await dbGet<any>(
    "SELECT * FROM account_workspace_domain_verifications WHERE workspace_id=?",
    [workspaceId]
  );
  if (!row) return null;
  return {
    domain: String(row.domain),
    status: row.status === "verified" ? "verified" : "pending",
    txtName: `_conferencegate.${row.domain}`,
    txtValue: `conferencegate-verification=${row.token}`,
    verifiedAt: row.verified_at || null,
    updatedAt: row.updated_at || null,
  };
}

function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/^@+/, "");
  if (!domain || domain.length > 253) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return domain;
}

async function enterpriseSettingsDTO(workspaceId: string) {
  await ensureEnterpriseSettingsSchema();
  const row = await dbGet<any>(
    "SELECT * FROM account_workspace_enterprise_settings WHERE workspace_id=?",
    [workspaceId]
  );
  let domains: string[] = [];
  if (row?.allowed_email_domains) {
    try {
      const parsed = JSON.parse(row.allowed_email_domains);
      if (Array.isArray(parsed)) domains = parsed.map(String);
    } catch {}
  }
  return {
    requireAllowedDomain: Boolean(row?.require_allowed_domain),
    allowedEmailDomains: domains,
    domainVerification: await enterpriseDomainVerificationDTO(workspaceId),
    updatedAt: row?.updated_at || null,
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}

async function workspaceDTO(context: {
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}) {
  const rows = await dbAll<any>(
    `SELECT m.*,u.name,u.email,u.title,u.organization,u.avatar,u.role as account_role
       FROM account_workspace_members m
       JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=? AND m.status='active'
      ORDER BY CASE m.member_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name ASC`,
    [context.workspace.id]
  );
  const dataControls = await workspaceDataControlsDTO(context.workspace.id);
  const auditRows = await dbAll<any>(
    `SELECT a.*,u.name as actor_name,t.name as target_name
       FROM account_workspace_audit a
       JOIN users u ON u.id=a.actor_id
       LEFT JOIN users t ON t.id=a.target_user_id
      WHERE a.workspace_id=? AND a.created_at >= datetime('now', ?)
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [context.workspace.id, `-${dataControls.auditVisibilityDays} days`]
  );
  return {
    id: context.workspace.id,
    name: context.workspace.name,
    accountRole: context.workspace.account_role,
    ownerId: context.workspace.owner_id,
    seatLimit: context.workspace.seat_limit,
    myRole: context.membership.member_role,
    dataControls,
    members: rows.map((row: any) => ({
      id: row.user_id,
      name: row.name,
      email: row.email,
      title: row.title || "",
      organization: row.organization || "",
      avatar: row.avatar || null,
      accountRole: row.account_role,
      workspaceRole: row.member_role,
      joinedAt: row.created_at,
    })),
    audit: auditRows.map((row: any) => ({
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      action: row.action,
      targetUserId: row.target_user_id,
      targetName: row.target_name || null,
      details: parseDetails(row.details),
      createdAt: row.created_at,
    })),
  };
}

async function count(sql: string, args: any[] = []): Promise<number> {
  const row = await dbGet<{ count: number }>(sql, args);
  return Number(row?.count || 0);
}

async function buildWorkspaceEnterpriseReport(context: {
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}) {
  const workspaceId = context.workspace.id;
  const accountId = context.workspace.owner_id;
  const role = context.workspace.account_role;

  const [memberRows, audit30d, lastAudit, auditActions, controls, domainVerification] = await Promise.all([
    dbAll<any>(
      `SELECT member_role,COUNT(*) AS count
         FROM account_workspace_members
        WHERE workspace_id=? AND status='active'
        GROUP BY member_role`,
      [workspaceId]
    ),
    count(
      "SELECT COUNT(*) AS count FROM account_workspace_audit WHERE workspace_id=? AND created_at>=datetime('now','-30 days')",
      [workspaceId]
    ),
    dbGet<any>(
      "SELECT created_at,action FROM account_workspace_audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1",
      [workspaceId]
    ),
    dbAll<any>(
      `SELECT action,COUNT(*) AS count
         FROM account_workspace_audit
        WHERE workspace_id=? AND created_at>=datetime('now','-30 days')
        GROUP BY action
        ORDER BY count DESC,action ASC
        LIMIT 10`,
      [workspaceId]
    ),
    workspaceDataControlsDTO(workspaceId),
    enterpriseDomainVerificationDTO(workspaceId),
  ]);

  const roleCounts: Record<string, number> = { owner: 0, admin: 0, member: 0, viewer: 0 };
  for (const row of memberRows) roleCounts[String(row.member_role)] = Number(row.count || 0);
  const seatsUsed = Object.values(roleCounts).reduce((sum, value) => sum + value, 0);
  const seatUtilizationPct = Math.round((seatsUsed / Math.max(1, context.workspace.seat_limit)) * 1000) / 10;

  let productMetrics: Record<string, number> = {};
  if (role === "organizer") {
    const [conferences, activeNeeds, inquiries, activeDeals] = await Promise.all([
      count("SELECT COUNT(*) AS count FROM created_conferences WHERE organizer_id=?", [accountId]),
      count(
        `SELECT COUNT(*) AS count FROM sponsorship_needs
          WHERE organizer_id=? AND status='active'
            AND (deadline IS NULL OR deadline='' OR date(deadline)>=date('now'))`,
        [accountId]
      ),
      count(
        `SELECT COUNT(*) AS count
           FROM sponsorship_need_inquiries i
           JOIN sponsorship_needs n ON n.id=i.need_id
          WHERE n.organizer_id=?`,
        [accountId]
      ),
      count(
        "SELECT COUNT(*) AS count FROM sponsorship_deals WHERE organizer_id=? AND status NOT IN ('completed','canceled')",
        [accountId]
      ),
    ]);
    productMetrics = { conferences, activeSponsorshipNeeds: activeNeeds, sponsorInquiries: inquiries, activeDealRooms: activeDeals };
  } else {
    const [saved, inquiries, activeDeals, requests] = await Promise.all([
      count("SELECT COUNT(*) AS count FROM sponsor_saved_opportunities WHERE sponsor_id=?", [accountId]),
      count("SELECT COUNT(*) AS count FROM sponsorship_need_inquiries WHERE sponsor_id=?", [accountId]),
      count(
        "SELECT COUNT(*) AS count FROM sponsorship_deals WHERE sponsor_id=? AND status NOT IN ('completed','canceled')",
        [accountId]
      ),
      count("SELECT COUNT(*) AS count FROM sponsor_requests WHERE sponsor_id=? AND status='active'", [accountId]),
    ]);
    productMetrics = { savedOpportunities: saved, sponsorshipInquiries: inquiries, activeDealRooms: activeDeals, activeSponsorRequests: requests };
  }

  return {
    generatedAt: new Date().toISOString(),
    workspace: {
      id: workspaceId,
      name: context.workspace.name,
      accountRole: role,
      seatLimit: context.workspace.seat_limit,
      seatsUsed,
      seatUtilizationPct,
      roleCounts,
    },
    governance: {
      dataControls: controls,
      domainVerification: domainVerification
        ? {
            domain: domainVerification.domain,
            status: domainVerification.status,
            verifiedAt: domainVerification.verifiedAt,
          }
        : null,
    },
    activity: {
      auditEvents30d: audit30d,
      lastWorkspaceChangeAt: lastAudit?.created_at || null,
      lastWorkspaceChangeAction: lastAudit?.action || null,
      topActions30d: auditActions.map((row) => ({
        action: String(row.action),
        count: Number(row.count || 0),
      })),
    },
    productMetrics,
  };
}

function cleanAttribution(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

async function ensureAcquisitionSchema() {
  await dbRun(`CREATE TABLE IF NOT EXISTS account_acquisition (
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
  )`);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_account_acquisition_source ON account_acquisition(source,role)");
  await dbRun("CREATE INDEX IF NOT EXISTS idx_account_acquisition_campaign ON account_acquisition(campaign,role)");
}

// Explicit first-touch attribution only. The browser sends values only when the landing URL
// explicitly contains UTM/referral parameters. ConferenceGate does not infer a source from IP,
// browser fingerprint, document.referrer, or third-party identity. INSERT OR IGNORE makes the
// first explicit touch immutable so later campaigns cannot overwrite acquisition history.
workspacesRouter.post(
  "/acquisition",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
    if (!user || (user.role !== "organizer" && user.role !== "sponsor")) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }

    const source = cleanAttribution(req.body?.source, 80);
    const medium = cleanAttribution(req.body?.medium, 80);
    const campaign = cleanAttribution(req.body?.campaign, 120);
    const content = cleanAttribution(req.body?.content, 120);
    const term = cleanAttribution(req.body?.term, 120);
    const referralCode = cleanAttribution(req.body?.referralCode, 120);
    const rawLandingPath = cleanAttribution(req.body?.landingPath, 240);
    const landingPath = rawLandingPath?.startsWith("/") ? rawLandingPath : null;

    if (!source && !campaign && !referralCode) {
      return res.status(400).json({ error: "Explicit source, campaign, or referralCode is required." });
    }
    const normalizedSource = source || (referralCode ? "referral" : "campaign");

    await ensureAcquisitionSchema();
    await dbRun(
      `INSERT OR IGNORE INTO account_acquisition
        (user_id,role,source,medium,campaign,content,term,referral_code,landing_path)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [user.id, user.role, normalizedSource, medium, campaign, content, term, referralCode, landingPath]
    );

    // Phase 9 referral loop: explicit ?ref= codes become durable conversions only when the code
    // exists and its role target matches the account that actually signed up.
    if (referralCode) {
      const referral = await dbGet<any>(
        "SELECT * FROM growth_referral_codes WHERE lower(code)=lower(?) AND active=1 LIMIT 1",
        [referralCode],
      );
      if (referral && (!referral.role_target || referral.role_target === user.role)) {
        await dbRun(
          `INSERT OR IGNORE INTO growth_referral_conversions(id,referral_code_id,referred_user_id)
           VALUES(?,?,?)`,
          [`grefc_${crypto.randomUUID()}`, referral.id, user.id],
        );
      }
    }

    // If this signup was already being tracked as a Phase 9 lead, connect the lead to the real
    // account immediately. Later dashboard snapshots advance it further from activation/paid state.
    await dbRun(
      `UPDATE growth_leads
          SET converted_user_id=?,
              stage=CASE
                WHEN stage IN ('new','contacted','qualified','invited') THEN 'signup'
                ELSE stage
              END,
              score=CASE WHEN score<75 THEN 75 ELSE score END,
              updated_at=datetime('now')
        WHERE role=? AND email<>'' AND lower(email)=lower(?) AND stage<>'lost'`,
      [user.id, user.role, user.email],
    );

    const record = await dbGet<any>("SELECT * FROM account_acquisition WHERE user_id=?", [user.id]);
    res.status(201).json({
      acquisition: record
        ? {
            source: record.source,
            medium: record.medium,
            campaign: record.campaign,
            content: record.content,
            term: record.term,
            referralCode: record.referral_code,
            landingPath: record.landing_path,
            recordedAt: record.recorded_at,
          }
        : null,
    });
  })
);

function normalizeImportDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(value)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function normalizeImportFormat(value: string | null | undefined): "Physical" | "Online" | "Hybrid" | null {
  const text = String(value || "").toLowerCase();
  if (!text) return null;
  if (text.includes("hybrid") || text.includes("mixed")) return "Hybrid";
  if (text.includes("online") || text.includes("virtual") || text.includes("remote")) return "Online";
  if (text.includes("in-person") || text.includes("in person") || text.includes("onsite") || text.includes("on-site") || text.includes("offline") || text.includes("physical")) return "Physical";
  return null;
}

function importLocation(city: string | null, country: string | null, venue: string | null, fallback: string | null): string | null {
  if (city && country) return venue ? `${city}, ${country} (${venue})` : `${city}, ${country}`;
  return fallback || [city, country].filter(Boolean).join(", ") || null;
}

function importExtractionScore(raw: RawEventExtraction): number {
  return [
    raw.title,
    raw.startDateText || raw.datesText,
    raw.city || raw.country || raw.locationText,
    raw.description,
    raw.topics?.length ? "topics" : null,
    raw.imageUrl,
    raw.formatText,
    raw.price,
    raw.organizer,
  ].filter(Boolean).length;
}

function extractImportFromReaderMarkdown(markdown: string, sourceUrl: string): RawEventExtraction {
  const raw = emptyRawExtraction("derived");
  const normalized = markdown.replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);

  const titleHeader = lines.find((line) => /^Title:\s*/i.test(line));
  const markdownContentIndex = lines.findIndex((line) => /^Markdown Content:?$/i.test(line));
  const bodyLines = markdownContentIndex >= 0 ? lines.slice(markdownContentIndex + 1) : lines;

  raw.title =
    titleHeader?.replace(/^Title:\s*/i, "").trim() ||
    bodyLines.find((line) =>
      line.length >= 5 &&
      line.length <= 180 &&
      !/^(URL Source|Published Time|Markdown Content|Location|Date|When|Where|Register|Registration):/i.test(line)
    ) ||
    null;

  const dateLine = bodyLines.find((line) =>
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?,?\s+20\d{2}\b/i.test(line) ||
    /\b20\d{2}-\d{2}-\d{2}\b/.test(line)
  );
  raw.datesText = dateLine || null;
  raw.startDateText = dateLine || null;

  const locationLine = bodyLines.find((line) => /^(?:Location|Where|Venue):\s*\S/i.test(line));
  raw.locationText = locationLine?.replace(/^(?:Location|Where|Venue):\s*/i, "").trim() || null;

  const organizerLine = bodyLines.find((line) => /^Organizer:\s*\S/i.test(line));
  raw.organizer = organizerLine?.replace(/^Organizer:\s*/i, "").trim() || null;

  const descriptionLines = bodyLines
    .filter((line) =>
      line.length >= 40 &&
      line.length <= 600 &&
      !/^(?:URL Source|Published Time|Location|Where|Venue|Organizer|Register|Registration|Date|When):/i.test(line)
    )
    .slice(0, 3);
  raw.description = descriptionLines.length ? descriptionLines.join(" ") : null;

  const formatLine = bodyLines.find((line) => /\b(hybrid|virtual|online|in[- ]person|onsite|on-site)\b/i.test(line));
  raw.formatText = formatLine || null;

  const priceMatch = normalized.match(/(?:USD\s*)?\$\s?([0-9][0-9,]*(?:\.\d{2})?)/i);
  if (priceMatch) {
    raw.price = priceMatch[1].replaceAll(",", "");
    raw.currency = "USD";
  }

  raw.officialUrl = sourceUrl;
  raw.filledFields = [
    raw.title && "title",
    raw.datesText && "datesText",
    raw.locationText && "locationText",
    raw.description && "description",
    raw.organizer && "organizer",
    raw.formatText && "formatText",
    raw.price && "price",
  ].filter(Boolean) as string[];
  raw.confidence = Math.min(0.72, 0.28 + raw.filledFields.length * 0.07);
  return raw;
}

function extractImportFromHtml(html: string, sourceUrl: string): RawEventExtraction {
  const structured = extractStructuredEvents(html, sourceUrl);
  const seed = structured.events[0] || null;
  return extractFromHtml(html, sourceUrl, { seed });
}

// Paid Organizer Pro helper: fetch one organizer-supplied official conference page, extract only
// facts the page itself exposes, and return a reviewable wizard draft. This never auto-publishes.
// discoveryFetch applies the same SSRF guard, redirect revalidation, timeout, response-size cap,
// and polite per-domain limits as the discovery engine.
workspacesRouter.post(
  "/organizer/import-conference",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const context = await ensurePaidWorkspace(req.userId!);
    if (context.workspace.account_role !== "organizer") {
      return res.status(403).json({ error: "Organizer Pro workspace required." });
    }

    const submitted = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!submitted || submitted.length > 2000) {
      return res.status(400).json({ error: "Provide the official conference URL." });
    }
    let url: URL;
    try {
      url = new URL(submitted);
    } catch {
      return res.status(400).json({ error: "Provide a valid http(s) conference URL." });
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return res.status(400).json({ error: "Only http(s) conference URLs are supported." });
    }

    if (!(await isSafeExternalUrl(url.href))) {
      return res.status(400).json({
        code: "IMPORT_URL_BLOCKED",
        error: "That URL cannot be fetched safely. Use the public official conference page.",
      });
    }

    const attempts: Array<{ route: string; ok: boolean; detail: string }> = [];
    const candidates: Array<{ route: string; sourceUrl: string; raw: RawEventExtraction }> = [];

    let fetched: Awaited<ReturnType<typeof discoveryFetch>> | null = null;
    try {
      fetched = await discoveryFetch(url.href, { timeoutMs: 12000, maxBytes: 1_500_000 });
      if (fetched.ok && isHtmlLike(fetched)) {
        try {
          const raw = extractImportFromHtml(fetched.body, fetched.finalUrl);
          candidates.push({ route: "direct_http", sourceUrl: fetched.finalUrl, raw });
          attempts.push({
            route: "direct_http",
            ok: true,
            detail: `HTTP ${fetched.status}; extracted ${importExtractionScore(raw)} field groups`,
          });
        } catch (error: any) {
          attempts.push({
            route: "direct_http",
            ok: false,
            detail: `extractor_error:${String(error?.message || error).slice(0, 120)}`,
          });
        }
      } else {
        attempts.push({
          route: "direct_http",
          ok: false,
          detail: fetched.error || `HTTP ${fetched.status || "unknown"}`,
        });
      }
    } catch (error: any) {
      attempts.push({
        route: "direct_http",
        ok: false,
        detail: `transport_error:${String(error?.message || error).slice(0, 120)}`,
      });
    }

    // Hosted readable-page fallback is tried before Chromium for event platforms such as
    // WildApricot. It is faster on Render and works even when the origin blocks Render's IP/TLS.
    const directBest = candidates[0]?.raw;
    if ((!directBest || importExtractionScore(directBest) < 3) && isJinaConfigured()) {
      const reader = await jinaReadPageDetailed(url.href);
      if (reader.markdown) {
        try {
          const raw = extractImportFromReaderMarkdown(reader.markdown, url.href);
          candidates.push({ route: "readable_page", sourceUrl: url.href, raw });
          attempts.push({
            route: "readable_page",
            ok: true,
            detail: `extracted ${importExtractionScore(raw)} field groups`,
          });
        } catch (error: any) {
          attempts.push({
            route: "readable_page",
            ok: false,
            detail: `extractor_error:${String(error?.message || error).slice(0, 120)}`,
          });
        }
      } else {
        attempts.push({
          route: "readable_page",
          ok: false,
          detail: reader.error || `HTTP ${reader.httpStatus || "unknown"}`,
        });
      }
    }

    // Browser is the final fallback for pages that require client-side rendering.
    const bestBeforeBrowser = candidates
      .slice()
      .sort((a, b) => importExtractionScore(b.raw) - importExtractionScore(a.raw))[0];
    const browserTarget = fetched?.ok ? fetched.finalUrl : url.href;
    if (!bestBeforeBrowser || importExtractionScore(bestBeforeBrowser.raw) < 3) {
      const rendered = await fetchRenderedHtml(browserTarget);
      if (rendered) {
        try {
          const raw = extractImportFromHtml(rendered, browserTarget);
          candidates.push({ route: "rendered_browser", sourceUrl: browserTarget, raw });
          attempts.push({
            route: "rendered_browser",
            ok: true,
            detail: `extracted ${importExtractionScore(raw)} field groups`,
          });
        } catch (error: any) {
          attempts.push({
            route: "rendered_browser",
            ok: false,
            detail: `extractor_error:${String(error?.message || error).slice(0, 120)}`,
          });
        }
      } else {
        attempts.push({
          route: "rendered_browser",
          ok: false,
          detail: isBrowserRenderingUnavailable() ? "browser unavailable on host" : "page could not be rendered",
        });
      }
    }

    const best = candidates
      .slice()
      .sort((a, b) => importExtractionScore(b.raw) - importExtractionScore(a.raw))[0];

    if (!best) {
      return res.status(422).json({
        code: "IMPORT_PAGE_UNREADABLE",
        error: "ConferenceGate could not read this page through direct, rendered, or readable-page routes. You can still enter the details manually.",
        attempts,
      });
    }
    if (importExtractionScore(best.raw) === 0) {
      return res.json({
        draft: { sourceUrl: best.sourceUrl || url.href, title: null, description: null, startDate: null, endDate: null, location: null, topics: [], bannerUrl: null, format: null, priceRange: null, organizer: null, confidence: 0, extractedFields: [] },
        method: best.route, attempts,
        note: "The official page was reachable but did not expose structured conference facts. ConferenceGate kept the source URL and opened an empty reviewable draft instead of failing; enter the missing fields manually or try a conference-specific page."
      });
    }

    const raw = best.raw;
    const sourceUrl = best.sourceUrl;
    const topics = (raw.topics || []).map((topic) => String(topic).trim()).filter(Boolean).slice(0, 20);
    const filled = [
      raw.title && "title",
      (raw.startDateText || raw.datesText) && "dates",
      (raw.city || raw.country || raw.locationText) && "location",
      raw.description && "description",
      topics.length && "topics",
      raw.imageUrl && "image",
      raw.formatText && "format",
      raw.price && "price",
      raw.organizer && "organizer",
    ].filter(Boolean);

    res.json({
      draft: {
        sourceUrl,
        title: raw.title,
        description: raw.description,
        startDate: normalizeImportDate(raw.startDateText || raw.datesText),
        endDate: normalizeImportDate(raw.endDateText) || normalizeImportDate(raw.startDateText || raw.datesText),
        location: importLocation(raw.city, raw.country, raw.venue, raw.locationText),
        topics,
        bannerUrl: raw.imageUrl,
        format: normalizeImportFormat(raw.formatText),
        priceRange: raw.price ? [raw.currency, raw.price].filter(Boolean).join(" ") : null,
        organizer: raw.organizer,
        confidence: raw.confidence,
        extractedFields: filled,
      },
      method: best.route,
      attempts,
      note:
        "Imported fields are a draft from the supplied official page. Review every field before publishing." +
        (best.route === "direct_http" ? "" : ` Import fallback used: ${best.route}.`),
    });
  })
);

async function activationDTO(context: {
  workspace: AccountWorkspaceRow;
  membership: AccountWorkspaceMemberRow;
}) {
  const accountId = context.workspace.owner_id;
  const role = context.workspace.account_role;
  const teamMembers = await count(
    "SELECT COUNT(*) as count FROM account_workspace_members WHERE workspace_id=? AND status='active' AND member_role<>'owner'",
    [context.workspace.id]
  );

  if (role === "organizer") {
    const [conferences, needs, inquiries, deals, payments] = await Promise.all([
      count("SELECT COUNT(*) as count FROM created_conferences WHERE organizer_id=?", [accountId]),
      count("SELECT COUNT(*) as count FROM sponsorship_needs WHERE organizer_id=?", [accountId]),
      count(
        `SELECT COUNT(*) as count
           FROM sponsorship_need_inquiries i
           JOIN sponsorship_needs n ON n.id=i.need_id
          WHERE n.organizer_id=?`,
        [accountId]
      ),
      count("SELECT COUNT(*) as count FROM sponsorship_deals WHERE organizer_id=?", [accountId]),
      count(
        `SELECT COUNT(*) as count
           FROM sponsorship_payments p
           JOIN sponsorship_deals d ON d.id=p.deal_id
          WHERE d.organizer_id=? AND p.status='settled'`,
        [accountId]
      ),
    ]);
    const steps = [
      {
        key: "create_conference",
        label: "Create your first conference",
        description: "Use Conference Wizard to create the conference workspace sponsors and professionals will engage with.",
        complete: conferences > 0,
        count: conferences,
      },
      {
        key: "publish_sponsorship_need",
        label: "Publish a sponsorship need",
        description: "Tell matched sponsors what the conference needs, the opportunity type, benefits, and budget or price.",
        complete: needs > 0,
        count: needs,
      },
      {
        key: "receive_sponsor_inquiry",
        label: "Receive sponsor interest",
        description: "A Sponsor Pro workspace has submitted an inquiry against your sponsorship inventory.",
        complete: inquiries > 0,
        count: inquiries,
      },
      {
        key: "reach_deal_room",
        label: "Open a Deal Room",
        description: "Move a qualified sponsor inquiry into the shared commercial workflow.",
        complete: deals > 0,
        count: deals,
      },
      {
        key: "confirm_sponsor_payment",
        label: "Complete a sponsorship payment",
        description: "A sponsorship payment has been confirmed by the configured payment-provider integration.",
        complete: payments > 0,
        count: payments,
      },
    ];
    const completedCount = steps.filter((step) => step.complete).length;
    return {
      role,
      accountId,
      workspaceId: context.workspace.id,
      workspaceRole: context.membership.member_role,
      completedCount,
      totalCount: steps.length,
      progressPct: Math.round((completedCount / steps.length) * 100),
      steps,
      optional: {
        key: "add_team_member",
        label: "Add a teammate",
        description: "Optional: share the paid workspace with an admin, member, or viewer seat.",
        complete: teamMembers > 0,
        count: teamMembers,
      },
    };
  }

  const [preferences, saved, inquiries, deals, payments] = await Promise.all([
    count("SELECT COUNT(*) as count FROM sponsor_preferences WHERE sponsor_id=?", [accountId]),
    count("SELECT COUNT(*) as count FROM sponsor_saved_opportunities WHERE sponsor_id=?", [accountId]),
    count("SELECT COUNT(*) as count FROM sponsorship_need_inquiries WHERE sponsor_id=?", [accountId]),
    count("SELECT COUNT(*) as count FROM sponsorship_deals WHERE sponsor_id=?", [accountId]),
    count(
      `SELECT COUNT(*) as count
         FROM sponsorship_payments p
         JOIN sponsorship_deals d ON d.id=p.deal_id
        WHERE d.sponsor_id=? AND p.status='settled'`,
      [accountId]
    ),
  ]);
  const steps = [
    {
      key: "configure_preferences",
      label: "Set sponsorship preferences",
      description: "Choose sectors, categories, regions, opportunity types, budget range, and alert frequency.",
      complete: preferences > 0,
      count: preferences,
    },
    {
      key: "save_opportunity",
      label: "Save an opportunity",
      description: "Build a shared Sponsor Pro watchlist and enable alerts for opportunities you want to follow.",
      complete: saved > 0,
      count: saved,
    },
    {
      key: "send_inquiry",
      label: "Send a sponsorship inquiry",
      description: "Contact an organizer through an active ConferenceGate sponsorship need.",
      complete: inquiries > 0,
      count: inquiries,
    },
    {
      key: "reach_deal_room",
      label: "Reach a Deal Room",
      description: "Advance an organizer conversation into the shared sponsorship commercial workflow.",
      complete: deals > 0,
      count: deals,
    },
    {
      key: "confirm_sponsor_payment",
      label: "Complete a sponsorship payment",
      description: "A sponsorship payment has been confirmed by the configured payment-provider integration.",
      complete: payments > 0,
      count: payments,
    },
  ];
  const completedCount = steps.filter((step) => step.complete).length;
  return {
    role,
    accountId,
    workspaceId: context.workspace.id,
    workspaceRole: context.membership.member_role,
    completedCount,
    totalCount: steps.length,
    progressPct: Math.round((completedCount / steps.length) * 100),
    steps,
    optional: {
      key: "add_team_member",
      label: "Add a teammate",
      description: "Optional: share the paid workspace with an admin, member, or viewer seat.",
      complete: teamMembers > 0,
      count: teamMembers,
    },
  };
}

workspacesRouter.post(
  "/checkout-start",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const user = await dbGet<UserRow>("SELECT * FROM users WHERE id=?", [req.userId!]);
    if (!user || (user.role !== "organizer" && user.role !== "sponsor")) {
      return res.status(403).json({ error: "Organizer or Sponsor account required." });
    }
    const rawProvider = typeof req.body?.provider === "string" ? req.body.provider.trim().toLowerCase() : "hosted";
    const provider = /^[a-z0-9_-]{1,40}$/.test(rawProvider) ? rawProvider : "hosted";
    const eventId = `checkout_${crypto.randomUUID()}`;
    const eventPayload = {
      role: user.role,
      provider,
      subscriptionStatus: user.subscription_status || "required",
    };
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(eventPayload)).digest("hex");
    await dbRun(
      "INSERT INTO billing_provider_events(id,provider,event_id,event_type,subject_id,payload_hash,status) VALUES(?,?,?,?,?,?,'processed')",
      [`bpe_${crypto.randomUUID()}`, provider, eventId, "subscription.checkout.started", user.id, payloadHash]
    );
    res.status(201).json({ ok: true });
  })
);

workspacesRouter.get(
  "/enterprise-settings",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (!["owner", "admin"].includes(context.membership.member_role)) {
        return res.status(403).json({ error: "Workspace admin permission required." });
      }
      res.json({ settings: await enterpriseSettingsDTO(context.workspace.id) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not load enterprise settings." });
    }
  })
);

workspacesRouter.put(
  "/enterprise-settings",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (context.membership.member_role !== "owner") {
        return res.status(403).json({ error: "Workspace owner permission required." });
      }

      const requested = Array.isArray(req.body?.allowedEmailDomains) ? req.body.allowedEmailDomains : [];
      const domains = [...new Set(requested.map(normalizeDomain).filter(Boolean) as string[])].slice(0, 50);
      const requireAllowedDomain = Boolean(req.body?.requireAllowedDomain);
      if (requireAllowedDomain && domains.length === 0) {
        return res.status(400).json({ error: "Add at least one approved email domain before enforcing the domain rule." });
      }

      await ensureEnterpriseSettingsSchema();
      await dbRun(
        `INSERT INTO account_workspace_enterprise_settings(
          workspace_id,require_allowed_domain,allowed_email_domains,updated_by,updated_at
        ) VALUES(?,?,?,?,datetime('now'))
        ON CONFLICT(workspace_id) DO UPDATE SET
          require_allowed_domain=excluded.require_allowed_domain,
          allowed_email_domains=excluded.allowed_email_domains,
          updated_by=excluded.updated_by,
          updated_at=datetime('now')`,
        [context.workspace.id, requireAllowedDomain ? 1 : 0, JSON.stringify(domains), req.userId!]
      );
      await audit(context.workspace.id, req.userId!, "enterprise_settings_updated", null, {
        requireAllowedDomain,
        allowedEmailDomains: domains,
      });
      res.json({ settings: await enterpriseSettingsDTO(context.workspace.id) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not update enterprise settings." });
    }
  })
);

workspacesRouter.get(
  "/data-controls",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (!["owner", "admin"].includes(context.membership.member_role)) {
        return res.status(403).json({ error: "Workspace admin permission required." });
      }
      res.json({ controls: await workspaceDataControlsDTO(context.workspace.id) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace data controls." });
    }
  })
);

workspacesRouter.put(
  "/data-controls",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (context.membership.member_role !== "owner") {
        return res.status(403).json({ error: "Workspace owner permission required." });
      }

      const adminsCanManageMembers = req.body?.adminsCanManageMembers !== false;
      const allowAdminExports = req.body?.allowAdminExports !== false;
      const auditVisibilityDays = clampAuditDays(req.body?.auditVisibilityDays);

      await ensureWorkspaceDataControlsSchema();
      await dbRun(
        `INSERT INTO account_workspace_data_controls(
          workspace_id,admins_can_manage_members,allow_admin_exports,audit_visibility_days,updated_by,updated_at
        ) VALUES(?,?,?,?,?,datetime('now'))
        ON CONFLICT(workspace_id) DO UPDATE SET
          admins_can_manage_members=excluded.admins_can_manage_members,
          allow_admin_exports=excluded.allow_admin_exports,
          audit_visibility_days=excluded.audit_visibility_days,
          updated_by=excluded.updated_by,
          updated_at=datetime('now')`,
        [
          context.workspace.id,
          adminsCanManageMembers ? 1 : 0,
          allowAdminExports ? 1 : 0,
          auditVisibilityDays,
          req.userId!,
        ]
      );
      await audit(context.workspace.id, req.userId!, "workspace_data_controls_updated", null, {
        adminsCanManageMembers,
        allowAdminExports,
        auditVisibilityDays,
      });
      res.json({ controls: await workspaceDataControlsDTO(context.workspace.id) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not update workspace data controls." });
    }
  })
);

workspacesRouter.post(
  "/enterprise-domain/start",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (context.membership.member_role !== "owner") {
        return res.status(403).json({ error: "Workspace owner permission required." });
      }
      const domain = normalizeDomain(req.body?.domain);
      if (!domain) return res.status(400).json({ error: "Provide a valid company domain." });

      await ensureEnterpriseDomainVerificationSchema();
      const token = crypto.randomBytes(24).toString("base64url");
      await dbRun(
        `INSERT INTO account_workspace_domain_verifications(
          workspace_id,domain,token,status,verified_at,updated_at
        ) VALUES(?,?,?,'pending',NULL,datetime('now'))
        ON CONFLICT(workspace_id) DO UPDATE SET
          domain=excluded.domain,token=excluded.token,status='pending',
          verified_at=NULL,updated_at=datetime('now')`,
        [context.workspace.id, domain, token]
      );
      await audit(context.workspace.id, req.userId!, "enterprise_domain_verification_started", null, { domain });
      res.status(201).json({
        verification: await enterpriseDomainVerificationDTO(context.workspace.id),
      });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not start domain verification." });
    }
  })
);

workspacesRouter.post(
  "/enterprise-domain/check",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (context.membership.member_role !== "owner") {
        return res.status(403).json({ error: "Workspace owner permission required." });
      }
      await ensureEnterpriseDomainVerificationSchema();
      const row = await dbGet<any>(
        "SELECT * FROM account_workspace_domain_verifications WHERE workspace_id=?",
        [context.workspace.id]
      );
      if (!row) return res.status(404).json({ error: "Start domain verification first." });

      const expected = `conferencegate-verification=${row.token}`;
      let records: string[][] = [];
      try {
        records = await dns.resolveTxt(`_conferencegate.${row.domain}`);
      } catch {
        records = [];
      }
      const found = records.map((parts) => parts.join("")).some((value) => value === expected);
      if (!found) {
        return res.status(409).json({
          error: "Verification TXT record not found yet. DNS changes can take time to propagate.",
          verification: await enterpriseDomainVerificationDTO(context.workspace.id),
        });
      }

      await dbRun(
        "UPDATE account_workspace_domain_verifications SET status='verified',verified_at=datetime('now'),updated_at=datetime('now') WHERE workspace_id=?",
        [context.workspace.id]
      );
      await audit(context.workspace.id, req.userId!, "enterprise_domain_verified", null, { domain: row.domain });
      res.json({ verification: await enterpriseDomainVerificationDTO(context.workspace.id) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not verify company domain." });
    }
  })
);

workspacesRouter.get(
  "/audit.csv",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (!["owner", "admin"].includes(context.membership.member_role)) {
        return res.status(403).json({ error: "Workspace admin permission required." });
      }
      const controls = await workspaceDataControlsDTO(context.workspace.id);
      if (context.membership.member_role === "admin" && !controls.allowAdminExports) {
        return res.status(403).json({ error: "Workspace owner has disabled admin exports." });
      }
      await audit(context.workspace.id, req.userId!, "workspace_audit_exported");
      const rows = await dbAll<any>(
        `SELECT a.created_at,a.action,u.name AS actor_name,u.email AS actor_email,
                t.name AS target_name,t.email AS target_email,a.details
           FROM account_workspace_audit a
           JOIN users u ON u.id=a.actor_id
           LEFT JOIN users t ON t.id=a.target_user_id
          WHERE a.workspace_id=?
          ORDER BY a.created_at DESC`,
        [context.workspace.id]
      );
      const csv = [
        ["created_at","action","actor_name","actor_email","target_name","target_email","details"].join(","),
        ...rows.map((row) => [
          row.created_at,row.action,row.actor_name,row.actor_email,row.target_name,row.target_email,row.details || ""
        ].map(csvCell).join(","))
      ].join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="conferencegate-workspace-audit.csv"`);
      res.send(csv);
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not export workspace audit." });
    }
  })
);

workspacesRouter.get(
  "/data-export.json",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (!["owner", "admin"].includes(context.membership.member_role)) {
        return res.status(403).json({ error: "Workspace admin permission required." });
      }
      const controls = await workspaceDataControlsDTO(context.workspace.id);
      if (context.membership.member_role === "admin" && !controls.allowAdminExports) {
        return res.status(403).json({ error: "Workspace owner has disabled admin exports." });
      }

      const accountId = context.workspace.owner_id;
      const members = await dbAll<any>(
        `SELECT m.user_id,m.member_role,m.status,m.created_at,m.updated_at,
                u.name,u.email,u.title,u.organization,u.role
           FROM account_workspace_members m
           JOIN users u ON u.id=m.user_id
          WHERE m.workspace_id=?
          ORDER BY m.created_at ASC`,
        [context.workspace.id]
      );

      let records: Record<string, unknown[]> = {};
      if (context.workspace.account_role === "organizer") {
        const [conferences, needs, inquiries, deals] = await Promise.all([
          dbAll<any>("SELECT * FROM created_conferences WHERE organizer_id=? ORDER BY created_at DESC", [accountId]),
          dbAll<any>("SELECT * FROM sponsorship_needs WHERE organizer_id=? ORDER BY created_at DESC", [accountId]),
          dbAll<any>(
            `SELECT i.* FROM sponsorship_need_inquiries i
               JOIN sponsorship_needs n ON n.id=i.need_id
              WHERE n.organizer_id=? ORDER BY i.created_at DESC`,
            [accountId]
          ),
          dbAll<any>("SELECT * FROM sponsorship_deals WHERE organizer_id=? ORDER BY created_at DESC", [accountId]),
        ]);
        records = { conferences, sponsorshipNeeds: needs, sponsorshipInquiries: inquiries, sponsorshipDeals: deals };
      } else {
        const [preferences, saved, inquiries, deals, requests] = await Promise.all([
          dbAll<any>("SELECT * FROM sponsor_preferences WHERE sponsor_id=?", [accountId]),
          dbAll<any>("SELECT * FROM sponsor_saved_opportunities WHERE sponsor_id=? ORDER BY created_at DESC", [accountId]),
          dbAll<any>("SELECT * FROM sponsorship_need_inquiries WHERE sponsor_id=? ORDER BY created_at DESC", [accountId]),
          dbAll<any>("SELECT * FROM sponsorship_deals WHERE sponsor_id=? ORDER BY created_at DESC", [accountId]),
          dbAll<any>("SELECT * FROM sponsor_requests WHERE sponsor_id=? ORDER BY created_at DESC", [accountId]),
        ]);
        records = { sponsorPreferences: preferences, savedOpportunities: saved, sponsorshipInquiries: inquiries, sponsorshipDeals: deals, sponsorRequests: requests };
      }

      const payload = {
        generatedAt: new Date().toISOString(),
        workspace: {
          id: context.workspace.id,
          name: context.workspace.name,
          accountRole: context.workspace.account_role,
          ownerId: context.workspace.owner_id,
          seatLimit: context.workspace.seat_limit,
        },
        controls,
        members,
        records,
      };

      await audit(context.workspace.id, req.userId!, "workspace_data_exported", null, {
        accountRole: context.workspace.account_role,
      });
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="conferencegate-workspace-data.json"`);
      res.send(JSON.stringify(payload, null, 2));
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not export workspace data." });
    }
  })
);

workspacesRouter.get(
  "/enterprise-report",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (!["owner", "admin"].includes(context.membership.member_role)) {
        return res.status(403).json({ error: "Workspace admin permission required." });
      }
      res.json({ report: await buildWorkspaceEnterpriseReport(context) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not load enterprise workspace report." });
    }
  })
);

workspacesRouter.get(
  "/enterprise-report.csv",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      if (!["owner", "admin"].includes(context.membership.member_role)) {
        return res.status(403).json({ error: "Workspace admin permission required." });
      }
      const controls = await workspaceDataControlsDTO(context.workspace.id);
      if (context.membership.member_role === "admin" && !controls.allowAdminExports) {
        return res.status(403).json({ error: "Workspace owner has disabled admin exports." });
      }
      const report = await buildWorkspaceEnterpriseReport(context);
      const rows: Array<[string, unknown]> = [
        ["generated_at", report.generatedAt],
        ["workspace_name", report.workspace.name],
        ["account_role", report.workspace.accountRole],
        ["seat_limit", report.workspace.seatLimit],
        ["seats_used", report.workspace.seatsUsed],
        ["seat_utilization_pct", report.workspace.seatUtilizationPct],
        ["owners", report.workspace.roleCounts.owner],
        ["admins", report.workspace.roleCounts.admin],
        ["members", report.workspace.roleCounts.member],
        ["viewers", report.workspace.roleCounts.viewer],
        ["audit_events_30d", report.activity.auditEvents30d],
        ["last_workspace_change_at", report.activity.lastWorkspaceChangeAt],
        ["domain", report.governance.domainVerification?.domain || ""],
        ["domain_status", report.governance.domainVerification?.status || "not_configured"],
      ];
      for (const [key, value] of Object.entries(report.productMetrics)) {
        rows.push([key, value]);
      }
      const csv = ["metric,value", ...rows.map(([key, value]) => [csvCell(key), csvCell(value)].join(","))].join("\n");
      await audit(context.workspace.id, req.userId!, "enterprise_report_exported");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="conferencegate-enterprise-report.csv"`);
      res.send(csv);
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not export enterprise workspace report." });
    }
  })
);

workspacesRouter.get(
  "/activation",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      res.json({ activation: await activationDTO(context) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not load activation checklist." });
    }
  })
);

workspacesRouter.get(
  "/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const context = await ensurePaidWorkspace(req.userId!);
      res.json({ workspace: await workspaceDTO(context) });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
  })
);

workspacesRouter.patch(
  "/mine",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Workspace name must be between 1 and 120 characters." });
    }
    await dbRun("UPDATE account_workspaces SET name=?,updated_at=datetime('now') WHERE id=?", [
      name,
      context.workspace.id,
    ]);
    await audit(context.workspace.id, req.userId!, "workspace_renamed", null, { name });
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.json({ workspace: await workspaceDTO(updatedContext) });
  })
);

workspacesRouter.post(
  "/members",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!(await canManageWorkspaceMembers(context))) {
      return res.status(403).json({ error: "Workspace member-management permission required." });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const memberRole = ["admin", "member", "viewer"].includes(req.body?.memberRole)
      ? req.body.memberRole
      : "member";
    if (!email) return res.status(400).json({ error: "Member email is required." });

    const enterpriseSettings = await enterpriseSettingsDTO(context.workspace.id);
    if (enterpriseSettings.requireAllowedDomain) {
      const emailDomain = email.split("@").pop()?.toLowerCase() || "";
      if (!enterpriseSettings.allowedEmailDomains.includes(emailDomain)) {
        return res.status(403).json({
          error: "This workspace only accepts members from approved email domains.",
        });
      }
    }

    const target = await dbGet<UserRow>("SELECT * FROM users WHERE lower(email)=?", [email]);
    if (!target) {
      return res.status(404).json({
        error: "No ConferenceGate account exists for this email yet. Ask the person to create an account first.",
      });
    }
    if (target.role !== context.workspace.account_role) {
      return res.status(409).json({
        error: `This workspace accepts ${context.workspace.account_role} accounts only.`,
      });
    }
    if (target.id === context.workspace.owner_id) {
      return res.status(409).json({ error: "The workspace owner is already a member." });
    }

    const activeCount = await dbGet<{ count: number }>(
      "SELECT COUNT(*) as count FROM account_workspace_members WHERE workspace_id=? AND status='active'",
      [context.workspace.id]
    );
    if (Number(activeCount?.count || 0) >= context.workspace.seat_limit) {
      return res.status(409).json({ error: "Workspace seat limit reached." });
    }

    const existing = await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=?",
      [context.workspace.id, target.id]
    );
    if (existing) {
      await dbRun(
        "UPDATE account_workspace_members SET member_role=?,status='active',updated_at=datetime('now') WHERE id=?",
        [memberRole, existing.id]
      );
    } else {
      await dbRun(
        "INSERT INTO account_workspace_members(id,workspace_id,user_id,member_role,status) VALUES(?,?,?,?, 'active')",
        [`wsm_${crypto.randomUUID()}`, context.workspace.id, target.id, memberRole]
      );
    }
    await audit(context.workspace.id, req.userId!, "member_added", target.id, { memberRole });
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.status(201).json({ workspace: await workspaceDTO(updatedContext) });
  })
);

workspacesRouter.patch(
  "/members/:userId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!(await canManageWorkspaceMembers(context))) {
      return res.status(403).json({ error: "Workspace member-management permission required." });
    }
    if (req.params.userId === context.workspace.owner_id) {
      return res.status(409).json({ error: "The owner role cannot be changed." });
    }
    const memberRole = ["admin", "member", "viewer"].includes(req.body?.memberRole)
      ? req.body.memberRole
      : null;
    if (!memberRole) return res.status(400).json({ error: "Invalid memberRole." });

    const member = await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=? AND status='active'",
      [context.workspace.id, req.params.userId]
    );
    if (!member) return res.status(404).json({ error: "Workspace member not found." });

    await dbRun(
      "UPDATE account_workspace_members SET member_role=?,updated_at=datetime('now') WHERE id=?",
      [memberRole, member.id]
    );
    await audit(context.workspace.id, req.userId!, "member_role_changed", req.params.userId, { memberRole });
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.json({ workspace: await workspaceDTO(updatedContext) });
  })
);

workspacesRouter.delete(
  "/members/:userId",
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    let context;
    try {
      context = await ensurePaidWorkspace(req.userId!);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ error: error?.message || "Could not load workspace." });
    }
    if (!(await canManageWorkspaceMembers(context))) {
      return res.status(403).json({ error: "Workspace member-management permission required." });
    }
    if (req.params.userId === context.workspace.owner_id) {
      return res.status(409).json({ error: "The workspace owner cannot be removed." });
    }
    const member = await dbGet<AccountWorkspaceMemberRow>(
      "SELECT * FROM account_workspace_members WHERE workspace_id=? AND user_id=? AND status='active'",
      [context.workspace.id, req.params.userId]
    );
    if (!member) return res.status(404).json({ error: "Workspace member not found." });

    await dbRun(
      "UPDATE account_workspace_members SET status='removed',updated_at=datetime('now') WHERE id=?",
      [member.id]
    );
    await audit(context.workspace.id, req.userId!, "member_removed", req.params.userId);
    const updatedContext = await ensurePaidWorkspace(req.userId!);
    res.json({ workspace: await workspaceDTO(updatedContext) });
  })
);
