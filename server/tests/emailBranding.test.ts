import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { brandedEmail, emailLogoAttachment } from '../emailTransport';

test('conference email embeds the real logo and keeps safe, readable actions', async () => {
  const html=brandedEmail('New match for AIPE 2026','New match for AIPE 2026\nAIPE 2026\nhttps://example.org/conference',{
    actionUrl:'https://example.org/conference',actionLabel:'View conference source',unsubscribeUrl:'https://www.conferencegate.com/api/intelligence/unsubscribe/fixture/signed-token',
  });
  assert.equal(html.split('New match for AIPE 2026').length-1,2); // Document title and one visible heading.
  assert.ok(html.includes('cid:conferencegate-logo@conferencegate.com'));
  assert.ok(html.includes('alt="ConferenceGate"'));
  assert.ok(html.includes('View conference source'));
  assert.ok(html.includes('Unsubscribe from conference alerts'));
  assert.ok(!html.includes('Unsubscribe: https://'));
  assert.ok(html.includes('role="presentation"'));
  const unsafe=brandedEmail('<script>','<img onerror="attack">',{actionUrl:'javascript:attack()',unsubscribeUrl:'https://user:password@example.org/'});
  assert.ok(unsafe.includes('&lt;script&gt;'));assert.ok(unsafe.includes('&lt;img'));
  assert.ok(!unsafe.includes('href="javascript:'));assert.ok(!unsafe.includes('user:password'));
  const attachments=emailLogoAttachment();assert.equal(fs.readFileSync(attachments[0].path).subarray(1,4).toString(),'PNG');
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  try {
    const info=await transport.sendMail({from:'support@conferencegate.com',to:'fixture@example.invalid',subject:'Branding fixture',html,attachments});
    const mime=info.message.toString();
    assert.match(mime,/Content-ID: <conferencegate-logo@conferencegate.com>/i);
    assert.match(mime,/Content-Disposition: inline/i);
    assert.match(mime,/Content-Type: image\/png/i);
  } finally {transport.close();}
});
