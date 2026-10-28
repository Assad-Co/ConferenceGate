import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import assert from 'node:assert/strict';

const root=fs.mkdtempSync(path.join(process.cwd(),'.email-acceptance-'));
const dbPath=path.join(root,'test.db');
const owner='email-owner@example.invalid';
const base='http://127.0.0.1:3163';
const child=spawn(process.execPath,['dist/server.cjs'],{env:{...process.env,NODE_ENV:'test',PORT:'3163',TEST_DATABASE_PATH:dbPath,TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',
  PUBLIC_BASE_URL:base,OWNER_PREVIEW_EMAIL_SHA256:crypto.createHash('sha256').update(owner).digest('hex'),
  INTELLIGENCE_EMAIL_NOTIFICATIONS:'enabled',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9',SMTP_USER:'isolated',SMTP_PASSWORD:'must-not-leak',
  INTELLIGENCE_EMAIL_FROM:'qa@example.invalid',INTELLIGENCE_UNSUBSCRIBE_SECRET:'isolated-unsubscribe-secret'.repeat(2)},stdio:['ignore','pipe','pipe']});
let log=''; child.stdout.on('data',c=>log+=c);child.stderr.on('data',c=>log+=c);
async function req(route,{cookie,method='GET',body,origin}={}) {
  const response=await fetch(base+route,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...(origin?{origin}:{})},body:body?JSON.stringify(body):undefined});
  return {response,data:await response.json()};
}
let db;
try {
  let ready=false;
  for(let i=0;i<120;i++) {
    try {ready=(await req('/api/health')).response.ok;}catch{}
    if(ready) break;
    if(child.exitCode!==null) throw Error('Server exited');
    await new Promise(r=>setTimeout(r,250));
  }
  assert.ok(ready,'Server must start');
  const signup=async email=>{
    const r=await req('/api/auth/signup',{method:'POST',body:{role:'professional',email,name:'Isolated email acceptance',password:crypto.randomBytes(24).toString('hex')+'Aa1!'}});
    assert.equal(r.response.status,201);
    return r.response.headers.get('set-cookie').split(';')[0];
  };
  const admin=await signup(owner), ordinary=await signup('email-normal@example.invalid');
  assert.equal((await req('/api/intelligence/email-diagnostics')).response.status,401);
  assert.equal((await req('/api/intelligence/email-diagnostics',{cookie:ordinary})).response.status,403);
  const diagnostics=await req('/api/intelligence/email-diagnostics',{cookie:admin});
  assert.equal(diagnostics.response.status,200);
  assert.equal(diagnostics.data.configuration.ready,true);
  assert.ok(!JSON.stringify(diagnostics.data).includes('must-not-leak'));
  assert.equal((await req('/api/intelligence/test-email',{cookie:admin,method:'POST',body:{},origin:'https://evil.example'})).response.status,403);
  const failed=await req('/api/intelligence/test-email',{cookie:admin,method:'POST',body:{},origin:base});
  assert.equal(failed.response.status,502); assert.equal(failed.data.status,'failed'); assert.ok(failed.data.requestId);
  const records=await req('/api/intelligence/email-tests',{cookie:admin});
  assert.equal(records.data.records[0].id,failed.data.requestId);
  assert.equal((await req('/api/intelligence/email-tests',{cookie:ordinary})).data.records.length,0);
  assert.equal((await req('/api/intelligence/test-email',{cookie:admin,method:'POST',body:{},origin:base})).response.status,429);
  db=createClient({url:'file:'+dbPath});
  await db.execute("UPDATE intelligence_email_tests SET last_attempt_at=last_attempt_at-31000");
  assert.equal((await req('/api/intelligence/test-email',{cookie:admin,method:'POST',body:{},origin:base})).response.status,502);
  assert.ok(!log.includes('must-not-leak'));
  console.log(JSON.stringify({emailDiagnostics:'passed',administratorOnly:true,credentialRedaction:true,originProtection:true,requestRecords:true,accountIsolation:true,failedTestRetryAfter30Seconds:true}));
} finally {
  db?.close(); child.kill();
  await new Promise(r=>child.once('exit',r));
  // This directory was created above and contains only disposable isolated acceptance data.
  assert.ok(path.resolve(root).startsWith(path.resolve(process.cwd())+path.sep));
  try {
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(dbPath+suffix)) fs.unlinkSync(dbPath+suffix);
    fs.rmdirSync(root);
  } catch { console.warn('Disposable acceptance files remain in the local .email-acceptance directory because cleanup was denied.'); }
}
