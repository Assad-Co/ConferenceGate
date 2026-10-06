import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Router, Response } from "express";
import { jsPDF } from "jspdf";
import { AuthedRequest, requireAuth } from "./auth";
import { asyncHandler } from "./asyncHandler";
import { dbAll, dbGet, dbRun } from "./db";
import { canOperateWorkspace, resolvePaidAccountContext } from "./workspaceAccess";

export const meetingMinutesPdfRouter = Router();
meetingMinutesPdfRouter.use(requireAuth);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanFilename(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "meeting-minutes";
}

function pdfFilename(title: string, date: string) {
  return `${cleanFilename(title)}-${date || "undated"}.pdf`;
}

async function organizerContext(req: AuthedRequest, res: Response, write = false) {
  const context = await resolvePaidAccountContext(req.userId!, "organizer");
  if (!context) {
    res.status(403).json({ error: "Organizer account required." });
    return null;
  }
  if (!context.paid) {
    res.status(402).json({ error: "Organizer Pro subscription required." });
    return null;
  }
  if (write && !canOperateWorkspace(context.workspaceRole)) {
    res.status(403).json({ error: "This workspace seat is read-only." });
    return null;
  }
  return context;
}

async function ownedMinutes(req: AuthedRequest, res: Response, write = false) {
  const context = await organizerContext(req, res, write);
  if (!context) return null;
  const row = await dbGet<any>(
    "SELECT * FROM organizer_meeting_minutes WHERE id=? AND organizer_id=?",
    [req.params.id, context.accountId]
  );
  if (!row) {
    res.status(404).json({ error: "Meeting minutes not found." });
    return null;
  }
  return { context, row };
}

function documentData(row: any) {
  return {
    title: String(row.title || "Meeting Minutes"),
    conferenceTitle: String(row.conference_title || "Conference"),
    date: String(row.meeting_date || ""),
    time: String(row.meeting_time || ""),
    organizerTimezone: String(row.organizer_timezone || ""),
    chairName: String(row.chair_name || ""),
    preparedBy: String(row.prepared_by || ""),
    attendees: safeArray(row.attendees).map(String),
    objectives: String(row.objectives || ""),
    agenda: String(row.agenda || ""),
    discussionSummary: String(row.discussion_summary || ""),
    keyDecisions: String(row.key_decisions || ""),
    actionItems: safeArray(row.action_items),
    risksIssues: String(row.risks_issues || ""),
    nextSteps: String(row.next_steps || ""),
    nextMeetingDate: String(row.next_meeting_date || ""),
    notes: String(row.notes || ""),
  };
}

