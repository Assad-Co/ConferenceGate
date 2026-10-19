import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';
const live = Boolean(process.env.COMMUNICATIONS_BASE_URL);
const base = process.env.COMMUNICATIONS_BASE_URL || 'http://127.0.0.1:3153';
const label = live ? 'production' : 'isolated';
const out = 'communications-validation/' + label;
await fs.mkdir(out, { recursive: true });
const dbPath = '/tmp/cg-communications-' + process.pid + '.db';
const ownerEmail = 'communications-owner@example.invalid';
let child, serverLog = '';
const report = { target: base, mode: label, checks: [], layouts: [], browserErrors: [], failures: [] };
function check(value, message) { if (!value) throw Error(message); report.checks.push(message); }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(250); }
  throw Error(message);
}
async function api(context, path, { method = 'GET', body, status = 200 } = {}) {
  const response = await context.request.fetch(base + path, { method, data: body });
  const data = await response.json();
  if (response.status() !== status) throw Error(method + ' ' + path + ': ' + response.status() + ' ' + JSON.stringify(data));
  return data;
}
let browser;
const accounts = [];
try {
  if (!live) {
    child = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, NODE_ENV: 'production', PORT: '3153', TEST_DATABASE_PATH: dbPath, DATABASE_PATH: dbPath, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', PRIVATE_WORKSPACES_ONLY: 'true', OWNER_PREVIEW_EMAIL_SHA256: crypto.createHash('sha256').update(ownerEmail).digest('hex') }, stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', c => serverLog += c);
    child.stderr.on('data', c => serverLog += c);
    await until(async () => { if (child.exitCode !== null) throw Error(serverLog); try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 'Local server did not start', 40000);
  }
  browser = await chromium.launch({ headless: true });
  const run = crypto.randomUUID().slice(0, 8);
  async function account(tag, email) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const name = 'CG Audit ' + tag + ' ' + run;
    const user = (await api(context, '/api/auth/signup', { method: 'POST', status: 201, body: { role: 'professional', name, email: email || 'comm-' + tag + '-' + run + '@example.invalid', password: crypto.randomBytes(24).toString('base64url') + '!9a' } })).user;
    const page = await context.newPage();
    page.on('pageerror', error => report.browserErrors.push(error.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByTitle('Direct Messages', { exact: true }).waitFor({ state: 'visible' });
    const result = { context, page, name, user };
    accounts.push(result);
    return result;
  }
  const a = await account('Alpha');
  const b = await account('Bravo');
  const c = await account('Charlie');
  const anonymous = await browser.newContext();
  await api(anonymous, '/api/messages/conversations', { status: 401 });
  await api(anonymous, '/api/activity/notifications/mine', { status: 401 });
  check(true, 'Anonymous message and notification access rejected');
  await anonymous.close();
  const frames = [];
  b.page.on('websocket', socket => socket.on('framereceived', event => frames.push(String(event.payload))));
  // The already-open socket is instrumented independently through a fresh authenticated tab.
  const receiver = await b.context.newPage();
  receiver.on('pageerror', error => report.browserErrors.push(error.message));
  receiver.on('websocket', socket => socket.on('framereceived', event => frames.push(String(event.payload))));
  await receiver.goto(base, { waitUntil: 'domcontentloaded' });
  await receiver.getByText('Discover Conferences', { exact: true }).first().waitFor({ state: 'visible' });
  await sleep(700);
  await a.page.getByTitle('Direct Messages', { exact: true }).click();
  await a.page.getByPlaceholder('Find registered members...', { exact: true }).fill(b.name);
  await a.page.getByRole('button').filter({ hasText: b.name }).last().click();
  const text = 'Synthetic audit hello ' + run + ' <script>window.auditInjected=true</script>';
  await a.page.getByPlaceholder('Message ' + b.name + '...').fill(text);
  await a.page.getByRole('button', { name: 'Send message', exact: true }).click();
  await until(() => Promise.resolve(frames.some(frame => frame.includes(text))), 'WebSocket did not deliver incoming message', 8000);
  await receiver.locator('button[title="Direct Messages"] span').waitFor({ state: 'visible' });
  check(true, 'Real-time delivery and incoming unread badge work without reload');
  await receiver.getByTitle('Direct Messages', { exact: true }).click();
  await receiver.locator('.whitespace-pre-wrap').filter({ hasText: text }).waitFor({ state: 'visible' });
  await until(async () => (await api(b.context, '/api/messages/unread-count')).unreadCount === 0, 'Read conversation did not clear unread count');
  check(!(await receiver.evaluate(() => window.auditInjected)), 'Message HTML is displayed as text');
  check(true, 'Opening a thread clears persisted unread counts');
  const reply = 'Synthetic reply ' + run;
  await receiver.getByPlaceholder('Message ' + a.name + '...').fill(reply);
  await receiver.getByRole('button', { name: 'Send message', exact: true }).click();
  await a.page.locator('.whitespace-pre-wrap').filter({ hasText: reply }).waitFor({ state: 'visible', timeout: 8000 });
  check(true, 'Two-way messaging renders live');
  await a.page.route('**/api/messages/conversations/*/messages', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary connection failure' }) });
    return route.continue();
  });
  const retry = 'Draft survives failure ' + run;
  await a.page.getByPlaceholder('Message ' + b.name + '...').fill(retry);
  await a.page.getByRole('button', { name: 'Send message', exact: true }).click();
  await a.page.getByText('Message was not sent. Your draft has been kept so you can try again.', { exact: true }).waitFor({ state: 'visible' });
  check(await a.page.getByPlaceholder('Message ' + b.name + '...').inputValue() === retry, 'Failed sends preserve the draft');
  await a.page.unroute('**/api/messages/conversations/*/messages');
  await a.page.getByRole('button', { name: 'Send message', exact: true }).click();
  await receiver.locator('.whitespace-pre-wrap').filter({ hasText: retry }).waitFor({ state: 'visible' });
  check(true, 'Failed message can be retried successfully');
  const secret = await api(a.context, '/api/messages/conversations/' + b.user.id + '/messages');
  const outsider = await api(c.context, '/api/messages/conversations/' + a.user.id + '/messages');
  check(secret.messages.length >= 3 && outsider.messages.length === 0, 'A third account cannot read another pair conversation');
  await api(a.context, '/api/messages/conversations/' + a.user.id + '/messages', { method: 'POST', status: 400, body: { text: 'self' } });
  await api(a.context, '/api/messages/conversations/' + b.user.id + '/messages', { method: 'POST', status: 400, body: { text: '   ' } });
  await api(a.context, '/api/messages/conversations/' + b.user.id + '/messages', { method: 'POST', status: 400, body: { text: 'x'.repeat(4001) } });
  check(true, 'Self messages, empty messages, and oversized messages are rejected');
  await a.page.keyboard.press('Escape');
  await a.page.getByRole('dialog', { name: 'Direct messages' }).waitFor({ state: 'hidden' });
  check(true, 'Escape closes the message dialog');
  await receiver.getByRole('button', { name: 'Close messages', exact: true }).filter({ visible: true }).first().click().catch(async () => { await receiver.keyboard.press('Escape'); });
  if (!live) {
    const owner = await account('Owner', ownerEmail);
    const conferenceId = 'comm-conf-' + run;
    await api(owner.context, '/api/activity/conferences', { method: 'POST', status: 201, body: { id: conferenceId, title: 'Synthetic Communications Conference', industry: 'Technology', dates: { start: '2027-09-10', end: '2027-09-11' }, location: { city: 'Manama', country: 'Bahrain' }, topics: [], tracks: [], cfpStatus: 'Closed' } });
    await api(owner.context, '/api/activity/professional-invitations', { method: 'POST', status: 201, body: { conferenceId, professionalId: b.user.id, roleType: 'speaker', title: 'Synthetic speaker invitation', message: 'Synthetic acceptance check only' } });
    let notice;
    await until(async () => { notice = (await api(b.context, '/api/activity/notifications/mine')).notifications.find(n => !n.read); return Boolean(notice); }, 'Invitation notification not created');
    await api(a.context, '/api/activity/notifications/' + notice.id + '/read', { method: 'POST' });
    check((await api(b.context, '/api/activity/notifications/mine')).notifications.find(n => n.id === notice.id).read === false, 'Another user cannot mark a recipient notification read');
    await receiver.locator('button[title="Notifications"] span').waitFor({ state: 'visible', timeout: 25000 });
    check(true, 'New notification badge updates without a reload');
    const fixture = createClient({ url: 'file:' + dbPath });
    try {
      await fixture.execute({ sql: 'INSERT INTO notifications(id,user_id,type,title,message) VALUES(?,?,?,?,?)', args: ['layout-' + run, b.user.id, 'followup', 'Synthetic layout notice ' + run, 'Long-text stress check: ' + 'x'.repeat(600)] });
    } finally { fixture.close(); }
    await receiver.getByTitle('Notifications', { exact: true }).click();
    await receiver.getByRole('heading', { name: 'Notifications', exact: true }).waitFor({ state: 'visible' });
    await receiver.getByText('Synthetic layout notice ' + run, { exact: true }).waitFor({ state: 'visible', timeout: 25000 });
    check(true, 'Notification center refreshes live and displays long notices');
    await receiver.getByRole('button', { name: 'Mark all as read', exact: true }).click();
    await until(async () => (await api(b.context, '/api/activity/notifications/mine')).notifications.every(n => n.read), 'Mark all read did not persist');
    const anotherDevice = await b.context.newPage();
    await anotherDevice.goto(base);
    await anotherDevice.getByTitle('Notifications', { exact: true }).click();
    await anotherDevice.getByText('You’re all caught up', { exact: true }).waitFor({ state: 'visible' });
    await anotherDevice.close();
    const receipt = 'organizer-event-' + run;
    await api(owner.context, '/api/activity/notifications/' + receipt + '/read', { method: 'POST' });
    check((await api(owner.context, '/api/activity/notifications/mine')).readIds.includes(receipt), 'Derived admin notification read status persists server-side');
    check(!(await api(a.context, '/api/activity/notifications/mine')).readIds.includes(receipt), 'Read receipts are isolated by account');
    check(true, 'Notification read status persists across sessions and devices');
  } else {
    await receiver.getByTitle('Notifications', { exact: true }).click();
    await receiver.getByRole('heading', { name: 'Notifications', exact: true }).waitFor({ state: 'visible' });
  }
  await a.page.getByTitle('Direct Messages', { exact: true }).click();
  const devices = [[320,568],[390,844],[768,1024],[1024,768],[1440,900],[844,390],[2560,1440]];
  for (const [width,height] of devices) {
    await a.page.setViewportSize({ width,height });
    await receiver.setViewportSize({ width,height });
    const dialog = a.page.getByRole('dialog', { name: 'Direct messages' });
    await dialog.waitFor({ state: 'visible' });
    const input = a.page.getByPlaceholder('Message ' + b.name + '...');
    await input.waitFor({ state: 'visible' });
    const box = await input.boundingBox();
    const send = await a.page.getByRole('button', { name: 'Send message', exact: true }).boundingBox();
    check(box && send && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height && send.x + send.width <= width && send.y + send.height <= height, 'Composer and send button fit ' + width + 'x' + height);
    const layout = await receiver.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    check(layout.content <= width + 8, 'Notifications have no page overflow at ' + width + 'x' + height);
    await a.page.screenshot({ path: out + '/messages-' + width + 'x' + height + '.png' });
    await receiver.screenshot({ path: out + '/notifications-' + width + 'x' + height + '.png', fullPage: true });
    report.layouts.push({ width,height, messageComposerVisible: true, notificationOverflow: false });
    if (width < 640) {
      await a.page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
      await a.page.getByPlaceholder('Search your inbox...').waitFor({ state: 'visible' });
      await a.page.getByRole('button').filter({ hasText: b.name }).last().click();
      await input.waitFor({ state: 'visible' });
    }
  }
  await receiver.reload({ waitUntil: 'domcontentloaded' });
  await receiver.getByTitle('Direct Messages', { exact: true }).click();
  await receiver.locator('.whitespace-pre-wrap').filter({ hasText: text }).waitFor({ state: 'visible' });
  check(true, 'Message history survives reload');
  check(report.browserErrors.length === 0, 'No uncaught browser errors during communication journeys');
} catch (error) {
  report.failures.push(error.stack || error.message);
  for (let i = 0; i < accounts.length; i++) {
    const page = accounts[i].page;
    await page.screenshot({ path: out + '/failure-' + i + '.png', fullPage: true }).catch(() => {});
    report['page' + i] = (await page.locator('body').innerText().catch(() => '')).slice(0,8000);
  }
} finally {
  if (browser) await browser.close();
  if (child) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    for (const suffix of ['', '-wal', '-shm']) await fs.rm(dbPath + suffix, { force: true }).catch(() => {});
  }
  await fs.writeFile(out + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.failures.length) process.exitCode = 1;
