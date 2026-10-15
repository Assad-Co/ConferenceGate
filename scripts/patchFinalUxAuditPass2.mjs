import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, content) => fs.writeFileSync(path.join(root, p), content);
const replace = (source, from, to, label) => {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Final UX pass 2 patch: ${label} anchor missing`);
  return source.replace(from, to);
};

// 1) Persist a destination with each server notification.
{
  const file = 'server/db.ts';
  let source = read(file);
  source = replace(
    source,
    `      message TEXT NOT NULL,\n      read INTEGER NOT NULL DEFAULT 0,`,
    `      message TEXT NOT NULL,\n      action_url TEXT,\n      read INTEGER NOT NULL DEFAULT 0,`,
    'notification action_url schema'
  );
  source = replace(
    source,
    `  const submissionColumns = await tableColumns("submissions");`,
    `  const notificationColumns = await tableColumns("notifications");\n  if (!notificationColumns.some((c) => c.name === "action_url")) {\n    await db.executeMultiple("ALTER TABLE notifications ADD COLUMN action_url TEXT;");\n  }\n\n  const submissionColumns = await tableColumns("submissions");`,
    'notification action_url migration'
  );
  source = replace(
    source,
    `  message: string;\n  read: number;`,
    `  message: string;\n  action_url: string | null;\n  read: number;`,
    'NotificationRow action_url'
  );
  write(file, source);
}

// 2) Carry destinations through the notification API and add high-value exact destinations.
{
  const file = 'server/activity.ts';
  let source = read(file);
  source = replace(
    source,
    `export async function createNotification(userId: string, type: string, title: string, message: string) {\n  await dbRun(\n    "INSERT INTO notifications (id, user_id, type, title, message) VALUES (?, ?, ?, ?, ?)",\n    [\`ntf_\${crypto.randomUUID()}\`, userId, type, title, message]\n  );\n}`,
    `export async function createNotification(\n  userId: string,\n  type: string,\n  title: string,\n  message: string,\n  actionUrl: string | null = null\n) {\n  await dbRun(\n    "INSERT INTO notifications (id, user_id, type, title, message, action_url) VALUES (?, ?, ?, ?, ?, ?)",\n    [\`ntf_\${crypto.randomUUID()}\`, userId, type, title, message, actionUrl]\n  );\n}`,
    'createNotification destination'
  );
  source = replace(
    source,
    `      message: r.message,\n      read: !!r.read,`,
    `      message: r.message,\n      actionUrl: r.action_url || undefined,\n      read: !!r.read,`,
    'notification DTO destination'
  );
  source = replace(
    source,
    `        \`You've been invited to review "\${submission.title}" for \${submission.conference_title}.\`\n      );`,
    `        \`You've been invited to review "\${submission.title}" for \${submission.conference_title}.\`,\n        \`/app?tab=reviewer&conferenceId=\${encodeURIComponent(submission.conference_id)}&submissionId=\${encodeURIComponent(submission.id)}\`\n      );`,
    'reviewer invitation destination'
  );
  source = replace(
    source,
    `      FINAL_STATUSES.includes(newStatus) ? \`has a decision: \${newStatus}.\` : "has received a new peer review."\n    }\`\n  );`,
    `      FINAL_STATUSES.includes(newStatus) ? \`has a decision: \${newStatus}.\` : "has received a new peer review."\n    }\`,\n    \`/app?tab=abstracts&submissionId=\${encodeURIComponent(submission.id)}\`\n  );`,
    'author review destination'
  );
  write(file, source);
}

// 3) Sponsor/Organizer marketplace notifications should open the relevant commercial workspace.
{
  const file = 'server/sponsors.ts';
  let source = read(file);
  source = replace(
    source,
    `  type: string,\n  title: string,\n  message: string\n) {`,
    `  type: string,\n  title: string,\n  message: string,\n  actionUrl: string | null = null\n) {`,
    'notifyPaidAccount actionUrl parameter'
  );
  source = replace(
    source,
    `    await createNotification(row.user_id, type, title, message);`,
    `    await createNotification(row.user_id, type, title, message, actionUrl);`,
    'notifyPaidAccount forwards actionUrl'
  );
  source = replace(
    source,
    `        \`\${need.conference_title} matches your Sponsor Pro profile (\${score}% match). Open the Sponsor Marketplace to review it.\`\n      );`,
    `        \`\${need.conference_title} matches your Sponsor Pro profile (\${score}% match). Open the Sponsor Marketplace to review it.\`,\n        \`/app?tab=sponsor&section=marketplace&needId=\${encodeURIComponent(need.id)}\`\n      );`,
    'sponsor matched need destination'
  );
  source = replace(
    source,
    `      \`\${sponsor.organization || sponsor.name} is interested in \${need.title} for \${need.conference_title}.\`\n    );`,
    `      \`\${sponsor.organization || sponsor.name} is interested in \${need.title} for \${need.conference_title}.\`,\n      \`/app?tab=organizer&section=sponsors&needId=\${encodeURIComponent(need.id)}\`\n    );`,
    'organizer sponsorship inquiry destination'
  );
  source = replace(
    source,
    `      \`The organizer updated your sponsorship inquiry to \${status}.\`\n    );`,
    `      \`The organizer updated your sponsorship inquiry to \${status}.\`,\n      \`/app?tab=sponsor&section=deals&needId=\${encodeURIComponent(inquiry.need_id)}\`\n    );`,
    'sponsor inquiry update destination'
  );
  source = replace(
    source,
    `      \`\${deal.opportunity_title} has new commercial terms or status.\`\n    );`,
    `      \`\${deal.opportunity_title} has new commercial terms or status.\`,\n      \`/app?tab=\${otherIsSponsor ? "sponsor" : "organizer"}&section=\${otherIsSponsor ? "deals" : "sponsors"}&dealId=\${encodeURIComponent(deal.id)}\`\n    );`,
    'deal room status destination'
  );
  source = replace(
    source,
    `      \`\${deal.opportunity_title}: \${textValue.slice(0, 140)}\`\n    );`,
    `      \`\${deal.opportunity_title}: \${textValue.slice(0, 140)}\`,\n      \`/app?tab=\${otherIsSponsor ? "sponsor" : "organizer"}&section=\${otherIsSponsor ? "deals" : "sponsors"}&dealId=\${encodeURIComponent(deal.id)}\`\n    );`,
    'deal room note destination'
  );
  write(file, source);
}

// 4) Conservative one-edit typo tolerance for stored conference search.
{
  const file = 'server/storedConferenceSearch.ts';
  let source = read(file);
  const anchor = `/** A token can match literally, by a conservative subject synonym, or by a geographic region. */\nfunction tokenMatches(text: string, token: string): boolean {`;
  const replacement = `function oneEditOrAdjacentTranspose(left: string, right: string): boolean {\n  if (left === right) return true;\n  if (Math.abs(left.length - right.length) > 1) return false;\n\n  if (left.length === right.length) {\n    const diffs: number[] = [];\n    for (let i = 0; i < left.length; i += 1) {\n      if (left[i] !== right[i]) diffs.push(i);\n      if (diffs.length > 2) return false;\n    }\n    if (diffs.length === 1) return true;\n    return diffs.length === 2 && diffs[1] === diffs[0] + 1 &&\n      left[diffs[0]] === right[diffs[1]] && left[diffs[1]] === right[diffs[0]];\n  }\n\n  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];\n  let i = 0;\n  let j = 0;\n  let edits = 0;\n  while (i < shorter.length && j < longer.length) {\n    if (shorter[i] === longer[j]) { i += 1; j += 1; continue; }\n    edits += 1;\n    if (edits > 1) return false;\n    j += 1;\n  }\n  return true;\n}\n\nfunction fuzzyTokenMatches(text: string, token: string): boolean {\n  if (token.length < 4) return false;\n  return text.split(/\\s+/).some((word) =>\n    word.length >= 4 && Math.abs(word.length - token.length) <= 1 && oneEditOrAdjacentTranspose(word, token)\n  );\n}\n\n/** A token can match literally, by a conservative subject synonym, geography, or one small typo. */\nfunction tokenMatches(text: string, token: string): boolean {`;
  source = replace(source, anchor, replacement, 'fuzzy search helper');
  source = replace(
    source,
    `  return wordStartMatcher(token).test(text);\n}`,
    `  return wordStartMatcher(token).test(text) || fuzzyTokenMatches(text, token);\n}`,
    'fuzzy token fallback'
  );
  write(file, source);
}

// 5) Frontend notification routing: honor persisted destinations, open exact message thread,
// focus the relevant abstract, and select the relevant Organizer/Sponsor workspace section.
{
  const file = 'src/App.tsx';
  let source = read(file);
  source = replace(
    source,
    `  const [activeTab, setActiveTab] = useState<string>('home');`,
    `  const [activeTab, setActiveTab] = useState<string>('home');\n  const [notificationSubmissionId, setNotificationSubmissionId] = useState<string | null>(null);\n  const [organizerNotificationSection, setOrganizerNotificationSection] = useState<'overview' | 'abstracts' | 'professionals' | 'committee' | 'sponsors' | 'communications'>('overview');\n  const [sponsorNotificationSection, setSponsorNotificationSection] = useState<'matches' | 'marketplace' | 'requests' | 'deals' | 'profile'>('matches');`,
    'notification focus state'
  );
  const oldHandler = `  const handleOpenNotification = (notification: NotificationItem) => {\n    switch (notification.type) {\n      case 'abstract':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'abstracts');\n        return;\n      case 'review':\n        setActiveTab('abstracts');\n        return;\n      case 'invitation':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'reviewer');\n        return;\n      case 'sponsorship':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'sponsor');\n        return;\n      case 'agenda':\n        setActiveTab('discover');\n        return;\n      case 'followup':\n        if (activeRole === 'Organizer') {\n          setActiveTab('organizer');\n        } else {\n          setProfileInitialTab('notifications');\n          setActiveTab('profile');\n        }\n        return;\n      case 'achievement':\n        setProfileInitialTab('conferences');\n        setActiveTab('profile');\n        return;\n      default:\n        setProfileInitialTab('notifications');\n        setActiveTab('profile');\n    }\n  };`;
  const newHandler = `  const handleOpenNotification = (notification: NotificationItem) => {\n    if (notification.id.startsWith('msg_')) {\n      handleSelectConversation(notification.id.slice(4));\n      return;\n    }\n\n    if (notification.actionUrl) {\n      try {\n        const target = new URL(notification.actionUrl, window.location.origin);\n        const tab = target.searchParams.get('tab');\n        const submissionId = target.searchParams.get('submissionId');\n        const conferenceId = target.searchParams.get('conferenceId');\n        const section = target.searchParams.get('section');\n        if (submissionId) setNotificationSubmissionId(submissionId);\n        if (conferenceId) setOpportunityConferenceId(conferenceId);\n        if (tab === 'abstracts') { setActiveTab('abstracts'); return; }\n        if (tab === 'reviewer') { setActiveTab('reviewer'); return; }\n        if (tab === 'organizer') {\n          if (section === 'abstracts' || section === 'professionals' || section === 'committee' || section === 'sponsors' || section === 'communications') {\n            setOrganizerNotificationSection(section);\n          }\n          setActiveTab('organizer');\n          return;\n        }\n        if (tab === 'sponsor') {\n          if (section === 'marketplace' || section === 'requests' || section === 'deals' || section === 'profile' || section === 'matches') {\n            setSponsorNotificationSection(section);\n          }\n          setActiveTab('sponsor');\n          return;\n        }\n      } catch {\n        // Fall through to safe type-based routing for legacy notifications.\n      }\n    }\n\n    switch (notification.type) {\n      case 'abstract':\n        if (activeRole === 'Organizer') setOrganizerNotificationSection('abstracts');\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'abstracts');\n        return;\n      case 'review':\n        setActiveTab('abstracts');\n        return;\n      case 'invitation':\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'reviewer');\n        return;\n      case 'sponsorship':\n        if (activeRole === 'Organizer') setOrganizerNotificationSection('sponsors');\n        if (activeRole === 'Sponsor') setSponsorNotificationSection('marketplace');\n        setActiveTab(activeRole === 'Organizer' ? 'organizer' : 'sponsor');\n        return;\n      case 'agenda':\n        setActiveTab('discover');\n        return;\n      case 'followup':\n        if (activeRole === 'Organizer') setActiveTab('organizer');\n        else { setProfileInitialTab('notifications'); setActiveTab('profile'); }\n        return;\n      case 'achievement':\n        setProfileInitialTab('conferences');\n        setActiveTab('profile');\n        return;\n      default:\n        setProfileInitialTab('notifications');\n        setActiveTab('profile');\n    }\n  };`;
  source = replace(source, oldHandler, newHandler, 'notification route handler');
  source = replace(
    source,
    `          <AbstractTrackerView\n            submissions={submissions}`,
    `          <AbstractTrackerView\n            submissions={submissions}\n            focusSubmissionId={notificationSubmissionId}`,
    'abstract notification focus prop'
  );
  source = replace(
    source,
    `          <OrganizerDashboard\n            conferences={myConferences}`,
    `          <OrganizerDashboard\n            conferences={myConferences}\n            initialTab={organizerNotificationSection}`,
    'organizer notification section prop'
  );
  source = replace(
    source,
    `          <SponsorPortal\n            sponsorshipPackages={sponsorshipPackagesReal}`,
    `          <SponsorPortal\n            sponsorshipPackages={sponsorshipPackagesReal}\n            initialTab={sponsorNotificationSection}`,
    'sponsor notification section prop'
  );
  write(file, source);
}

// 6) Focus exact abstract after notification navigation.
{
  const file = 'src/components/AbstractTrackerView.tsx';
  let source = read(file);
  source = replace(source, `import React, { useState } from 'react';`, `import React, { useEffect, useState } from 'react';`, 'AbstractTracker useEffect import');
  source = replace(
    source,
    `  onSubmissionUpdated?: (submission: AbstractSubmission) => void;\n}`,
    `  onSubmissionUpdated?: (submission: AbstractSubmission) => void;\n  focusSubmissionId?: string | null;\n}`,
    'AbstractTracker focus prop interface'
  );
  source = replace(
    source,
    `  onOpenNewSubmission,\n  onSubmissionUpdated,\n}) => {`,
    `  onOpenNewSubmission,\n  onSubmissionUpdated,\n  focusSubmissionId,\n}) => {`,
    'AbstractTracker focus prop destructure'
  );
  source = replace(
    source,
    `  const [revisionText, setRevisionText] = useState('');`,
    `  useEffect(() => {\n    if (focusSubmissionId && submissions.some((submission) => submission.id === focusSubmissionId)) {\n      setSelectedSubId(focusSubmissionId);\n    }\n  }, [focusSubmissionId, submissions]);\n\n  const [revisionText, setRevisionText] = useState('');`,
    'AbstractTracker focus effect'
  );
  write(file, source);
}

// 7) Allow notification navigation to land on the correct paid-workspace section.
{
  const file = 'src/components/OrganizerDashboard.tsx';
  let source = read(file);
  source = replace(
    source,
    `  onAddNotification?: (notif: { title: string; message: string; type: 'followup'; actionUrl?: string }) => void;\n}`,
    `  onAddNotification?: (notif: { title: string; message: string; type: 'followup'; actionUrl?: string }) => void;\n  initialTab?: 'overview' | 'abstracts' | 'professionals' | 'committee' | 'sponsors' | 'communications';\n}`,
    'Organizer initialTab prop'
  );
  source = replace(
    source,
    `  onAddNotification = (_notif: { title: string; message: string; type: 'followup'; actionUrl?: string }) => {},\n}) => {`,
    `  onAddNotification = (_notif: { title: string; message: string; type: 'followup'; actionUrl?: string }) => {},\n  initialTab = 'overview',\n}) => {`,
    'Organizer initialTab destructure'
  );
  source = replace(
    source,
    `  >('overview');\n\n  const [professionalSearch, setProfessionalSearch]`,
    `  >(initialTab);\n\n  useEffect(() => {\n    if (initialTab) setActiveTab(initialTab);\n  }, [initialTab]);\n\n  const [professionalSearch, setProfessionalSearch]`,
    'Organizer initialTab effect'
  );
  write(file, source);
}

{
  const file = 'src/components/SponsorPortal.tsx';
  let source = read(file);
  source = replace(
    source,
    `  ownerPreview?: boolean;\n}`,
    `  ownerPreview?: boolean;\n  initialTab?: 'matches' | 'marketplace' | 'requests' | 'deals' | 'profile';\n}`,
    'Sponsor initialTab prop'
  );
  source = replace(
    source,
    `  onApplyForSponsorship,\n  ownerPreview = false,\n}) => {`,
    `  onApplyForSponsorship,\n  ownerPreview = false,\n  initialTab = 'matches',\n}) => {`,
    'Sponsor initialTab destructure'
  );
  source = replace(
    source,
    `  const [activeTab, setActiveTab] = useState<'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'workspace' | 'roi' | 'profile'>('preferences');`,
    `  const [activeTab, setActiveTab] = useState<'matches' | 'marketplace' | 'saved' | 'requests' | 'deals' | 'preferences' | 'workspace' | 'roi' | 'profile'>(initialTab);\n  useEffect(() => {\n    if (initialTab) setActiveTab(initialTab);\n  }, [initialTab]);`,
    'Sponsor initialTab state/effect'
  );
  write(file, source);
}

console.log('Final UX audit pass 2 patch applied.');
