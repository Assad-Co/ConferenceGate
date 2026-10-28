import test from 'node:test';
import assert from 'node:assert/strict';
import { db, dbGet, dbRun, initDb } from '../db';
import { claimEmailTest, emailTestOriginAllowed, initIntelligenceEmailSchema } from '../intelligenceEmail';
import { drainEmailOutbox, enqueueAlert, emailQueueDiagnostics } from '../intelligenceOutbox';
import { brandedEmail, emailConfiguration, emailFailure, retryDelay, emailRouting } from '../emailTransport';

test('durable alert delivery, privacy and retry semantics', async t => {
  Object.assign(process.env, {INTELLIGENCE_EMAIL_NOTIFICATIONS:'enabled', SMTP_HOST:'smtp.example.invalid', SMTP_PORT:'587', SMTP_USER:'test', SMTP_PASSWORD:'secret-not-for-diagnostics', INTELLIGENCE_EMAIL_FROM:'test@example.invalid', INTELLIGENCE_UNSUBSCRIBE_SECRET:'s'.repeat(32)});
  await initDb();
  await initIntelligenceEmailSchema();
  await dbRun("INSERT OR REPLACE INTO users (id,email,role,name) VALUES ('outbox-test','test@example.invalid','professional','Outbox test')");
  await dbRun("INSERT OR REPLACE INTO intelligence_email_preferences (user_id,enabled,updated_at) VALUES ('outbox-test',1,'now')");
  const enqueue = (id: string) => enqueueAlert('outbox-test',id,'Conference <test>','Verified source','https://conferencegate.com/unsubscribe/test');
  let calls = 0;
  const accepted = () => ({sendMail: async () => { calls++; return {accepted:['test@example.invalid'],messageId:'provider-test'}; },close() {}}) as any;
  await t.test('concurrent workers and repeated enqueues submit exactly once', async () => {
    await Promise.all([enqueue('once'),enqueue('once')]);
    await Promise.all([drainEmailOutbox(accepted),drainEmailOutbox(accepted)]);
    await drainEmailOutbox(accepted);
    assert.equal(calls,1);
    const row = await dbGet<any>("SELECT * FROM intelligence_email_outbox WHERE alert_id='once'");
    assert.equal(row.status,'accepted'); assert.equal(row.attempts,1);
    assert.equal(row.provider_message_id,'provider-test');
  });
  await t.test('confirmed temporary rejection backs off then retries', async () => {
    await enqueue('retry'); const now=Date.now();
    await drainEmailOutbox(() => ({sendMail:async()=>{throw {responseCode:451,code:'EMESSAGE'};},close(){}}) as any,now);
    const row = await dbGet<any>("SELECT * FROM intelligence_email_outbox WHERE alert_id='retry'");
    assert.equal(row.status,'retry'); assert.equal(row.next_attempt_at,now+60000);
    await drainEmailOutbox(accepted,now+59999); assert.equal(calls,1);
    await drainEmailOutbox(accepted,now+60000); assert.equal(calls,2);
  });
  await t.test('ambiguous SMTP outcome is quarantined and never automatically resent', async () => {
    await enqueue('uncertain');
    await drainEmailOutbox(() => ({sendMail:async()=>{throw {code:'ETIMEDOUT',command:'DATA'};},close(){}}) as any);
    await drainEmailOutbox(accepted,Date.now()+10000000);
    assert.equal((await dbGet<any>("SELECT status FROM intelligence_email_outbox WHERE alert_id='uncertain'"))?.status,'uncertain');
    assert.equal(calls,2);
  });
  await t.test('restart recovery quarantines in-flight messages', async () => {
    await enqueue('interrupted');
    await dbRun("UPDATE intelligence_email_outbox SET status='sending',lease_until=0 WHERE alert_id='interrupted'");
    await drainEmailOutbox(accepted);
    assert.equal((await dbGet<any>("SELECT status FROM intelligence_email_outbox WHERE alert_id='interrupted'"))?.status,'uncertain');
    assert.equal(calls,2);
  });
  await t.test('unsubscribe cancels messages already queued', async () => {
    await enqueue('unsubscribe');
    await dbRun("UPDATE intelligence_email_preferences SET enabled=0 WHERE user_id='outbox-test'");
    await drainEmailOutbox(accepted);
    assert.equal((await dbGet<any>("SELECT status FROM intelligence_email_outbox WHERE alert_id='unsubscribe'"))?.status,'cancelled');
    assert.equal(calls,2);
  });
  await t.test('legacy accepted alerts cannot be sent again after upgrade', async () => {
    await dbRun("INSERT OR REPLACE INTO intelligence_email_deliveries (user_id,alert_id,status,attempts) VALUES ('outbox-test','legacy','sent',1)");
    await enqueue('legacy');
    assert.equal(await dbGet("SELECT id FROM intelligence_email_outbox WHERE alert_id='legacy'"),undefined);
  });
  await t.test('configuration, queue and errors expose no credentials', async () => {
    const value=JSON.stringify({config:emailConfiguration(),queue:await emailQueueDiagnostics(),failure:emailFailure(new Error('password=secret-not-for-diagnostics'))});
    assert.ok(!value.includes('secret-not-for-diagnostics')); assert.ok(!value.includes('test@example.invalid'));
    assert.equal(emailConfiguration({...process.env,SMTP_PORT:'NaN'}).ready,false);
    assert.equal(emailFailure({responseCode:535,code:'EAUTH'}).retryable,false);
    assert.equal(retryDelay(5),960000);
    assert.ok(brandedEmail('<script>','<img>').includes('&lt;script&gt;'));
  });
  await t.test('test cooldown distinguishes rejection, ambiguity and acceptance across workers', async () => {
    const now = Date.now();
    const claims = await Promise.all([claimEmailTest('outbox-test',now),claimEmailTest('outbox-test',now)]);
    assert.equal(claims.filter(Boolean).length,1);
    await dbRun("UPDATE intelligence_email_tests SET status='failed' WHERE user_id='outbox-test'");
    assert.equal(await claimEmailTest('outbox-test',now+29999),undefined);
    assert.ok(await claimEmailTest('outbox-test',now+30001));
    for (const status of ['sent','uncertain','sending']) {
      await dbRun("UPDATE intelligence_email_tests SET status=? WHERE user_id='outbox-test'",[status]);
      assert.equal(await claimEmailTest('outbox-test',now+60001),undefined);
    }
    assert.ok(await claimEmailTest('outbox-test',now+630002));
  });
  await t.test('routing diagnostics expose only allowlisted operational fields', () => {
    const route = emailRouting({...process.env, SMTP_USER:'private-user', SMTP_PASSWORD:'private-password', RESEND_API_KEY:'private-key'});
    assert.equal(route.host, 'smtp.example.invalid');
    assert.equal(route.port, 587);
    assert.equal(route.senderDomain, 'example.invalid');
    assert.doesNotMatch(JSON.stringify(route), /private-user|private-password|private-key/);
    assert.equal(emailRouting({...process.env, SMTP_HOST:'smtp://user:password@host'}).host, null);
  });
  await t.test('origin matching permits canonical www but rejects unrelated or missing origins', () => {
    assert.equal(emailTestOriginAllowed('https://www.conferencegate.com','https://conferencegate.com'),true);
    assert.equal(emailTestOriginAllowed('https://conferencegate.com.evil.test'),false);
    assert.equal(emailTestOriginAllowed(undefined),false);
    assert.equal(emailTestOriginAllowed('http://conferencegate.com'),false);
    assert.equal(emailTestOriginAllowed('https://www.conferencegate.com','https://custom.example'),false);
  });
  await dbRun("DELETE FROM intelligence_email_outbox WHERE user_id='outbox-test'");
  await dbRun("DELETE FROM intelligence_email_deliveries WHERE user_id='outbox-test'");
  await dbRun("DELETE FROM intelligence_email_preferences WHERE user_id='outbox-test'");
  await dbRun("DELETE FROM users WHERE id='outbox-test'");
  db.close();
});
