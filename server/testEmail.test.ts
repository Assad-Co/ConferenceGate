import test from "node:test";
import assert from "node:assert/strict";
import { captureTestEmail, testEmailConfigured } from "./testEmail";

const recipient = "qa-recovery@example.invalid";
const env = { ETHEREAL_TEST_RECIPIENTS: recipient, ETHEREAL_TEST_USER: "test-only-user", ETHEREAL_TEST_PASSWORD: "test-only-password" };
const message = { to: recipient, subject: "Reset password", text: "Test reset content", html: "<p>Test reset content</p>" };

test("customer mail cannot be captured even when explicitly misconfigured", async () => {
  const customer = "customer@example.com";
  assert.equal(testEmailConfigured(customer, { ...env, ETHEREAL_TEST_RECIPIENTS: customer }), false);
  assert.equal(await captureTestEmail({ ...message, to: customer }, env, () => { throw new Error("Must not create transport"); }), false);
});

test("synthetic capture requires exact allowlisting and complete credentials", () => {
  assert.equal(testEmailConfigured(recipient, env), true);
  assert.equal(testEmailConfigured("qa-other@example.invalid", env), false);
  assert.equal(testEmailConfigured(recipient, { ...env, ETHEREAL_TEST_PASSWORD: "" }), false);
  assert.equal(testEmailConfigured("owner@example.invalid", { ...env, ETHEREAL_TEST_RECIPIENTS: "owner@example.invalid" }), false);
  assert.equal(testEmailConfigured("qa-recovery@example.invalid.attacker.com", env), false);
});

test("disabled synthetic transport fails closed rather than falling back", async () => {
  await assert.rejects(captureTestEmail(message, {}), /not configured/);
});

test("capture uses the fixed TLS-required sandbox and preserves template", async () => {
  let closed = false;
  let sent: unknown;
  assert.equal(await captureTestEmail(message, env, options => {
    assert.equal(options.host, "smtp.ethereal.email");
    assert.equal(options.port, 587);
    assert.equal(options.requireTLS, true);
    assert.equal(options.logger, false);
    assert.equal(options.debug, false);
    return { sendMail: async value => { sent = value; }, close: () => { closed = true; } };
  }), true);
  assert.deepEqual(sent, { ...message, from: "ConferenceGate QA <no-reply@example.invalid>" });
  assert.equal(closed, true);
});

test("capture closes failed connections and never reports false success", async () => {
  let closed = false;
  await assert.rejects(captureTestEmail(message, env, () => ({
    sendMail: async () => { throw new Error("SMTP unavailable"); }, close: () => { closed = true; },
  })), /SMTP unavailable/);
  assert.equal(closed, true);
});
