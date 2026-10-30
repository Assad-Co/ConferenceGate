import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { brandedEmail, createEmailTransport, emailLogoAttachment } from "./emailTransport";

export const feedbackScale = ["Very Poor", "Poor", "Fair", "Good", "Very Good", "Excellent"];
const questions = {
  speaker: ["Did the speaker/facilitator explain the material clearly?", "Was the speaker willing to answer your questions?", "Did the speaker demonstrate strong subject-matter expertise?", "Would you attend another session led by this speaker?", "Would you recommend this speaker to fellow professionals?"],
  event: ["Were the session/event objectives clearly stated at the outset?", "Were the objectives met?", "Was the content appropriate for your interests and level?", "Do you consider this event good value for the registration cost?", "Would you recommend this event to fellow professionals?"],
};
export interface FeedbackCopy {
  conferenceTitle: string; organizerName?: string; role: string;
  ratings: Record<string, number>; comment?: string; recipientEmail?: string;
  participantName: string; participantCompany?: string; submitted?: boolean;
}

export function validFeedbackCopy(body: any): boolean {
  return typeof body?.conferenceTitle === "string" && body.conferenceTitle.trim().length > 0 && body.conferenceTitle.length <= 500
    && typeof body.role === "string" && body.role.length <= 100
    && typeof body.ratings === "object" && body.ratings !== null && !Array.isArray(body.ratings)
    && Object.keys(body.ratings).length > 0
    && Object.entries(body.ratings).every(([key, value]) => /^(speaker|event)_[0-4]$/.test(key) && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6)
    && [body.organizerName, body.comment, body.recipientEmail].every(value => value === undefined || (typeof value === "string" && value.length <= 6000));
}

export function feedbackFilename(title: string) {
  return `ConferenceGate-feedback-${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70) || "conference"}.pdf`;
}

export function buildFeedbackPdf(data: FeedbackCopy): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 18, width = 174;
  let y = 18;
  const logo = fs.readFileSync(path.join(process.cwd(), "public", "conference-gate-logo.png"));
  const image = doc.getImageProperties(new Uint8Array(logo));
  doc.addImage(new Uint8Array(logo), "PNG", margin, y, 58, 58 * image.height / image.width);
  y += 28;
  const line = (text: string, size = 10, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(text || "Not provided", width);
    for (const part of lines) {
      if (y > 270) { doc.addPage(); y = 22; }
      doc.text(part, margin, y);
      y += size * 0.45 + 1.5;
    }
    y += 2;
  };
  doc.setTextColor(30, 58, 138);
  line("Conference & Workshop Feedback", 18, true);
  doc.setTextColor(51, 65, 85);
  line(data.submitted ? "Submitted feedback copy" : "Draft feedback - not yet submitted", 9);
  line(data.conferenceTitle, 13, true);
  line(`Participant: ${data.participantName}`);
  if (data.participantCompany) line(`Organization: ${data.participantCompany}`);
  if (data.organizerName) line(`Event organizer: ${data.organizerName}`);
  line(`Conference role: ${data.role}`);
  line(`Exported: ${new Date().toISOString().slice(0, 10)} (UTC)`);
  const values = Object.values(data.ratings);
  line(`Overall rating: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} / 6`, 11, true);
  for (const [section, items] of Object.entries(questions)) {
    if (y > 240) { doc.addPage(); y = 22; }
    line(section === "speaker" ? "Speaker / Facilitator" : "Conference / Workshop Experience", 12, true);
    items.forEach((question, index) => {
      const rating = data.ratings[`${section}_${index}`];
      line(`${question}  ${rating ? `${feedbackScale[rating - 1]} (${rating}/6)` : "Not rated"}`, 10);
    });
  }
  line("Overall feedback", 12, true);
  line(data.comment || "No additional comments.");
  if (data.recipientEmail) line(`Follow-up contact (record only): ${data.recipientEmail}`, 9);
  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
    doc.text("conferencegate.com | Participant feedback - not a certificate or endorsement", margin, 286);
    doc.text(`${page} / ${count}`, 192, 286, { align: "right" });
  }
  return Buffer.from(doc.output("arraybuffer"));
}

// Bound self-copy delivery per account; no automatic retries after SMTP uncertainty.
const lastSent = new Map<string, number>();
export async function emailFeedbackCopy(account: { id: string; email: string }, data: FeedbackCopy, transportFactory = createEmailTransport, now = Date.now()): Promise<"sent" | "unavailable" | "rate_limited" | "failed"> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.INTELLIGENCE_EMAIL_FROM) return "unavailable";
  if ((lastSent.get(account.id) || 0) > now - 60_000) return "rate_limited";
  for (const [id, time] of lastSent) if (time <= now - 60_000) lastSent.delete(id);
  lastSent.set(account.id, now);
  let transport: ReturnType<typeof createEmailTransport> | undefined;
  try {
    const pdf = buildFeedbackPdf(data);
    transport = transportFactory();
    const text = `Your feedback PDF for ${data.conferenceTitle} is attached. You can save it or forward it yourself. This copy was requested from your ConferenceGate account.`;
    const result = await transport.sendMail({
      from: process.env.INTELLIGENCE_EMAIL_FROM, to: account.email,
      subject: "ConferenceGate - Your feedback PDF copy", text,
      html: brandedEmail("Your feedback PDF copy", text),
      attachments: [...emailLogoAttachment(), { filename: feedbackFilename(data.conferenceTitle), content: pdf, contentType: "application/pdf" }],
    });
    return result.accepted?.length ? "sent" : "failed";
  } catch { return "failed"; }
  finally { transport?.close(); }
}
