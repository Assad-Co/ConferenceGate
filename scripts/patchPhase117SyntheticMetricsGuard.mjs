import fs from 'node:fs';

function replaceExact(text, from, to, label, expected = 1) {
  const count = text.split(from).length - 1;
  if (count !== expected) {
    throw new Error(`${label}: expected ${expected} match(es), found ${count}`);
  }
  return text.split(from).join(to);
}

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after === before) throw new Error(`${path}: patch produced no changes`);
  fs.writeFileSync(path, after);
  console.log(`patched ${path}`);
}

patchFile('server/growthDashboard.ts', (input) => {
  let s = input;
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=?", [role]),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\'", [role]),',
    'dashboard role signups'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-7 days\')", [role]),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-7 days\')", [role]),',
    'dashboard role signups7d'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-30 days\')", [role]),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-30 days\')", [role]),',
    'dashboard role signups30d'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND subscription_status IN (\'active\',\'trialing\')", [role]),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND subscription_status IN (\'active\',\'trialing\')", [role]),',
    'dashboard role paid'
  );
  s = replaceExact(
    s,
    "          AND u.role=?`,\n      [role]",
    "          AND u.role=?\n          AND lower(u.email) NOT LIKE '%.invalid'`,\n      [role]",
    'dashboard role checkout account filters',
    2
  );
  s = replaceExact(
    s,
    "          WHERE u.role='organizer'\n            AND EXISTS",
    "          WHERE u.role='organizer'\n            AND lower(u.email) NOT LIKE '%.invalid'\n            AND EXISTS",
    'dashboard organizer activation'
  );
  s = replaceExact(
    s,
    "          WHERE u.role='sponsor'\n            AND (",
    "          WHERE u.role='sponsor'\n            AND lower(u.email) NOT LIKE '%.invalid'\n            AND (",
    'dashboard sponsor activation'
  );
  s = replaceExact(
    s,
    "      WHERE u.subscription_status IN ('active','trialing')\n      GROUP BY w.account_role`",
    "      WHERE u.subscription_status IN ('active','trialing')\n        AND lower(u.email) NOT LIKE '%.invalid'\n      GROUP BY w.account_role`",
    'dashboard retention synthetic filter'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role IN (\'organizer\',\'sponsor\')"),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role IN (\'organizer\',\'sponsor\') AND lower(email) NOT LIKE \'%.invalid\'"),',
    'dashboard acquisition paid-role signups'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM account_acquisition"),',
    'scalar("SELECT COUNT(*) AS value FROM account_acquisition a JOIN users u ON u.id=a.user_id WHERE lower(u.email) NOT LIKE \'%.invalid\'"),',
    'dashboard acquisition attributed signups'
  );
  s = replaceExact(
    s,
    `      \`SELECT source,role,COUNT(*) AS signups\n         FROM account_acquisition\n        GROUP BY source,role`,
    `      \`SELECT a.source AS source,a.role AS role,COUNT(*) AS signups\n         FROM account_acquisition a\n         JOIN users u ON u.id=a.user_id\n        WHERE lower(u.email) NOT LIKE '%.invalid'\n        GROUP BY a.source,a.role`,
    'dashboard acquisition top sources'
  );
  s = replaceExact(
    s,
    "        WHERE a.role='organizer'\n        GROUP BY a.source,COALESCE(a.medium,'')",
    "        WHERE a.role='organizer'\n          AND lower(u.email) NOT LIKE '%.invalid'\n        GROUP BY a.source,COALESCE(a.medium,'')",
    'dashboard acquisition organizer source filter'
  );
  s = replaceExact(
    s,
    "        WHERE a.role='organizer'\n        GROUP BY COALESCE(NULLIF(a.campaign,''),'(no campaign)'),a.source",
    "        WHERE a.role='organizer'\n          AND lower(u.email) NOT LIKE '%.invalid'\n        GROUP BY COALESCE(NULLIF(a.campaign,''),'(no campaign)'),a.source",
    'dashboard acquisition campaign filter'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=\'organizer\' AND subscription_status IN (\'active\',\'trialing\')"),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=\'organizer\' AND lower(email) NOT LIKE \'%.invalid\' AND subscription_status IN (\'active\',\'trialing\')"),',
    'dashboard revenue paid organizers'
  );
  s = replaceExact(
    s,
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=\'sponsor\' AND subscription_status IN (\'active\',\'trialing\')"),',
    'scalar("SELECT COUNT(*) AS value FROM users WHERE role=\'sponsor\' AND lower(email) NOT LIKE \'%.invalid\' AND subscription_status IN (\'active\',\'trialing\')"),',
    'dashboard revenue paid sponsors'
  );
  s = replaceExact(
    s,
    "      WHERE l.cohort=?\n      ORDER BY l.role,l.created_at`,",
    "      WHERE l.cohort=?\n        AND lower(u.email) NOT LIKE '%.invalid'\n      ORDER BY l.role,l.created_at`,",
    'launch cohort synthetic filter'
  );
  s = replaceExact(
    s,
    '    const [current7d, prior7d, current30d, prior30d] = await Promise.all([\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-7 days\')", [role]),\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-14 days\') AND created_at < datetime(\'now\',\'-7 days\')", [role]),\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-30 days\')", [role]),\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-60 days\') AND created_at < datetime(\'now\',\'-30 days\')", [role]),\n    ]);',
    '    const [current7d, prior7d, current30d, prior30d] = await Promise.all([\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-7 days\')", [role]),\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-14 days\') AND created_at < datetime(\'now\',\'-7 days\')", [role]),\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-30 days\')", [role]),\n      scalar("SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-60 days\') AND created_at < datetime(\'now\',\'-30 days\')", [role]),\n    ]);',
    'dashboard movement synthetic filter'
  );
  return s;
});