function buildPdfBuffer(row: any): Buffer {
  const data = documentData(row);
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 46;
  const contentWidth = pageWidth - margin * 2;
  let y = 46;

  const brandBlue = [15, 72, 155] as const;
  const navy = [15, 23, 42] as const;
  const slate = [71, 85, 105] as const;
  const light = [235, 244, 255] as const;

  const ensureSpace = (height: number) => {
    if (y + height <= pageHeight - 54) return;
    doc.addPage();
    y = 46;
  };

  const addWrapped = (text: string, size = 10, bold = false, color: readonly [number, number, number] = slate, indent = 0) => {
    const value = text.trim();
    if (!value) return;
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(value, contentWidth - indent);
    const lineHeight = size * 1.45;
    ensureSpace(lines.length * lineHeight + 4);
    doc.text(lines, margin + indent, y);
    y += lines.length * lineHeight + 4;
  };

  const addSection = (title: string, body: string) => {
    if (!body.trim()) return;
    ensureSpace(42);
    y += 9;
    doc.setFillColor(light[0], light[1], light[2]);
    doc.roundedRect(margin, y - 13, contentWidth, 24, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(brandBlue[0], brandBlue[1], brandBlue[2]);
    doc.text(title.toUpperCase(), margin + 10, y + 3);
    y += 27;
    addWrapped(body, 10, false, navy);
  };

  const logoPath = path.join(process.cwd(), "public", "conference-gate-logo.png");
  if (fs.existsSync(logoPath)) {
    const logo = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
    try { doc.addImage(logo, "PNG", pageWidth - margin - 145, 30, 145, 46); } catch { /* preserve PDF even if logo decoding fails */ }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(brandBlue[0], brandBlue[1], brandBlue[2]);
  doc.text("CONFERENCEGATE · OFFICIAL ORGANIZER RECORD", margin, 40);
  y = 88;
  doc.setFontSize(22);
  doc.setTextColor(navy[0], navy[1], navy[2]);
  doc.text("Meeting Minutes", margin, y);
  y += 24;
  doc.setFontSize(13);
  doc.setTextColor(brandBlue[0], brandBlue[1], brandBlue[2]);
  doc.text(doc.splitTextToSize(data.conferenceTitle, contentWidth), margin, y);
  y += 29;

  const details = [
    ["Meeting", data.title],
    ["Date", data.date],
    ["Time", [data.time, data.organizerTimezone].filter(Boolean).join(" · ")],
    ["Chair", data.chairName || "—"],
    ["Prepared by", data.preparedBy || "—"],
    ["Attendees", data.attendees.join(", ") || "—"],
  ];
  doc.setDrawColor(219, 234, 254);
  doc.setFillColor(248, 250, 252);
  const detailStart = y;
  const detailHeight = 18 + details.reduce((sum, [, value]) => sum + Math.max(17, doc.splitTextToSize(String(value), contentWidth - 105).length * 13), 0);
  ensureSpace(detailHeight + 10);
  doc.roundedRect(margin, y - 12, contentWidth, detailHeight, 8, 8, "FD");
  y += 7;
  for (const [label, value] of details) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(brandBlue[0], brandBlue[1], brandBlue[2]);
    doc.text(`${label}:`, margin + 12, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(navy[0], navy[1], navy[2]);
    const lines = doc.splitTextToSize(String(value), contentWidth - 105);
    doc.text(lines, margin + 95, y);
    y += Math.max(17, lines.length * 13);
  }
  y = Math.max(y + 8, detailStart + detailHeight + 4);

  addSection("Purpose & Objectives", data.objectives);
  addSection("Agenda / Main Points", data.agenda);
  addSection("Discussion Summary", data.discussionSummary);
  addSection("Key Decisions", data.keyDecisions);

  if (data.actionItems.length) {
    ensureSpace(46);
    y += 9;
    doc.setFillColor(light[0], light[1], light[2]);
    doc.roundedRect(margin, y - 13, contentWidth, 24, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(brandBlue[0], brandBlue[1], brandBlue[2]);
    doc.text("ACTION ITEMS", margin + 10, y + 3);
    y += 30;
    data.actionItems.forEach((item: any, index: number) => {
      const action = String(item?.action || "").trim();
      if (!action) return;
      ensureSpace(68);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(navy[0], navy[1], navy[2]);
      const actionLines = doc.splitTextToSize(`${index + 1}. ${action}`, contentWidth - 6);
      doc.text(actionLines, margin + 3, y);
      y += actionLines.length * 14 + 4;
      const meta = [`Owner: ${item.owner || "—"}`, `Due: ${item.dueDate || "—"}`, `Status: ${item.status || "Open"}`].join("   ·   ");
      addWrapped(meta, 9, false, slate, 14);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin + 3, y - 1, pageWidth - margin - 3, y - 1);
      y += 7;
    });
  }

  addSection("Risks / Issues", data.risksIssues);
  addSection("Next Steps", data.nextSteps);
  addSection("Next Meeting", data.nextMeetingDate);
  addSection("Additional Notes", data.notes);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(219, 234, 254);
    doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text("Generated by ConferenceGate · Official organizer workspace record", margin, pageHeight - 22);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 22, { align: "right" });
  }

  doc.setProperties({ title: data.title, subject: `Meeting minutes for ${data.conferenceTitle}`, author: "ConferenceGate", creator: "ConferenceGate" });
  return Buffer.from(doc.output("arraybuffer"));
}

function senderEmail() {
  return (process.env.MEETING_MINUTES_FROM_EMAIL || process.env.PASSWORD_RESET_FROM_EMAIL || "").trim();
}

function emailConfigured() {
  const from = senderEmail().replace(/^.*<([^>]+)>.*$/, "$1");
  return Boolean(process.env.RESEND_API_KEY?.trim()) && EMAIL_RE.test(from);
}

async function resolveRecipients(row: any, organizerId: string, extraEmails: string[] = []) {
  const userIds = new Set<string>();
  const professionals = await dbAll<{ professional_id: string }>(
    "SELECT DISTINCT professional_id FROM professional_invitations WHERE organizer_id=? AND conference_id=? AND status IN ('accepted','completed')",
    [organizerId, row.conference_id]
  );
  professionals.forEach((item) => userIds.add(item.professional_id));

  const registrations = await dbAll<{ user_id: string }>(
    "SELECT DISTINCT user_id FROM conference_registrations WHERE conference_id=?",
    [row.conference_id]
  );
  registrations.forEach((item) => userIds.add(item.user_id));

  const reviewers = await dbAll<{ reviewer_id: string }>(
    "SELECT DISTINCT a.reviewer_id FROM submission_reviewer_assignments a JOIN submissions s ON s.id=a.submission_id WHERE s.conference_id=?",
    [row.conference_id]
  );
  reviewers.forEach((item) => userIds.add(item.reviewer_id));

  const authors = await dbAll<{ submitter_id: string }>(
    "SELECT DISTINCT submitter_id FROM submissions WHERE conference_id=? AND is_external=0",
    [row.conference_id]
  );
  authors.forEach((item) => userIds.add(item.submitter_id));

  const recipients: Array<{ id?: string; name: string; email: string }> = [];
  for (const userId of userIds) {
    const user = await dbGet<{ id: string; name: string; email: string }>("SELECT id,name,email FROM users WHERE id=?", [userId]);
    if (user?.email && EMAIL_RE.test(user.email)) recipients.push({ id: user.id, name: user.name || "", email: user.email.toLowerCase() });
  }

  const storedExtra = safeArray(row.external_emails).map(String);
  for (const raw of [...storedExtra, ...extraEmails]) {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    if (!recipients.some((recipient) => recipient.email === email)) recipients.push({ name: "", email });
  }
  return recipients;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] || char));
}

