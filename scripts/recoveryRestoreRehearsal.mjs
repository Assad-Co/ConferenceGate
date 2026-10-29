import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createClient } from '@libsql/client';

// Run only on a separate worker. Never run a second recovered app on the live
// Render instance: restoring/caching a large database competes with its memory.
const fixture = process.argv.includes('--fixture');
const python = process.env.PYTHON_EXE || 'python3';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-restore-rehearsal-'));
await fs.chmod(root, 0o700);
const source = path.join(root, 'snapshot.sql');
const restored = path.join(root, 'restored.db');
const manifestPath = path.join(root, 'manifest.json');
const children = [];
const report = {mode:fixture?'synthetic-fixture':'isolated-backup',productionWrites:false,externalRequestsFromRecoveredApp:false,checks:[]};
let stage = 'prepare';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const minimalEnv = () => Object.fromEntries(Object.entries({PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,LANG:'C.UTF-8',PYTHONIOENCODING:'utf-8'}).filter(([,v])=>v!==undefined));
async function stop(child) {
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(2000)]);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}
}
async function app(file, port) {
  const preload=path.join(root,'block-external.cjs');
  await fs.writeFile(preload,"const original=globalThis.fetch;globalThis.fetch=(input,options)=>{const u=new URL(String(input?.url||input));if(!['127.0.0.1','localhost'].includes(u.hostname))throw Error('External requests disabled in recovery rehearsal');return original(input,options)};",{mode:0o600});
  const child=spawn(process.execPath,['--max-old-space-size=256','--require',preload,'dist/server.cjs'],{env:{...minimalEnv(),NODE_ENV:'test',TEST_DATABASE_PATH:file,PORT:String(port),HOST:'127.0.0.1',PRIVATE_WORKSPACES_ONLY:'true',INTELLIGENCE_EMAIL_NOTIFICATIONS:'disabled'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  children.push(child);
  // Runtime logs and all credentials stay private; no log artifact is uploaded.
  child.stdout.resume();child.stderr.resume();
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<200;i++){
    if(child.exitCode!==null||child.signalCode!==null)throw Error('App startup failed');
    try{const response=await fetch(base+'/api/health');if(response.ok&&(await response.json()).database==='ready')return {child,base};}catch{}
    await pause(250);
  }
  throw Error('App health timeout');
}
async function req(base, route, {cookie,body,status=200}={}) {
  const response=await fetch(base+route,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,status,'Recovery HTTP contract');
  return {data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function accounts(base, prefix) {
  const suffix=crypto.randomUUID(),password=crypto.randomBytes(24).toString('base64url')+'Aa1!';
  const result=[];
  for(const tag of ['a','b','c'])result.push(await req(base,'/api/auth/signup',{status:201,body:{role:'professional',name:'Recovery fixture '+tag,email:prefix+'-'+tag+'-'+suffix+'@example.invalid',password}}));
  await req(base,'/api/auth/login',{body:{email:prefix+'-a-'+suffix+'@example.invalid',password}});
  return {result,password,suffix};
}
const runPython = args => {
  const run=spawnSync(python,args,{env:minimalEnv(),timeout:1200000,maxBuffer:1024*1024,windowsHide:true});
  if(run.error||run.status!==0)throw Error('Private Python restore failed');
};
try {
  if(fixture){
    stage='seed-fixture';
    const seeded=path.join(root,'fixture.db'),running=await app(seeded,3227);
    const {result:[a,b]}=await accounts(running.base,'baseline');
    await req(running.base,'/api/messages/conversations/'+b.data.user.id+'/messages',{cookie:a.cookie,status:201,body:{text:'Pre-existing fixture message'}});
    await stop(running.child);
    runPython(['-c',"import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);f=open(sys.argv[2],'w',encoding='utf-8');\nfor line in db.iterdump(): f.write(line+'\\n')\nf.close();db.close()",seeded,source]);
  }else{
    stage='read-only-export';
    const url=process.env.RECOVERY_DATABASE_URL?.trim(),token=process.env.RECOVERY_READ_TOKEN?.trim();
    assert.ok(url&&token,'Recovery credentials required');
    const endpoint=new URL(url.replace(/^libsql:/,'https:'));
    assert.equal(endpoint.protocol,'https:');assert.ok(endpoint.hostname.endsWith('.turso.io'));assert.ok(!endpoint.username&&!endpoint.password);
    endpoint.pathname='/dump';endpoint.search='';endpoint.hash='';
    const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(600000)});
    assert.equal(response.status,200,'Backup export HTTP contract');
    const handle=await fs.open(source,'wx',0o600);
    try{await pipeline(Readable.fromWeb(response.body),handle.createWriteStream());}finally{await handle.close().catch(()=>{});}
  }
  stage='full-sql-restore';
  runPython(['scripts/restoreSqlBackup.py',source,restored,manifestPath]);
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  assert.equal(manifest.integrity,'ok');assert.equal(manifest.foreignKeyViolations,0);
  report.checks.push('complete SQL restore','full integrity check','foreign-key check');
  report.tables=manifest.tables;report.sqlBytes=manifest.sqlBytes;report.databaseBytes=manifest.databaseBytes;
  stage='recovered-application';
  const copy=path.join(root,'app-copy.db');await fs.copyFile(restored,copy,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);
  const running=await app(copy,3228),base=running.base;
  report.checks.push('isolated application boot');
  const homepage=await fetch(base);assert.equal(homepage.status,200);assert.ok((await homepage.text()).includes('Where conferences connect to opportunity'));
  await req(base,'/api/messages/conversations',{status:401});
  const {result:[a,b,c],password,suffix}=await accounts(base,'restored');
  await req(base,'/api/auth/me/account-settings',{cookie:a.cookie});
  await req(base,'/api/messages/conversations/'+b.data.user.id+'/messages',{cookie:a.cookie,status:201,body:{text:'Isolated recovered application message'}});
  assert.equal((await req(base,'/api/messages/conversations/'+a.data.user.id+'/messages',{cookie:b.cookie})).data.messages.length,1);
  assert.equal((await req(base,'/api/messages/conversations/'+a.data.user.id+'/messages',{cookie:c.cookie})).data.messages.length,0);
  assert.equal((await req(base,'/api/messages/unread-count',{cookie:b.cookie})).data.unreadCount,1);
  await req(base,'/api/messages/conversations/'+a.data.user.id+'/read',{cookie:b.cookie,body:{}});
  assert.equal((await req(base,'/api/messages/unread-count',{cookie:b.cookie})).data.unreadCount,0);
  assert.equal((await req(base,'/api/activity/notifications/mine',{cookie:a.cookie})).data.notifications.length,0);
  for(const role of ['organizer','sponsor'])await req(base,'/api/auth/signup',{status:403,body:{role,name:'Recovery '+role,email:'closed-'+role+'-'+suffix+'@example.invalid',password}});
  report.checks.push('public homepage and authentication','message persistence and recipient privacy','notification isolation','private Organizer and Sponsor restrictions');
  const local=createClient({url:'file:'+copy});
  try{for(const table of ['users','messages','conversations','submissions','created_conferences','billing_provider_events']){
    const actual=Number((await local.execute('SELECT count(*) AS n FROM '+table)).rows[0].n),added={users:3,messages:1,conversations:1}[table]||0;
    assert.equal(actual,manifest.rowCounts[table]+added,'Pre-existing records preserved');
  }}finally{local.close();}
  report.checks.push('pre-existing core records preserved');
  if(fixture){
    stage='truncation-guard';
    const truncated=path.join(root,'truncated.sql'),badTarget=path.join(root,'bad.db');
    await fs.writeFile(truncated,'BEGIN TRANSACTION;\nCREATE TABLE unsafe(id);\n');
    const rejected=spawnSync(python,['scripts/restoreSqlBackup.py',truncated,badTarget,path.join(root,'bad.json')],{env:minimalEnv(),windowsHide:true});
    assert.notEqual(rejected.status,0);await assert.rejects(fs.stat(badTarget));report.checks.push('truncated exports rejected before database creation');
  }
  report.passed=true;
}catch(error){report.passed=false;report.failedStage=stage;report.errorType=error.name;process.exitCode=1;
}finally{
  for(const child of children)await stop(child);
  // Verify the exact temporary target before deleting private recovered data.
  const resolved=await fs.realpath(root),temp=await fs.realpath(os.tmpdir());
  assert.equal(path.dirname(resolved),temp);assert.ok(path.basename(resolved).startsWith('cg-restore-rehearsal-'));
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  console.log(JSON.stringify(report,null,2));
}