patchFile('server/discovery/router.ts', (input) => {
  return replaceExact(
    input,
    '    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";\n    if (!email) return res.status(400).json({ error: "email is required." });\n\n    const user = await dbGet<any>("SELECT id,email,name,organization,role FROM users WHERE lower(email)=?", [email]);',
    '    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";\n    if (!email) return res.status(400).json({ error: "email is required." });\n    const emailDomain = email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";\n    if (emailDomain === "invalid" || emailDomain.endsWith(".invalid")) {\n      return res.status(400).json({\n        error: "Synthetic acceptance accounts cannot join a real-customer launch cohort.",\n      });\n    }\n\n    const user = await dbGet<any>("SELECT id,email,name,organization,role FROM users WHERE lower(email)=?", [email]);',
    'launch cohort synthetic enrollment rejection'
  );
});

patchFile('scripts/growthCohortReport.mjs', (input) => {
  let s = input;
  s = replaceExact(
    s,
    "     WHERE u.role IN ('organizer','sponsor')\n     GROUP BY substr(u.created_at,1,7),u.role",
    "     WHERE u.role IN ('organizer','sponsor')\n       AND lower(u.email) NOT LIKE '%.invalid'\n     GROUP BY substr(u.created_at,1,7),u.role",
    'cohort report signup cohorts'
  );
  s = replaceExact(
    s,
    '    "SELECT COUNT(*) AS count FROM users WHERE role IN (\'organizer\',\'sponsor\')"',
    '    "SELECT COUNT(*) AS count FROM users WHERE role IN (\'organizer\',\'sponsor\') AND lower(email) NOT LIKE \'%.invalid\'"',
    'cohort report signup coverage'
  );
  s = replaceExact(
    s,
    '        JOIN users u ON u.id=a.user_id\n       GROUP BY a.role,a.source,COALESCE(a.medium,\'\'),COALESCE(a.campaign,\'\')',
    '        JOIN users u ON u.id=a.user_id\n       WHERE lower(u.email) NOT LIKE \'%.invalid\'\n       GROUP BY a.role,a.source,COALESCE(a.medium,\'\'),COALESCE(a.campaign,\'\')',
    'cohort report acquisition rows'
  );
  s = replaceExact(
    s,
    "    const attributedRows = await rows('SELECT COUNT(*) AS count FROM account_acquisition');",
    "    const attributedRows = await rows(\"SELECT COUNT(*) AS count FROM account_acquisition a JOIN users u ON u.id=a.user_id WHERE lower(u.email) NOT LIKE '%.invalid'\");",
    'cohort report attributed coverage'
  );
  s = replaceExact(
    s,
    '      "SELECT COUNT(DISTINCT user_id) AS count FROM subscription_status_history WHERE reason=\'baseline_observed_state\'"',
    '      "SELECT COUNT(DISTINCT h.user_id) AS count FROM subscription_status_history h JOIN users u ON u.id=h.user_id WHERE h.reason=\'baseline_observed_state\' AND lower(u.email) NOT LIKE \'%.invalid\'"',
    'cohort report baseline synthetic filter'
  );
  s = replaceExact(
    s,
    "        FROM subscription_status_history\n       WHERE changed_at >= datetime('now','-30 days')",
    "        FROM subscription_status_history h\n        JOIN users u ON u.id=h.user_id\n       WHERE lower(u.email) NOT LIKE '%.invalid'\n         AND changed_at >= datetime('now','-30 days')",
    'cohort report transitions synthetic filter'
  );
  return s;
});

