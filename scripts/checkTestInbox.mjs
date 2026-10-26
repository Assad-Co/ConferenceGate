import nodemailer from 'nodemailer';
import tls from 'node:tls';
import crypto from 'node:crypto';

const user = process.env.ETHEREAL_TEST_USER;
const pass = process.env.ETHEREAL_TEST_PASSWORD;
if (!user || !pass) throw new Error('Supply test inbox credentials through the process environment.');
const marker = `ConferenceGate-QA-${crypto.randomUUID()}`;
const transport = nodemailer.createTransport({
  host: 'smtp.ethereal.email', port: 587, secure: false, requireTLS: true,
  auth: { user, pass }, logger: false, debug: false,
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
});
let socket;
try {
  await transport.sendMail({ from: 'ConferenceGate QA <no-reply@example.invalid>', to: 'qa-connection@example.invalid', subject: marker, text: marker });
  console.log('PASS: TLS SMTP capture accepted the synthetic message.');
  socket = tls.connect({ host: 'imap.ethereal.email', port: 993, servername: 'imap.ethereal.email', rejectUnauthorized: true });
  socket.setEncoding('utf8');
  socket.setTimeout(15000, () => socket.destroy(new Error('Mailbox timeout')));
  let buffer = '';
  let pending;
  socket.on('data', chunk => { buffer += chunk; if (pending) pending(); });
  let failure;
  socket.on('error', error => { failure = error; if (pending) pending(); });
  async function until(predicate) {
    while (!predicate(buffer)) {
      if (failure) throw failure;
      await new Promise(resolve => { pending = resolve; });
    }
    pending = undefined;
    const result = buffer;
    buffer = '';
    return result;
  }
  await until(value => /\r\n/.test(value));
  let counter = 0;
  async function command(value) {
    const tag = `qa${++counter}`;
    socket.write(`${tag} ${value}\r\n`);
    const result = await until(text => new RegExp(`(?:^|\\r\\n)${tag} (?:OK|NO|BAD)[^\\r]*\\r\\n`).test(text));
    if (!new RegExp(`${tag} OK`).test(result)) throw new Error('Mailbox command rejected');
    return result;
  }
  await command(`LOGIN ${JSON.stringify(user)} ${JSON.stringify(pass)}`);
  await command('SELECT INBOX');
  const results = await command(`UID SEARCH HEADER SUBJECT ${JSON.stringify(marker)}`);
  const id = results.match(/\* SEARCH (\d+)/)?.[1];
  if (!id) throw new Error('Captured synthetic message was not found in inbox');
  const content = await command(`UID FETCH ${id} BODY.PEEK[TEXT]`);
  if (!content.includes(marker)) throw new Error('Captured message body does not match');
  console.log('PASS: Authenticated TLS IMAP retrieved the same synthetic message.');
  await command('LOGOUT');
} catch {
  console.error('FAIL: Test inbox connectivity or message retrieval failed; credentials and message content suppressed.');
  process.exitCode = 1;
} finally {
  transport.close();
  socket?.destroy();
}
