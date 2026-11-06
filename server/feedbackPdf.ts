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
  conferenceTitle: string; organizerName?: string; eventDate?: string; role: string;
  ratings: Record<string, number>; comment?: string; recipientEmail?: string;
  participantName: string; participantCompany?: string; submitted?: boolean;
}

export function validFeedbackCopy(body: any): boolean {
  return typeof body?.conferenceTitle === "string" && body.conferenceTitle.trim().length > 0 && body.conferenceTitle.length <= 500
    && typeof body.role === "string" && body.role.length <= 100
    && typeof body.ratings === "object" && body.ratings !== null && !Array.isArray(body.ratings)
    && Object.keys(body.ratings).length > 0
    && Object.entries(body.ratings).every(([key, value]) => /^(speaker|event)_[0-4]$/.test(key) && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6)
    && (body.eventDate === undefined || (typeof body.eventDate === "string" && body.eventDate.length <= 160))
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
  y += 24;
  const line = (text: string, size = 10, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines: string[] = doc.splitTextToSize(text || "Not provided", width);
    for (const part of lines) {
      if (y > 270) { doc.addPage(); y = 22; }
      doc.text(part, margin, y);
      y += size * 0.38 + 1.1;
    }
    y += 1;
  };
  doc.setTextColor(30, 58, 138);
  line("Conference & Workshop Feedback", 18, true);
  doc.setTextColor(51, 65, 85);
  line(data.submitted ? "Submitted feedback copy" : "Draft feedback - not yet submitted", 9);
  line(data.conferenceTitle, 13, true);
  line(`Participant: ${data.participantName}`);
  if (data.participantCompany) line(`Organization: ${data.participantCompany}`);
  if (data.organizerName) line(`Event organizer: ${data.organizerName}`);
  line(`Event date: ${data.eventDate || "Not provided"}`);
  line(`Conference role: ${data.role}`);
  line(`Exported: ${new Date().toISOString().slice(0, 10)} (UTC)`);
  const values = Object.values(data.ratings);
  line(`Overall rating: ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} / 6`, 11, true);
  const tableWidth = width;
  const questionWidth = 83;
  const choiceWidth = (tableWidth - questionWidth) / feedbackScale.length;
  const pageLimit = 274;
  const tableHeader = (title: string) => {
    doc.setFillColor(30, 58, 138);
    doc.roundedRect(margin, y, tableWidth, 8, 1.4, 1.4, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, margin + 3, y + 5.2);
    y += 8;
    doc.setFillColor(228, 239, 254);
    doc.rect(margin, y, tableWidth, 8, "F");
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(7.1);
    doc.text("Question", margin + 3, y + 5);
    feedbackScale.forEach((label, i) => doc.text(label, margin + questionWidth + (i + 0.5) * choiceWidth, y + 5, { align: "center" }));
    y += 8;
  };
  for (const [section, items] of Object.entries(questions)) {
    const title = section === "speaker" ? "Speaker / Facilitator" : "Conference / Workshop Experience";
    if (y + 28 > pageLimit) { doc.addPage(); y = 18; }
    tableHeader(title);
    items.forEach((question, index) => {
      const rating = data.ratings[`${section}_${index}`];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      const lines: string[] = doc.splitTextToSize(question, questionWidth - 6);
      const rowHeight = Math.max(9, lines.length * 3.7 + (rating ? 4 : 7.2));
      if (y + rowHeight > pageLimit) {
        doc.addPage(); y = 18;
        tableHeader(title + " (continued)");
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.8);
      }
      if (index % 2) doc.setFillColor(242, 247, 255); else doc.setFillColor(255, 255, 255);
      doc.rect(margin, y, tableWidth, rowHeight, "F");
      doc.setTextColor(30, 41, 59);
      lines.forEach((part, i) => doc.text(part, margin + 3, y + 4.6 + i * 3.7));
      if (!rating) {
        doc.setFontSize(7);
        doc.setTextColor(71, 85, 105);
        doc.text("Not rated", margin + 3, y + rowHeight - 2.1);
      }
      feedbackScale.forEach((_, i) => {
        const left = margin + questionWidth + i * choiceWidth;
        const selected = rating === i + 1;
        if (selected) {
          doc.setFillColor(219, 234, 254);
          doc.rect(left, y, choiceWidth, rowHeight, "F");
          doc.setFillColor(29, 78, 216);
        }
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.35);
        doc.circle(left + choiceWidth / 2, y + rowHeight / 2, 1.65, selected ? "F" : "S");
      });
      doc.setDrawColor(218, 227, 240);
      doc.setLineWidth(0.2);
      doc.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
      y += rowHeight;
    });
    y += 5;
  }
  doc.setTextColor(51, 65, 85);
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
