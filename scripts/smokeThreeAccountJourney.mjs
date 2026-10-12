import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = Number(process.env.THREE_ACCOUNT_SMOKE_PORT || 3118);
const dbPath = process.env.THREE_ACCOUNT_SMOKE_DB || '/tmp/conferencegate-three-account-smoke.db';
const billingSecret = 'three-account-smoke-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
}

const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    TEST_DATABASE_PATH: dbPath,
    BILLING_SYNC_SECRET: billingSecret,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    try {
      const response = await fetch(base + '/api/health');
      if (response.ok) return;
    } catch {}
    await sleep(350);
  }
  throw new Error(`Timed out waiting for server health.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

async function request(path, { method = 'GET', cookie, body, billing = false, expected } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (billing) headers['x-billing-sync-secret'] = billingSecret;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 800) }; }
  if (expected !== undefined) {
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (!expectedStatuses.includes(response.status)) {
      throw new Error(`${method} ${path}: expected ${expectedStatuses.join('/')}, got ${response.status} ${JSON.stringify(data)}`);
    }
  } else if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return { status: response.status, data };
}

async function signup(role, email) {
  const names = {
    professional: ['Real User Professional', 'Independent Researcher'],
    organizer: ['Real User Organizer', 'Real User Events'],
    sponsor: ['Real User Sponsor', 'Real User Energy Brand'],
  };
  const [name, organization] = names[role];
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role,
      name,
      email,
      password: 'ThreeAccountSmoke123!',
      organization,
      title: role === 'professional' ? 'Petroleum Geochemist' : undefined,
    }),
  });
  const data = await response.json();
  if (!response.ok || data?.user?.role !== role || !data?.user?.id) {
    throw new Error(`Signup failed for ${role}: ${response.status} ${JSON.stringify(data)}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`No session cookie returned for ${role}`);
  return { user: data.user, cookie: setCookie.split(';')[0] };
}

