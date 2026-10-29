import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
const root = path.join(os.tmpdir(), 'cg-profile-import-' + process.pid).replaceAll('\\', '/');
await fs.mkdir(root, { recursive: true });
const fixturePath = root + '/provider.json';
const preloadPath = root + '/provider.mjs';
await fs.writeFile(preloadPath, "import fs from 'node:fs';\nconst original = globalThis.fetch;\nglobalThis.fetch = async (input, options) => {\n  const url = String(input?.url || input);\n  if (url.startsWith('https://api.apify.com/')) {\n    const fixture = JSON.parse(fs.readFileSync(process.env.LINKEDIN_FIXTURE_PATH, 'utf8'));\n    return new Response(JSON.stringify(fixture.payload), { status: fixture.status || 200, headers: { 'content-type': 'application/json' } });\n  }\n  if (/^https?:\\/\\//.test(url) && !url.startsWith('http://127.0.0.1:')) throw new Error('External requests blocked in import fixture');\n  return original(input, options);\n};\n");
const linkedinUrl = 'https://www.linkedin.com/in/profile-import-fixture';
const rich = { data: { profile: { fullName: 'Import Fixture Scientist', publicIdentifier: 'profile-import-fixture', experience: { items: [{ company: { name: 'Research Institute' }, positions: [{ title: 'Researcher', startDate: { year: 2001 }, endDate: { year: 2010 } }, { title: 'Principal Scientist', isCurrent: true, startDate: { year: 2020 } }] }] }, volunteerExperience: [{ title: 'Session Chair and Core Presenter', organization: 'Energy Conference 2012' }], publications: { items: [{ title: 'Research Paper', publisher: { name: 'Scientific Proceedings' }, date: '2012' }] }, education: { elements: [{ school: { name: 'University' }, degreeName: 'PhD' }] }, skills: ['Geochemistry'] } } };
await fs.writeFile(fixturePath, JSON.stringify({ payload: [rich] }));
const child = spawn(process.execPath, ['--import', pathToFileURL(preloadPath).href, 'dist/server.cjs'], { env: { ...process.env, NODE_ENV: 'test', PORT: '3157', TEST_DATABASE_PATH: root + '/fixture.db', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', APIFY_TOKEN: 'isolated-provider-fixture', LINKEDIN_FIXTURE_PATH: fixturePath, PRIVATE_WORKSPACES_ONLY: 'true' }, stdio: ['ignore','pipe','pipe'] });
let log = '';
child.stdout.on('data', value => log += value);
child.stderr.on('data', value => log += value);
let cookie = '';
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
async function req(path, body, expected = 200) {
  const response = await fetch('http://127.0.0.1:3157' + path, { method: body ? 'POST' : 'GET', headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type':'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (response.status !== expected) throw Error(path + ': ' + response.status + ' ' + JSON.stringify(data));
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  return data;
}
function check(value, message) { if (!value) throw Error(message); }
try {
  let ready = false;
  for (let index=0; index<100; index++) {
    if (child.exitCode !== null) throw Error(log);
    try { const health=await req('/api/health'); if (health.database === 'ready') { ready=true; break; } } catch {}
    await pause(250);
  }
  check(ready, 'Server startup failed: '+log);
  await req('/api/auth/signup', { role:'professional', name:'Import Fixture Scientist', email:'import-'+crypto.randomUUID()+'@example.invalid', password:'ImportFixture123!', title:'Member chosen title' }, 201);
  await req('/api/linkedin-profile/refresh', { linkedinUrl }, 400);
  const imported=await req('/api/linkedin-profile/refresh', { consent:true, linkedinUrl });
  check(imported.profile.experience.length === 2, 'Grouped career was not imported');
  check(imported.profile.volunteering.length === 1, 'Volunteer service was not imported');
  check(imported.profile.publications.length === 1 && imported.profile.education.length === 1, 'Academic sections missing');
  const fixtureDb = createClient({ url: 'file:' + root + '/fixture.db' });
  const account=await req('/api/auth/me');
  const career = imported.profile.experience;
  await fixtureDb.execute({ sql: 'UPDATE linkedin_profile_enrichment SET experience=?, skills=?, publications=? WHERE user_id=?', args: [
    JSON.stringify([...career, ...career.map(item => ({ title: item.position, company: item.companyName, startDate: item.startDate.text, endDate: item.endDate?.text }))]),
    JSON.stringify(['Geochemistry', { name: 'Geochemistry', endorsements: 5 }]),
    JSON.stringify([{ title: 'Research Paper' }, ...imported.profile.publications]), account.user.id,
  ] });
  fixtureDb.close();
  const legacy = await req('/api/linkedin-profile/me');
  check(legacy.profile.experience.length === 2 && legacy.profile.skills.length === 1 && legacy.profile.publications.length === 1, 'Legacy database duplicates were not normalized on read');
  check(account.user.title === 'Member chosen title', 'Import replaced manually entered profile title');
  const activity=await req('/api/linkedin-conference/me');
  check(activity.activity.conferenceActivity.some(item=>item.role==='Session Chair' && item.year===2012 && item.memberClaimed && !item.verified), 'Profile conference role not surfaced without posts');
  check(activity.activity.conferenceActivity.some(item=>item.role==='Core Presenter'), 'Professional conference activity omitted profile role');
  await fs.writeFile(fixturePath, JSON.stringify({ payload:[{ publicIdentifier:'profile-import-fixture', fullName:'Import Fixture Scientist', headline:'Updated headline' }] }));
  const shallow=await req('/api/linkedin-profile/refresh', { consent:true, linkedinUrl });
  check(shallow.profile.experience.length === 2 && shallow.profile.volunteering.length === 1 && shallow.profile.publications.length === 1, 'Shallow refresh erased imported history');
  await fs.writeFile(fixturePath, JSON.stringify({ payload:[{ linkedinUrl:'https://www.linkedin.com/in/someone-else', fullName:'Someone Else' }] }));
  await req('/api/linkedin-profile/refresh', { consent:true, linkedinUrl }, 404);
  await fs.writeFile(fixturePath, JSON.stringify({ payload:[] }));
  await req('/api/linkedin-profile/refresh', { consent:true, linkedinUrl }, 404);
  await fs.writeFile(fixturePath, JSON.stringify({ status:502,payload:{ error:'upstream failure' } }));
  await req('/api/linkedin-profile/refresh', { consent:true, linkedinUrl }, 502);
  const preserved=await req('/api/linkedin-profile/me');
  check(preserved.profile.fullName === 'Import Fixture Scientist' && preserved.profile.experience.length === 2, 'Failed imports modified stored profile');
  const otherUrl = 'https://www.linkedin.com/in/another-import-fixture';
  await fs.writeFile(fixturePath, JSON.stringify({ payload: [{ publicIdentifier: 'another-import-fixture', fullName: 'Another Fixture', headline: 'Other career' }] }));
  const switched = await req('/api/linkedin-profile/refresh', { consent: true, linkedinUrl: otherUrl });
  check(switched.profile.experience.length === 0 && switched.profile.publications.length === 0 && switched.profile.skills.length === 0, 'Changing LinkedIn identity merged the previous person history');
  console.log('PASS: real import endpoint, grouped and aliased profile sections, manual fields, profile-only conference roles and counters, shallow refresh preservation, identity mismatch, empty/error provider responses');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(2000)]);
  if(child.exitCode===null && child.signalCode===null){ child.kill('SIGKILL'); await new Promise(resolve=>child.once('exit',resolve)); }
  await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