patchFile('scripts/growthReport.mjs', (input) => {
  let s = input;
  s = replaceExact(
    s,
    "  const signups = await scalar('SELECT COUNT(*) AS value FROM users WHERE role=?', [role]);",
    "  const signups = await scalar(\"SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE '%.invalid'\", [role]);",
    'growth report signups'
  );
  s = replaceExact(
    s,
    '    "SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-7 days\')",',
    '    "SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-7 days\')",',
    'growth report signups7d'
  );
  s = replaceExact(
    s,
    '    "SELECT COUNT(*) AS value FROM users WHERE role=? AND created_at >= datetime(\'now\',\'-30 days\')",',
    '    "SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND created_at >= datetime(\'now\',\'-30 days\')",',
    'growth report signups30d'
  );
  s = replaceExact(
    s,
    '    "SELECT COUNT(*) AS value FROM users WHERE role=? AND subscription_status IN (\'active\',\'trialing\')",',
    '    "SELECT COUNT(*) AS value FROM users WHERE role=? AND lower(email) NOT LIKE \'%.invalid\' AND subscription_status IN (\'active\',\'trialing\')",',
    'growth report paid'
  );
  s = replaceExact(
    s,
    "       WHERE u.role='organizer'\n         AND EXISTS",
    "       WHERE u.role='organizer'\n         AND lower(u.email) NOT LIKE '%.invalid'\n         AND EXISTS",
    'growth report organizer activation',
    2
  );
  s = replaceExact(
    s,
    "     WHERE u.role='sponsor'\n       AND (",
    "     WHERE u.role='sponsor'\n       AND lower(u.email) NOT LIKE '%.invalid'\n       AND (",
    'growth report sponsor activation'
  );
  s = replaceExact(
    s,
    "     WHERE u.role='sponsor' AND u.subscription_status IN ('active','trialing')\n       AND (",
    "     WHERE u.role='sponsor' AND u.subscription_status IN ('active','trialing')\n       AND lower(u.email) NOT LIKE '%.invalid'\n       AND (",
    'growth report sponsor paid activation'
  );
  s = s.replaceAll(
    "          AND u.role=?`,",
    "          AND u.role=?\n          AND lower(u.email) NOT LIKE '%.invalid'`,"
  );
  s = replaceExact(
    s,
    "        AND u.role IN ('organizer','sponsor')\n      GROUP BY u.role,e.provider",
    "        AND u.role IN ('organizer','sponsor')\n        AND lower(u.email) NOT LIKE '%.invalid'\n      GROUP BY u.role,e.provider",
    'growth report provider checkout synthetic filter'
  );
  return s;
});

patchFile('scripts/smokeGrowthDashboard.mjs', (input) => {
  let s = input;
  s = replaceExact(
    s,
    '  const organizer = await signupOrganizer();\n  const sponsor = await signupSponsor();\n',
    `  const organizer = await signupOrganizer();\n  const sponsor = await signupSponsor();\n\n  const syntheticResponse = await fetch(base + '/api/auth/signup', {\n    method: 'POST',\n    headers: { 'content-type': 'application/json' },\n    body: JSON.stringify({\n      role: 'organizer',\n      name: 'Synthetic Acceptance Organizer',\n      email: 'growth-dashboard-acceptance@example.invalid',\n      password: 'GrowthDashboard123!',\n      organization: 'Synthetic Acceptance Only',\n    }),\n  });\n  const syntheticBody = await syntheticResponse.json();\n  if (!syntheticResponse.ok || !syntheticBody?.user?.id) {\n    throw new Error('Could not create synthetic acceptance account for exclusion test.');\n  }\n`,
    'growth dashboard synthetic fixture'
  );
  s = replaceExact(
    s,
    "  const addOrganizerCohort = await jsonRequest('/api/admin/discovery/launch-cohort/members', {",
    `  const rejectSyntheticCohort = await jsonRequest('/api/admin/discovery/launch-cohort/members', {\n    method: 'POST',\n    cookie: organizer.cookie,\n    token: adminToken,\n    body: { email: 'growth-dashboard-acceptance@example.invalid', segment: 'must-not-enroll' },\n  });\n  if (rejectSyntheticCohort.response.status !== 400) {\n    throw new Error('Synthetic acceptance account must be rejected from the real-customer launch cohort.');\n  }\n\n  const addOrganizerCohort = await jsonRequest('/api/admin/discovery/launch-cohort/members', {`,
    'growth dashboard synthetic cohort rejection test'
  );
  s = replaceExact(
    s,
    "    phase78: {\n      firstCustomerLaunchCohort: true,",
    "    syntheticAcceptanceExclusion: {\n      dashboardMetrics: true,\n      launchCohortEnrollmentRejected: true,\n    },\n    phase78: {\n      firstCustomerLaunchCohort: true,",
    'growth dashboard smoke output'
  );
  return s;
});
