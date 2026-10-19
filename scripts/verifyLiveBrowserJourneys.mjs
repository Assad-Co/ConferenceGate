import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const base = process.env.PHASE11_BASE_URL || 'https://conferencegate.onrender.com';
const out = 'browser-validation';
await fs.mkdir(out, { recursive: true });
const report = { target: base, roles: [], failures: [] };
const browser = await chromium.launch({ headless: true });
const roles = [
  { role: 'professional', label: 'Professional', marker: 'Discover Conferences' },
  { role: 'organizer', label: 'Conference Organizer', marker: 'Organizer Operations & Lifecycle Hub' },
  { role: 'sponsor', label: 'Corporate Sponsor', marker: 'Sponsor Marketplace & ROI Dashboard' },
];
try {
  const capabilitiesResponse = await fetch(base + '/api/auth/capabilities');
  if (!capabilitiesResponse.ok) throw Error('Cannot determine public registration policy');
  const capabilities = await capabilitiesResponse.json();
  report.privateWorkspacesOnly = capabilities.privateWorkspacesOnly === true;
  for (const spec of roles.filter(item => !report.privateWorkspacesOnly || item.role === 'professional')) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = { role: spec.role, checks: [], runtimeErrors: errors };
    report.roles.push(result);
    const check = (condition, name) => { if (!condition) throw Error(name); result.checks.push(name); };
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Join Now', exact: true }).click();
      if (report.privateWorkspacesOnly) {
        check(await page.getByRole('button', { name: 'Conference Organizer', exact: true }).count() === 0, 'Organizer signup hidden');
        check(await page.getByRole('button', { name: 'Corporate Sponsor', exact: true }).count() === 0, 'Sponsor signup hidden');
      }
      await page.getByRole('button', { name: spec.label, exact: true }).click();
      await page.getByPlaceholder('Your full name', { exact: true }).fill('UI Acceptance ' + spec.role);
      await page.getByPlaceholder('you@example.com', { exact: true }).fill('ui-' + spec.role + '-' + crypto.randomUUID() + '@example.invalid');
      const password = crypto.randomBytes(24).toString('base64url') + '!9a';
      await page.getByPlaceholder('At least 8 characters', { exact: true }).fill(password);
      await page.getByPlaceholder('Re-enter password', { exact: true }).fill(password);
      const signupResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/signup') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      const response = await signupResponse;
      const data = await response.json();
      check(response.status() === 201 && data.user?.role === spec.role && data.user?.hasPaidAccess === true, 'browser signup grants immediate free role access');
      if (spec.role === 'professional') {
        await page.getByRole('button', { name: 'Go to Conference Gate', exact: true }).waitFor({ state: 'visible' });
        await page.screenshot({ path: out + '/professional-onboarding.png', fullPage: true });
        await page.getByRole('button', { name: 'Go to Conference Gate', exact: true }).click();
        result.checks.push('professional welcome onboarding completes');
      }
      await page.getByText(spec.marker, { exact: true }).first().waitFor({ state: 'visible', timeout: 45000 });
      check(await page.getByRole('button', { name: /^Subscribe to/ }).count() === 0, 'dashboard accessible without subscription prompt');
      await page.screenshot({ path: out + '/' + spec.role + '-desktop.png', fullPage: true });
      result.checks.push('desktop dashboard rendered');
      if (report.privateWorkspacesOnly) {
        check(await page.getByRole('heading', { name: /Organizer Operations|Sponsor Marketplace/ }).count() === 0, 'Private dashboards absent from public Professional view');
      }
      if (spec.role === 'organizer') {
        await page.getByRole('button', { name: /Create New Conference Wizard/ }).click();
        await page.getByRole('heading', { name: 'Create Conference Wizard', exact: true }).waitFor({ state: 'visible' });
        await page.screenshot({ path: out + '/organizer-create-wizard.png', fullPage: true });
        result.checks.push('conference creation wizard opens');
      }
      if (spec.role === 'sponsor') {
        await page.getByRole('button', { name: /Sponsorship Marketplace/ }).click();
        await page.getByRole('heading', { name: 'Find organizers actively seeking sponsors', exact: true }).waitFor({ state: 'visible' });
        await page.screenshot({ path: out + '/sponsor-marketplace.png', fullPage: true });
        result.checks.push('sponsorship marketplace opens');
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(spec.marker, { exact: true }).first().waitFor({ state: 'visible', timeout: 45000 });
      result.checks.push('session and role dashboard survive reload');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByText(spec.marker, { exact: true }).first().waitFor({ state: 'visible' });
      await page.screenshot({ path: out + '/' + spec.role + '-mobile.png', fullPage: true });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      result.mobileLayout = layout;
      check(layout.content <= layout.viewport + 8, 'mobile page has no horizontal overflow');
      check(errors.length === 0, 'no uncaught browser runtime errors');
      result.passed = true;
    } catch (error) {
      result.passed = false;
      result.error = error.message;
      report.failures.push(spec.role + ': ' + error.message);
      await page.screenshot({ path: out + '/' + spec.role + '-failure.png', fullPage: true }).catch(() => {});
      result.visibleText = (await page.locator('body').innerText().catch(() => '')).slice(0, 16000);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.failures.length) process.exitCode = 1;
