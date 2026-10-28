import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db, dbGet, dbRun, initDb } from '../db';
import { initAuthSecret, initSessionVersions, verifySessionToken } from '../auth';
import { authRecoveryRouter } from '../authRecovery';

test('concurrent recovery confirmations consume a token once and revoke the old session', async () => {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  await initDb(); await initAuthSecret(); await initSessionVersions();
  const id = 'recovery-replay-' + crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await dbRun('INSERT INTO users(id,email,role,name,password_hash) VALUES (?,?,?,?,?)',
    [id, id + '@example.invalid', 'professional', 'Synthetic recovery test', bcrypt.hashSync('OldPassword123!', 10)]);
  await dbRun('INSERT INTO app_secrets(key,value) VALUES (?,?)',
    ['password_reset:' + hash, JSON.stringify({userId:id, expiresAt:Date.now()+60000})]);
  await dbRun('INSERT INTO app_secrets(key,value) VALUES (?,?)', ['password_reset_latest:' + id, hash]);
  const oldSession = jwt.sign({sub:id,sv:0}, process.env.JWT_SECRET);
  assert.equal(verifySessionToken(oldSession), id);
  const app = express(); app.use(express.json()); app.use('/auth', authRecoveryRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const confirm = () => fetch(base + '/auth/password-reset/confirm', {method:'POST',
    headers:{'content-type':'application/json'}, body:JSON.stringify({token,newPassword:'NewPassword123!'})});
  try {
    assert.deepEqual((await Promise.all([confirm(), confirm()])).map(r=>r.status).sort(), [200,400]);
    assert.equal((await confirm()).status, 400);
    const user = await dbGet<{password_hash:string}>('SELECT password_hash FROM users WHERE id=?',[id]);
    assert.equal(bcrypt.compareSync('NewPassword123!', user!.password_hash), true);
    assert.equal(bcrypt.compareSync('OldPassword123!', user!.password_hash), false);
    assert.equal(verifySessionToken(oldSession), null);
    assert.equal(await dbGet('SELECT value FROM app_secrets WHERE key=?',['password_reset:'+hash]), undefined);
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await dbRun('DELETE FROM users WHERE id=?',[id]);
    await dbRun('DELETE FROM app_secrets WHERE key=?',['session_version:'+id]);
    db.close();
  }
});
