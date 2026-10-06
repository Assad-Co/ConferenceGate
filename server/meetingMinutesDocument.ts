import fs from "fs";
import path from "path";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export interface MeetingMinutesActionItem {
  action: string;
  owner: string;
  dueDate: string;
  status: string;
}

export interface MeetingMinutesDocumentData {
  title: string;
  conferenceTitle: string;
  date: string;
  time?: string;
  organizerTimezone?: string;
  chairName?: string;
  preparedBy?: string;
  attendees: string[];
  objectives?: string;
  agenda?: string;
  discussionSummary?: string;
  keyDecisions?: string;
  actionItems: MeetingMinutesActionItem[];
  risksIssues?: string;
  nextSteps?: string;
  nextMeetingDate?: string;
  notes?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanFilename(value: string) {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "meeting-minutes";
}

export function meetingMinutesFilename(title: string, date: string) {
  return `${cleanFilename(title)}-${date || "undated"}.docx`;
}

function labelParagraph(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 90 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: "1E3A8A" }),
      new TextRun({ text: value || "—", color: "334155" }),
    ],
  });
}

function section(title: string, body: string) {
  if (!body.trim()) return [];
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 220, after: 90 },
      children: [new TextRun({ text: title, bold: true, color: "172554" })],
    }),
    ...body
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => new Paragraph({ text: line, spacing: { after: 80 } })),
  ];
}

export async function buildMeetingMinutesDocxBuffer(data: MeetingMinutesDocumentData): Promise<Buffer> {
  const logoPath = path.join(process.cwd(), "public", "conference-gate-logo.png");
  const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

  const headerChildren: Paragraph[] = [];
  if (logo) {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        children: [
          new ImageRun({
            type: "png",
            data: logo,
            transformation: { width: 180, height: 58 },
          }),
        ],
      })
    );
  }
  headerChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
      children: [new TextRun({ text: "MEETING MINUTES", bold: true, color: "172554", size: 34 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      children: [new TextRun({ text: data.conferenceTitle || "ConferenceGate", color: "64748B", size: 22 })],
    })
  );

  const meetingDetails = [
    labelParagraph("Meeting", data.title),
    labelParagraph("Date", data.date),
    labelParagraph("Time", [data.time, data.organizerTimezone].filter(Boolean).join(" · ")),
    labelParagraph("Chair", data.chairName || ""),
    labelParagraph("Prepared by", data.preparedBy || ""),
    labelParagraph("Attendees", data.attendees.join(", ")),
  ];

  const actionRows = data.actionItems.length
    ? [
        new TableRow({
          tableHeader: true,
          children: ["Action", "Owner", "Due Date", "Status"].map(
            (value) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: value, bold: true, color: "FFFFFF" })] })],
                shading: { fill: "1E3A8A" },
              })
          ),
        }),
        ...data.actionItems.map(
          (item) =>
            new TableRow({
              children: [item.action, item.owner, item.dueDate, item.status].map(
                (value) => new TableCell({ children: [new Paragraph({ text: value || "—" })] })
              ),
            })
        ),
      ]
    : [];

  const children: any[] = [
    ...headerChildren,
    ...meetingDetails,
    ...section("Purpose & Objectives", data.objectives || ""),
    ...section("Agenda / Main Points", data.agenda || ""),
    ...section("Discussion Summary", data.discussionSummary || ""),
    ...section("Key Decisions", data.keyDecisions || ""),
  ];

  if (actionRows.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 90 },
        children: [new TextRun({ text: "Action Items", bold: true, color: "172554" })],
      }),
      new Table({ rows: actionRows, width: { size: 100, type: WidthType.PERCENTAGE } })
    );
  }

  children.push(
    ...section("Risks / Issues", data.risksIssues || ""),
    ...section("Next Steps", data.nextSteps || ""),
    ...section("Next Meeting", data.nextMeetingDate || ""),
    ...section("Additional Notes", data.notes || ""),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 360 },
      children: [
        new TextRun({
          text: "Generated by ConferenceGate · Official organizer workspace record",
          color: "94A3B8",
          italics: true,
          size: 18,
        }),
      ],
    })
  );

  const doc = new Document({
    creator: "ConferenceGate",
    title: data.title,
    description: `Meeting minutes for ${data.conferenceTitle}`,
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

function senderEmail() {
  return (process.env.MEETING_MINUTES_FROM_EMAIL || process.env.PASSWORD_RESET_FROM_EMAIL || "").trim();
}

export function meetingMinutesEmailConfigured() {
  const from = senderEmail().replace(/^.*<([^>]+)>.*$/, "$1");
  return Boolean(process.env.RESEND_API_KEY?.trim()) && EMAIL_RE.test(from);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char] || char));
}

export async function sendMeetingMinutesEmail(input: {
  to: string;
  recipientName?: string;
  data: MeetingMinutesDocumentData;
  documentBuffer: Buffer;
}) {
  if (!meetingMinutesEmailConfigured()) {
    throw new Error("Meeting-minutes email delivery is not configured.");
  }
  const subject = `Meeting Minutes — ${input.data.title}`;
  const filename = meetingMinutesFilename(input.data.title, input.data.date);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderEmail(),
      to: [input.to],
      subject,
      text: [
        input.recipientName ? `Dear ${input.recipientName},` : "Hello,",
        "",
        `Please find attached the meeting minutes for ${input.data.title}.`,
        `Conference: ${input.data.conferenceTitle}`,
        `Date: ${input.data.date}`,
        "",
        "This document was issued from the ConferenceGate organizer workspace.",
      ].join("\n"),
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#0f172a;line-height:1.6">
        <h2 style="color:#172554">Meeting Minutes</h2>
        <p>${input.recipientName ? `Dear ${escapeHtml(input.recipientName)},` : "Hello,"}</p>
        <p>Please find attached the meeting minutes for <strong>${escapeHtml(input.data.title)}</strong>.</p>
        <p><strong>Conference:</strong> ${escapeHtml(input.data.conferenceTitle)}<br/><strong>Date:</strong> ${escapeHtml(input.data.date)}</p>
        <p style="color:#64748b;font-size:13px">Issued from the ConferenceGate organizer workspace.</p>
      </div>`,
      attachments: [
        {
          filename,
          content: input.documentBuffer.toString("base64"),
        },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend returned HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
}
