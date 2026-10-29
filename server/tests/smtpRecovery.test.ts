import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { db, dbGet, dbRun, initDb } from '../db';
import { initIntelligenceEmailSchema } from '../intelligenceEmail';
import { drainEmailOutbox, enqueueAlert, emailQueueDiagnostics } from '../intelligenceOutbox';
import { initIntelligenceSyncSchema } from '../intelligenceSync';
import { scanProfessionalIntelligenceAlerts } from '../intelligenceAlertScheduler';

test('real SMTP sockets recover, reject and quarantine without duplicate submissions', async () => {
  assert.equal(process.env.NODE_ENV,'test');
  assert.ok(process.env.TEST_DATABASE_PATH);
  Object.assign(process.env,{INTELLIGENCE_EMAIL_NOTIFICATIONS:'enabled',SMTP_HOST:'127.0.0.1',SMTP_PORT:'587',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture-only',INTELLIGENCE_EMAIL_FROM:'fixture@example.invalid',INTELLIGENCE_UNSUBSCRIBE_SECRET:'s'.repeat(40)});
  await initDb(); await initIntelligenceEmailSchema();
  await initIntelligenceSyncSchema();
  await dbRun("INSERT INTO users(id,email,role,name) VALUES('smtp-fixture','fixture@example.invalid','professional','SMTP fixture')");
  await dbRun("INSERT INTO intelligence_email_preferences VALUES('smtp-fixture',1,'now')");
  let mode='accept', accepted=0;
  const sockets=new Set<net.Socket>();
  const server=net.createServer(socket=>{
    sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); socket.on('error',()=>{});
    socket.write('220 fixture ESMTP\r\n'); let buffer='',data=false;
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      while(buffer.includes('\r\n')){
        const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(data){if(line==='.') {data=false;if(mode==='ambiguous'){accepted++;socket.destroy();}else{accepted++;socket.write('250 2.0.0 accepted\r\n');}}continue;}
        if(/^EHLO|^HELO/.test(line))socket.write('250 fixture\r\n');
        else if(/^MAIL FROM/.test(line))socket.write('250 OK\r\n');
        else if(/^RCPT TO/.test(line))socket.write(mode==='permanent'?'550 5.1.1 rejected\r\n':mode==='temporary'?'451 4.3.0 temporary\r\n':'250 OK\r\n');
        else if(line==='DATA'){data=true;socket.write('354 End with dot\r\n');}
        else if(line==='QUIT'){socket.end('221 Bye\r\n');}
        else socket.write('250 OK\r\n');
      }
    });
  });
  const listen=()=>new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  await listen(); const port=(server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  const transport=()=>nodemailer.createTransport({host:'127.0.0.1',port,secure:false,ignoreTLS:true,connectionTimeout:1000,greetingTimeout:1000,socketTimeout:1000});
  const enqueue=(id:string)=>enqueueAlert('smtp-fixture',id,'Genuine pipeline fixture','Isolated SMTP acceptance','http://127.0.0.1/unsubscribe');
  const row=(id:string)=>dbGet<any>('SELECT status,attempts,next_attempt_at,error_code FROM intelligence_email_outbox WHERE alert_id=?',[id]);
  try{
    const state=JSON.stringify({version:1,plans:[],alerts:[],rules:[{id:'bounded',name:'Bounded fixture',query:'zzzyxcertificationnomatch',country:'',cfpOnly:false,enabled:true,seen:{}}]});
    for(const id of ['smtp-fixture','unrelated-fixture'])await dbRun('INSERT INTO professional_intelligence_state VALUES(?,?,?)',[id,state,'unchanged']);
    assert.equal((await scanProfessionalIntelligenceAlerts('smtp-fixture')).scanned,1);
    assert.equal((await dbGet<any>('SELECT updated_at FROM professional_intelligence_state WHERE user_id=?',['unrelated-fixture'])).updated_at,'unchanged');
    await enqueue('connection'); const now=Date.now();
    await drainEmailOutbox(transport,now);
    assert.equal((await row('connection')).status,'retry');
    assert.equal((await row('connection')).attempts,1);
    assert.equal((await row('connection')).next_attempt_at,now+60000);
    await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
    await drainEmailOutbox(transport,now+59999);assert.equal(accepted,0);
    await drainEmailOutbox(transport,now+60000);
    assert.equal((await row('connection')).status,'accepted');assert.equal(accepted,1);
    await drainEmailOutbox(transport,now+120000);assert.equal(accepted,1);
    mode='temporary';await enqueue('temporary');const next=Date.now();await drainEmailOutbox(transport,next);
    assert.equal((await row('temporary')).status,'retry');mode='accept';await drainEmailOutbox(transport,next+60000);
    assert.equal((await row('temporary')).status,'accepted');assert.equal(accepted,2);
    mode='permanent';await enqueue('permanent');await drainEmailOutbox(transport);
    assert.equal((await row('permanent')).status,'failed');
    mode='ambiguous';await enqueue('ambiguous');await drainEmailOutbox(transport);
    assert.equal((await row('ambiguous')).status,'uncertain');assert.equal(accepted,3);
    mode='accept';await drainEmailOutbox(transport,Date.now()+10000000);assert.equal(accepted,3);
    const diagnostics=await emailQueueDiagnostics();assert.equal(diagnostics.alert,true);
    assert.ok(diagnostics.counts.some(x=>x.status==='failed'));assert.ok(diagnostics.counts.some(x=>x.status==='uncertain'));
    console.log(JSON.stringify({actualSocketFailure:true,temporaryRetryRecovered:true,permanentRejected:true,ambiguousQuarantined:true,duplicateSubmissions:0,diagnosticsAlert:true}));
  }finally{
    for(const socket of sockets)socket.destroy();
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
    db.close();
  }
});