async function sendPdfEmail(input: { to: string; recipientName?: string; row: any; pdf: Buffer }) {
  if (!emailConfigured()) throw new Error("Meeting-minutes email delivery is not configured.");
  const data = documentData(input.row);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: senderEmail(),
      to: [input.to],
      subject: `Meeting Minutes — ${data.title}`,
      text: `${input.recipientName ? `Dear ${input.recipientName},` : "Hello,"}\n\nPlease find attached the official PDF meeting minutes for ${data.title}.\nConference: ${data.conferenceTitle}\nDate: ${data.date}\n\nIssued from the ConferenceGate organizer workspace.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#0f172a;line-height:1.6"><h2 style="color:#0f489b">Meeting Minutes</h2><p>${input.recipientName ? `Dear ${escapeHtml(input.recipientName)},` : "Hello,"}</p><p>Please find attached the official PDF meeting minutes for <strong>${escapeHtml(data.title)}</strong>.</p><p><strong>Conference:</strong> ${escapeHtml(data.conferenceTitle)}<br/><strong>Date:</strong> ${escapeHtml(data.date)}</p><p style="color:#64748b;font-size:13px">Issued from the ConferenceGate organizer workspace.</p></div>`,
      attachments: [{ filename: pdfFilename(data.title, data.date), content: input.pdf.toString("base64") }],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Email provider returned HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
}

meetingMinutesPdfRouter.get("/:id/pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await ownedMinutes(req, res);
  if (!loaded) return;
  const pdf = buildPdfBuffer(loaded.row);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${pdfFilename(loaded.row.title, loaded.row.meeting_date)}"`);
  res.send(pdf);
}));

meetingMinutesPdfRouter.get("/:id/gmail-draft", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await ownedMinutes(req, res);
  if (!loaded) return;
  const recipients = await resolveRecipients(loaded.row, loaded.context.accountId);
  const data = documentData(loaded.row);
  res.json({
    recipients: recipients.map((recipient) => recipient.email),
    recipientCount: recipients.length,
    subject: `Meeting Minutes — ${data.title}`,
    body: `Dear Conference Members,\n\nPlease find attached the official PDF meeting minutes for ${data.title}.\nConference: ${data.conferenceTitle}\nDate: ${data.date}\n\nRegards,\nConference Organizer`,
  });
}));

meetingMinutesPdfRouter.post("/:id/send-pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await ownedMinutes(req, res, true);
  if (!loaded) return;
  const extraEmails = Array.isArray(req.body?.externalEmails) ? req.body.externalEmails.filter((value: unknown) => typeof value === "string") : [];
  const recipients = await resolveRecipients(loaded.row, loaded.context.accountId, extraEmails);
  if (!recipients.length) return res.status(400).json({ error: "No conference member email addresses are available yet." });
  const configured = emailConfigured();
  if (!configured) {
    return res.json({ emailConfigured: false, recipientCount: recipients.length, emailSentCount: 0, emailFailedCount: 0 });
  }
  const pdf = buildPdfBuffer(loaded.row);
  let emailSentCount = 0;
  let emailFailedCount = 0;
  for (const recipient of recipients) {
    try {
      await sendPdfEmail({ to: recipient.email, recipientName: recipient.name, row: loaded.row, pdf });
      emailSentCount += 1;
      if (recipient.id) {
        await dbRun(
          "INSERT INTO notifications(id,user_id,type,title,message) VALUES(?,?,?,?,?)",
          [`ntf_${crypto.randomUUID()}`, recipient.id, "agenda", `Meeting minutes: ${loaded.row.title}`, `${loaded.row.conference_title}: the organizer emailed you the official PDF meeting minutes.`]
        );
      }
    } catch {
      emailFailedCount += 1;
    }
  }
  await dbRun("UPDATE organizer_meeting_minutes SET distributed_at=datetime('now'),send_email=1,updated_at=datetime('now') WHERE id=?", [loaded.row.id]);
  const updated = await dbGet<{ distributed_at: string | null }>("SELECT distributed_at FROM organizer_meeting_minutes WHERE id=?", [loaded.row.id]);
  res.json({ emailConfigured: true, recipientCount: recipients.length, emailSentCount, emailFailedCount, distributedAt: updated?.distributed_at || null });
}));
