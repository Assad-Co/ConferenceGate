// Synthetic production acceptance; no payment-provider calls or outreach.
import crypto from 'node:crypto';
const target = new URL(process.env.PHASE11_BASE_URL || 'https://conferencegate.onrender.com');
if (target.protocol !== 'https:') throw Error('HTTPS required for live acceptance');
const base = target.origin;
async function req(path, { method = 'GET', cookie, body, expected } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (expected ? response.status !== expected : !response.ok) throw new Error(method + ' ' + path + ': ' + response.status + ' ' + JSON.stringify(data));
  return { data, response };
}
async function signup(role) {
  const email = role + '-' + crypto.randomUUID() + '@example.invalid';
  const { data, response } = await req('/api/auth/signup', { method: 'POST', body: { role, email, name: role + ' acceptance', password: crypto.randomBytes(24).toString('base64url') + '!9a', organization: 'Integration Test', title: role === 'professional' ? 'Senior Geologist' : undefined }, expected: 201 });
  if (!data.user?.id) throw Error('Signup missing user');
  return { ...data.user, cookie: response.headers.get('set-cookie')?.split(';')[0], email };
}
function check(value, message) { if (!value) throw Error(message); }
try {
  const capabilities = await req('/api/auth/capabilities');
  if (capabilities.data.privateWorkspacesOnly) {
    const professional = await signup('professional');
    check(professional.hasPaidAccess && !professional.ownerPreview, 'Public Professional access must remain available without owner privileges');
    for (const role of ['organizer', 'sponsor']) {
      await req('/api/auth/signup', { method: 'POST', body: { role, email: role + '-' + crypto.randomUUID() + '@example.invalid', name: 'Closed workspace acceptance', password: crypto.randomBytes(24).toString('base64url') + '!9a' }, expected: 403 });
    }
    await req('/api/activity/conferences', { method: 'POST', cookie: professional.cookie, body: { id: 'must-not-create', title: 'Blocked', dates: {}, location: {} }, expected: 403 });
    await req('/api/sponsors/preferences/mine', { method: 'PUT', cookie: professional.cookie, body: { sectors: [] }, expected: 403 });
    const me = await req('/api/auth/me', { cookie: professional.cookie });
    check(me.data.user?.hasPaidAccess === true && me.data.user?.ownerPreview === false, 'Professional session must not gain admin access');
    console.log('PASS: Professional public signup; Organizer/Sponsor registration and role APIs closed to public accounts');
  } else {
  const author = await signup('professional');
  const reviewer = await signup('professional');
  const organizer = await signup('organizer');
  const sponsor = await signup('sponsor');
  for (const account of [author, reviewer, organizer, sponsor]) {
    check(account.cookie && account.hasPaidAccess === true, account.role + ' must have immediate free access');
    const me = await req('/api/auth/me', { cookie: account.cookie });
    check(me.data.user?.id === account.id && me.data.user?.hasPaidAccess === true, account.role + ' session access failed');
  }
  for (const account of [organizer, sponsor]) {
    const billing = await req('/api/billing/status', { cookie: account.cookie });
    check(billing.data.hasPaidAccess === true, account.role + ' billing access is blocked');
  }
  await req('/api/sponsors/preferences/mine', { method: 'PUT', cookie: sponsor.cookie, body: { sectors: ['Energy'], categories: [], regions: ['Middle East'], opportunityTypes: [], budgetMin: null, budgetMax: null, alertFrequency: 'instant' } });
  await req('/api/sponsors/preferences/mine', { method: 'PUT', cookie: author.cookie, body: { sectors: [], categories: [], regions: [], opportunityTypes: [], budgetMin: null, budgetMax: null, alertFrequency: 'instant' }, expected: 403 });
  const conferenceId = 'conf_live_acceptance_' + crypto.randomUUID();
  const title = 'ConferenceGate Synthetic Launch Acceptance (test only)';
  const created = await req('/api/activity/conferences', { method: 'POST', cookie: organizer.cookie, body: { id: conferenceId, title, description: 'Automated acceptance only', industry: 'Energy', topics: ['Geochemistry'], tracks: ['Geochemistry'], dates: { start: '2027-05-10', end: '2027-05-12' }, location: { city: 'Manama', country: 'Bahrain' }, format: 'Physical', cfpStatus: 'Open' } });
  check(created.data.conference?.id === conferenceId, 'Conference not created');
  const submission = await req('/api/activity/submissions', { method: 'POST', cookie: author.cookie, body: { conferenceId, conferenceTitle: title, title: 'Geochemistry Abstract', abstractText: 'Synthetic scientific abstract for isolated integration acceptance.', preferredType: 'Oral', primaryAuthor: { name: author.name, email: author.email, affiliation: 'Integration Test' } } });
  const id = submission.data.submission?.id;
  check(id, 'Abstract not persisted');
  await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: author.cookie, expected: 409 });
  await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: reviewer.cookie, expected: 404 });
  const assigned = await req('/api/activity/submissions/' + id + '/assign-reviewer', { method: 'POST', cookie: organizer.cookie, body: { reviewerId: reviewer.id } });
  check(assigned.data.submission?.id === id, 'Reviewer assignment not persisted');
  await req('/api/activity/submissions/' + id + '/reviews', { method: 'POST', cookie: author.cookie, body: { commentsToAuthor: 'Self approval', recommendation: 'Accept' }, expected: 403 });
  const reviewed = await req('/api/activity/submissions/' + id + '/reviews', { method: 'POST', cookie: reviewer.cookie, body: { commentsToAuthor: 'Accepted after peer review', recommendation: 'Accept', scores: { quality: 5 } }, expected: 201 });
  check(reviewed.data.submission?.status === 'Accepted', 'Review did not approve abstract');
  const issued = await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: author.cookie, expected: 201 });
  const certificate = issued.data.certificate;
  check(/^CG-AA-[A-F0-9]{32}$/.test(certificate?.id || ''), 'Certificate ID invalid');
  const verified = await req('/api/certificates/verify/' + certificate.id);
  check(verified.data.valid === true && verified.data.certificate?.recipientName === author.name, 'Certificate verification failed');
  const repeat = await req('/api/certificates/issue/abstract/' + id, { method: 'POST', cookie: author.cookie });
  check(repeat.data.certificate?.id === certificate.id, 'Certificate issuance not idempotent');
  console.log('PASS: conference, abstract, reviewer assignment, acceptance, authorized issuance, public verification, idempotency and cross-user isolation');
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
