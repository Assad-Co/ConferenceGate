import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import WebSocket from 'ws';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cg-message-race-'));
const dbPath = path.join(root, 'test.db');
const preload = path.join(root, 'latency.mjs');
// Simulate the asynchronous database reads used by production Turso. The real
// local database still applies its unique constraint and persists every write.
await fs.writeFile(preload, `import { createRequire } from 'node:module';
const { createClient } = createRequire(${JSON.stringify(pathToFileURL(path.resolve('dist/server.cjs')).href)})('@libsql/client');
const probe = createClient({url:'file::memory:'});
const proto = Object.getPrototypeOf(probe), execute = proto.execute;
probe.close();
proto.execute = async function(statement, ...args) {
  const result = await execute.call(this, statement, ...args);
  const sql = typeof statement === 'string' ? statement : statement.sql;
  if (sql.startsWith('SELECT * FROM conversations WHERE user_a')) await new Promise(resolve => setTimeout(resolve, 60));
  return result;
};
`);
const base = 'http://127.0.0.1:3167';
const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'dist/server.cjs'], {
  env: { ...process.env, NODE_ENV:'test', PORT:'3167', TEST_DATABASE_PATH:dbPath, TURSO_DATABASE_URL:'', TURSO_AUTH_TOKEN:'', PRIVATE_WORKSPACES_ONLY:'true' },
  stdio:['ignore','pipe','pipe'], windowsHide:true,
});
let log = '';
child.stdout.on('data', c => log += c);
child.stderr.on('data', c => log += c);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sockets = [];
let db;
async function request(route, {cookie, body, status=200}={}) {
  const response = await fetch(base+route, {method:body?'POST':'GET', headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})}, body:body?JSON.stringify(body):undefined});
  const data = await response.json();
  assert.equal(response.status,status,route+' '+JSON.stringify(data));
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function signup(name) {
  return request('/api/auth/signup',{status:201,body:{role:'professional',name,email:name+'@example.invalid',password:'MessageRaceFixture123!'}});
}
try {
  let healthy = false;
  for(let i=0;i<100;i++) {
    try {await request('/api/health');healthy=true;break;}catch{}
    if(child.exitCode!==null)throw Error('Test server exited: '+log);
    await pause(200);
  }
  assert.ok(healthy,'Test server did not become healthy');
  const [a,b,c] = await Promise.all(['message-a','message-b','message-outsider'].map(signup));
  await request('/api/messages/conversations',{status:401});
  const received = [];
  const socket = new WebSocket('ws://127.0.0.1:3167/ws/messages',{headers:{cookie:b.cookie}});
  sockets.push(socket);
  socket.on('message', bytes => received.push(JSON.parse(String(bytes))));
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
  const sends = await Promise.all(Array.from({length:12},(_,i)=>request('/api/messages/conversations/'+b.data.user.id+'/messages',{cookie:a.cookie,status:201,body:{text:'Concurrent fixture message '+i}})));
  assert.equal(new Set(sends.map(x=>x.data.message.id)).size,12);
  const deadline=Date.now()+3000;
  while(received.length<12&&Date.now()<deadline)await pause(20);
  assert.equal(received.filter(x=>x.type==='message').length,12,'Every message should arrive on the recipient socket');
  const thread=await request('/api/messages/conversations/'+a.data.user.id+'/messages',{cookie:b.cookie});
  assert.equal(thread.data.messages.length,12,'Concurrent sends must share one complete thread');
  assert.equal((await request('/api/messages/unread-count',{cookie:b.cookie})).data.unreadCount,12);
  assert.equal((await request('/api/messages/conversations/'+a.data.user.id+'/messages',{cookie:c.cookie})).data.messages.length,0,'Third account cannot see another conversation');
  await request('/api/messages/conversations/'+a.data.user.id+'/read',{cookie:b.cookie,body:{}});
  assert.equal((await request('/api/messages/unread-count',{cookie:b.cookie})).data.unreadCount,0);
  db=createClient({url:'file:'+dbPath});
  assert.equal(Number((await db.execute('SELECT count(*) AS n FROM conversations')).rows[0].n),1);
  console.log(JSON.stringify({messagingConcurrency:'passed',simultaneousFirstMessages:12,singleConversation:true,websocketDelivery:true,unreadAndRead:true,thirdAccountIsolation:true}));
} finally {
  for(const socket of sockets)socket.terminate();
  db?.close();
  child.kill('SIGTERM');
  if(child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(2000)]);
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
