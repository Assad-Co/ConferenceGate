import nodemailer from "nodemailer";

type Environment = Record<string, string | undefined>;
type CapturedMessage = { to: string; subject: string; text: string; html: string };
type TransportOptions = {
  host: string; port: number; secure: boolean; requireTLS: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number; greetingTimeout: number; socketTimeout: number;
  logger: false; debug: false;
};
type Transport = { sendMail: (message: CapturedMessage & { from: string }) => Promise<unknown>; close: () => void };
type TransportFactory = (options: TransportOptions) => Transport;

// A real customer address can never enter the test transport, even if misconfigured.
export function isSyntheticTestEmail(email: string): boolean {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@example\.invalid$/i.test(email.trim());
}

export function testEmailConfigured(email: string, env: Environment = process.env): boolean {
  const normalized = email.trim().toLowerCase();
  const recipients = (env.ETHEREAL_TEST_RECIPIENTS || "").split(",").map(value => value.trim().toLowerCase());
  return isSyntheticTestEmail(normalized) && normalized.startsWith("qa-") &&
    recipients.includes(normalized) && Boolean(env.ETHEREAL_TEST_USER?.trim()) &&
    Boolean(env.ETHEREAL_TEST_PASSWORD?.trim());
}

// Return false only for real mail. A disabled/broken synthetic route never falls back to Resend.
export async function captureTestEmail(
  message: CapturedMessage,
  env: Environment = process.env,
  createTransport: TransportFactory = options => nodemailer.createTransport(options),
): Promise<boolean> {
  if (!isSyntheticTestEmail(message.to)) return false;
  if (!testEmailConfigured(message.to, env)) throw new Error("Synthetic email capture is not configured.");
  const transport = createTransport({
    host: "smtp.ethereal.email", port: 587, secure: false, requireTLS: true,
    auth: { user: env.ETHEREAL_TEST_USER!.trim(), pass: env.ETHEREAL_TEST_PASSWORD!.trim() },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false,
  });
  try {
    await transport.sendMail({ ...message, to: message.to.trim().toLowerCase(), from: "ConferenceGate QA <no-reply@example.invalid>" });
    return true;
  } finally {
    transport.close();
  }
}
