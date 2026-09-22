import { Router, Response } from "express";
import crypto from "crypto";
import { asyncHandler } from "./asyncHandler";
import { AuthedRequest, requireAuth } from "./auth";
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

  // Resolve an existing team membership before checking billing. A member seat inherits the
  // workspace owner's paid subscription; requiring the member's personal account to be paid would
  // defeat the purpose of a multi-seat account.
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

  // No team membership exists yet: this account can create its own workspace only if its personal
  // Organizer/Sponsor subscription is active or trialing.
  if (!["active", "trialing"].includes(user.subscription_status || "")) {
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
  const auditRows = await dbAll<any>(
    `SELECT a.*,u.name as actor_name,t.name as target_name
       FROM account_workspace_audit a
       JOIN users u ON u.id=a.actor_id
       LEFT JOIN users t ON t.id=a.target_user_id
      WHERE a.workspace_id=?
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [context.workspace.id]
  );
  return {
    id: context.workspace.id,
    name: context.workspace.name,
    accountRole: context.workspace.account_role,
    ownerId: context.workspace.owner_id,
    seatLimit: context.workspace.seat_limit,
    myRole: context.membership.member_role,
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

// First-party checkout instrumentation. The browser calls this only after the billing endpoint has
// returned a usable checkout URL and immediately before navigation to the payment provider. We do
// not store browser fingerprints, checkout URLs, IP-derived identities, or third-party analytics IDs.
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
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const memberRole = ["admin", "member", "viewer"].includes(req.body?.memberRole)
      ? req.body.memberRole
      : "member";
    if (!email) return res.status(400).json({ error: "Member email is required." });

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
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
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
    if (!["owner", "admin"].includes(context.membership.member_role)) {
      return res.status(403).json({ error: "Workspace admin permission required." });
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