async function activatePaid(userId, eventId, plan) {
  await request('/api/billing/provider-sync', {
    method: 'POST',
    billing: true,
    body: {
      provider: 'three-account-smoke',
      eventId,
      eventType: 'subscription.activated',
      userId,
      status: 'active',
      plan,
      customerRef: `customer_${userId}`,
    },
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await waitForHealth();

  // Three genuinely separate sessions, matching the three production account types.
  const professional = await signup('professional', 'three-account-professional@example.com');
  const organizer = await signup('organizer', 'three-account-organizer@example.com');
  const sponsor = await signup('sponsor', 'three-account-sponsor@example.com');

  assert(professional.user.hasPaidAccess === true, 'Professional free account should be usable immediately.');
  assert(organizer.user.hasPaidAccess === false, 'New Organizer should not bypass billing.');
  assert(sponsor.user.hasPaidAccess === false, 'New Sponsor should not bypass billing.');

  // Prove role isolation before enabling paid workspaces.
  await request('/api/activity/conferences', {
    method: 'POST',
    cookie: professional.cookie,
    body: { id: 'forbidden_prof_conf', title: 'Forbidden', dates: {}, location: {} },
    expected: 403,
  });
  await request('/api/sponsors/preferences/mine', {
    method: 'PUT',
    cookie: organizer.cookie,
    body: { sectors: [], categories: [], regions: [], opportunityTypes: [], budgetMin: null, budgetMax: null, alertFrequency: 'instant' },
    expected: 403,
  });

  await activatePaid(organizer.user.id, 'three_account_org_active', 'organizer_pro_smoke');
  await activatePaid(sponsor.user.id, 'three_account_sponsor_active', 'sponsor_pro_smoke');
  const organizerStatus = (await request('/api/billing/status', { cookie: organizer.cookie })).data;
  const sponsorStatus = (await request('/api/billing/status', { cookie: sponsor.cookie })).data;
  assert(organizerStatus.hasPaidAccess === true, 'Organizer Pro activation failed.');
  assert(sponsorStatus.hasPaidAccess === true, 'Sponsor Pro activation failed.');

  // PROFESSIONAL: configure a real discoverable professional profile.
  const professionalProfile = (await request('/api/auth/me/professional-preferences', {
    method: 'PATCH',
    cookie: professional.cookie,
    body: {
      professionalExpertise: ['Petroleum Geochemistry', 'Organic Geochemistry'],
      technicalSpecialization: ['GC-MS', 'Biomarkers'],
      researchInterests: ['Source rock evaluation'],
      preferredRegions: ['Middle East'],
      committeeAvailable: true,
      sessionChairAvailable: true,
      speakerAvailable: true,
      reviewerMaxLoad: 5,
    },
  })).data.user;
  assert(professionalProfile.committeeAvailable === true, 'Professional availability did not persist.');

  // ORGANIZER: create a real persisted conference.
  const conferenceId = 'conf_three_account_real_2027';
  const conferenceTitle = 'Three Account Energy & Geoscience Conference 2027';
  const conference = (await request('/api/activity/conferences', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      id: conferenceId,
      title: conferenceTitle,
      description: 'End-to-end account journey validation conference.',
      industry: 'Energy & Geosciences',
      topics: ['Petroleum Geochemistry', 'Organic Geochemistry'],
      tracks: ['Petroleum Systems'],
      dates: { start: '2027-05-10', end: '2027-05-12' },
      location: { city: 'Manama', country: 'Bahrain', venue: 'Test Convention Centre' },
      format: 'Physical',
      cfpStatus: 'Open',
    },
  })).data.conference;
  assert(conference?.id === conferenceId, 'Organizer conference creation did not persist.');

  // PROFESSIONAL -> ORGANIZER: registration and abstract submission must be visible across sessions.
  await request('/api/activity/registrations', {
    method: 'POST',
    cookie: professional.cookie,
    body: { conferenceId, conferenceTitle, packageId: 'standard', packageName: 'Standard Delegate' },
  });
  const registrations = (await request('/api/activity/registrations/mine', { cookie: professional.cookie })).data.registrations || [];
  assert(registrations.some((item) => item.conferenceId === conferenceId), 'Professional registration was not persisted.');

  const submission = (await request('/api/activity/submissions', {
    method: 'POST',
    cookie: professional.cookie,
    body: {
      conferenceId,
      conferenceTitle,
      title: 'Biomarker Integration for Source-Rock Evaluation',
      track: 'Petroleum Systems',
      topic: 'Petroleum Geochemistry',
      keywords: ['biomarkers', 'GC-MS'],
      abstractText: 'A synthetic integration-test abstract used only to validate the real three-account workflow.',
      preferredType: 'Oral',
      primaryAuthor: {
        name: professional.user.name,
        email: 'three-account-professional@example.com',
        affiliation: 'Independent Researcher',
        bio: '',
      },
      coAuthors: [],
      conflictOfInterest: '',
    },
  })).data.submission;
  assert(submission?.submitterId === professional.user.id, 'Professional abstract submission did not retain its owner.');
  const organizerVisibleSubmissions = (await request('/api/activity/submissions', { cookie: organizer.cookie })).data.submissions || [];
  assert(organizerVisibleSubmissions.some((item) => item.id === submission.id), 'Organizer cannot see the Professional submission.');

  // ORGANIZER -> PROFESSIONAL: publish an opportunity, receive interest, invite, accept, complete.
  const opportunity = (await request('/api/activity/professional-opportunities', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      conferenceId,
      roleType: 'committee',
      title: 'Technical Committee Member — Petroleum Geochemistry',
      description: 'Support abstract review and technical-program quality.',
      expertiseRequired: ['Petroleum Geochemistry'],
      preferredRegions: ['Middle East'],
      deadline: '2027-03-01',
    },
  })).data.opportunity;
  assert(opportunity?.id, 'Organizer professional opportunity was not created.');
  const professionalOpportunities = (await request('/api/activity/professional-opportunities', { cookie: professional.cookie })).data.opportunities || [];
  assert(professionalOpportunities.some((item) => item.id === opportunity.id), 'Professional cannot see organizer opportunity.');
  await request(`/api/activity/professional-opportunities/${opportunity.id}/interest`, {
    method: 'POST',
    cookie: professional.cookie,
  });
  const interestIds = (await request('/api/activity/professional-opportunities/interests/mine', { cookie: professional.cookie })).data.opportunityIds || [];
  assert(interestIds.includes(opportunity.id), 'Professional interest was not persisted.');

  const invitation = (await request('/api/activity/professional-invitations', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      professionalId: professional.user.id,
      conferenceId,
      opportunityId: opportunity.id,
      roleType: 'committee',
      title: 'Technical Committee Member',
      message: 'We invite you to join the technical committee.',
    },
  })).data.invitation;
  assert(invitation?.id, 'Organizer could not create Professional invitation.');
  const professionalInvitations = (await request('/api/activity/professional-invitations/mine', { cookie: professional.cookie })).data.invitations || [];
  assert(professionalInvitations.some((item) => item.id === invitation.id), 'Professional did not receive organizer invitation.');
  const acceptedInvitation = (await request(`/api/activity/professional-invitations/${invitation.id}/respond`, {
    method: 'POST',
    cookie: professional.cookie,
    body: { decision: 'accepted' },
  })).data.invitation;
  assert(acceptedInvitation?.status === 'accepted', 'Professional invitation acceptance did not persist.');
  const completedInvitation = (await request(`/api/activity/professional-invitations/${invitation.id}/complete`, {
    method: 'POST',
    cookie: organizer.cookie,
  })).data.invitation;
  assert(completedInvitation?.status === 'completed' || completedInvitation?.completedAt, 'Organizer could not complete accepted Professional role.');

  const professionalNotifications = (await request('/api/activity/notifications/mine', { cookie: professional.cookie })).data.notifications || [];
  assert(professionalNotifications.some((item) => /invitation/i.test(item.title || item.type || '')), 'Professional did not receive invitation notification.');

  // ORGANIZER <-> SPONSOR: package application, approval, verified review and sponsor-profile update.
  const sponsorshipPackage = (await request('/api/sponsors/packages', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      conferenceId,
      tier: 'Gold',
      price: 10000,
      benefits: ['Logo placement', 'Technical-session recognition'],
      totalSlots: 2,
    },
  })).data.package;
  assert(sponsorshipPackage?.id, 'Organizer sponsorship package was not created.');
  const application = (await request('/api/sponsors/applications', {
    method: 'POST',
    cookie: sponsor.cookie,
    body: { packageId: sponsorshipPackage.id },
  })).data.application;
  assert(application?.id, 'Sponsor application was not created.');
  const applicants = (await request('/api/sponsors/applications/for-my-packages', { cookie: organizer.cookie })).data.applicants || [];
  const applicant = applicants.find((item) => item.applicationId === application.id);
  assert(applicant?.sponsor?.id === sponsor.user.id, 'Organizer did not receive Sponsor application.');
  await request(`/api/sponsors/applications/${application.id}/decide`, {
    method: 'POST',
    cookie: organizer.cookie,
    body: { status: 'Approved' },
  });
  const reviewable = (await request('/api/sponsors/reviewable/mine', { cookie: organizer.cookie })).data.sponsors || [];
  assert(reviewable.some((item) => item.id === sponsor.user.id), 'Approved Sponsor did not become reviewable.');

  await request('/api/sponsors/reviews', {
    method: 'POST',
    cookie: organizer.cookie,
    body: {
      sponsorId: sponsor.user.id,
      conferenceTitle,
      rating: 5,
      overallScore: 5.6,
      ratings: {
        delivery_0: 6, delivery_1: 6, delivery_2: 5, delivery_3: 6, delivery_4: 5,
        partnership_0: 6, partnership_1: 5, partnership_2: 6, partnership_3: 5, partnership_4: 6,
      },
      comment: 'Three-account integration test: verified organizer feedback.',
    },
  });
  const sponsorProfile = (await request('/api/sponsors/profile/mine', { cookie: sponsor.cookie })).data;
  assert(Number(sponsorProfile.reviewsCount || 0) >= 1, 'Organizer review did not reach Sponsor profile.');

  console.log(JSON.stringify({
    threeAccountRealUserJourney: 'passed',
    accounts: ['professional', 'organizer', 'sponsor'],
    roleIsolation: true,
    professional: {
      profilePreferences: true,
      registration: true,
      abstractSubmission: true,
      opportunityInterest: true,
      invitationReceived: true,
      invitationAccepted: true,
      completedRole: true,
      notificationReceived: true,
    },
    organizer: {
      conferenceCreated: true,
      submissionVisible: true,
      opportunityPublished: true,
      professionalInvited: true,
      sponsorApplicationApproved: true,
      sponsorReviewed: true,
    },
    sponsor: {
      packageApplication: true,
      approvedRelationship: true,
      verifiedFeedbackVisible: true,
    },
  }, null, 2));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
  }
}
