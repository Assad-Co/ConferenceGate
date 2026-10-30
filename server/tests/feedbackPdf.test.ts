import test from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackPdf, emailFeedbackCopy, feedbackFilename, validFeedbackCopy } from "../feedbackPdf";

const copy = {
  conferenceTitle: "Conference feedback sample", participantName: "Sample Participant",
  participantCompany: "Example Organization", organizerName: "Example Organizer",
  role: "Moderator", ratings: { speaker_0: 6, event_1: 4 },
  comment: "Clear presentations and useful discussions.", recipientEmail: "organizer@example.org",
};

test("PDF includes logo, truthful draft status, all questions and unanswered ratings", () => {
  const pdf = buildFeedbackPdf(copy).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-"));
  assert.match(pdf, /\/Subtype \/Image/);
  assert.match(pdf, /Draft feedback - not yet submitted/);
  assert.match(pdf, /Sample Participant/);
  assert.match(pdf, /Excellent/);
  assert.match(pdf, /Not rated/);
  assert.match(pdf, /Overall feedback/);
  assert.match(pdf, /Clear presentations/);
  assert.doesNotMatch(feedbackFilename('../../\r\nunsafe'), /[\r\n/]/);
});

test("long comments paginate without dropping the ending", () => {
  const pdf = buildFeedbackPdf({ ...copy, comment: "Detailed feedback. ".repeat(250) + "FINAL COMMENT MARKER", submitted: true }).toString("latin1");
  assert.match(pdf, /Submitted feedback copy/);
  assert.match(pdf, /FINAL COMMENT MARKER/);
  assert.ok((pdf.match(/\/Type \/Page\b/g) || []).length >= 2);
});

test("reject malformed ratings, unknown questions, empty ratings and oversized content", () => {
  assert.equal(validFeedbackCopy(copy), true);
  for (const ratings of [{}, [], { event_0: 7 }, { event_0: 1.5 }, { event_0: "6" }, { event_100: 3 }]) assert.equal(validFeedbackCopy({ ...copy, ratings }), false);
  assert.equal(validFeedbackCopy({ ...copy, comment: "x".repeat(6001) }), false);
});

test("requested email attaches PDF and addresses account owner, never follow-up contact", async () => {
  Object.assign(process.env, { SMTP_HOST: "smtp.example.org", SMTP_USER: "test", SMTP_PASSWORD: "test", INTELLIGENCE_EMAIL_FROM: "ConferenceGate <support@example.org>" });
  let message: any; let closed = false;
  const factory = (() => ({ sendMail: async (mail: any) => { message = mail; return { accepted: [mail.to] }; }, close: () => { closed = true; } })) as any;
  const account = { id: "test-copy", email: "owner@example.org" };
  assert.equal(await emailFeedbackCopy(account, { ...copy, submitted: true }, factory), "sent");
  assert.equal(message.to, account.email);
  assert.ok(message.attachments.some((file: any) => file.contentType === "application/pdf" && file.content.toString("latin1").startsWith("%PDF-")));
  assert.match(message.html, /cid:conferencegate-logo/);
  assert.equal(closed, true);
  assert.equal(await emailFeedbackCopy(account, copy, factory), "rate_limited");
});

test("SMTP failure is explicit and closes transport without retrying", async () => {
  let calls = 0; let closed = false;
  const factory = (() => ({ sendMail: async () => { calls++; throw new Error("SMTP unavailable"); }, close: () => { closed = true; } })) as any;
  assert.equal(await emailFeedbackCopy({ id: "test-failure", email: "owner@example.org" }, copy, factory), "failed");
  assert.equal(calls, 1); assert.equal(closed, true);
});
