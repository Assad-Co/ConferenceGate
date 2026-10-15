import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/OrganizerDashboard.tsx', 'utf8');
const recruitment = fs.readFileSync('src/components/ProfessionalRecruitmentPanel.tsx', 'utf8');
const upload = fs.readFileSync('src/components/OrganizerReviewerQuickUpload.tsx', 'utf8');
const clientActivity = fs.readFileSync('src/api/activity.ts', 'utf8');
const serverActivity = fs.readFileSync('server/activity.ts', 'utf8');

const checks = {
  committeeConnectionsLabel: dashboard.includes('Professional Network & Committee Connections'),
  reviewerMatchingLabel: dashboard.includes('Abstracts & Reviewer Matching'),
  noAiMatcherLabel: !dashboard.includes('Abstracts & AI Matcher'),
  noRecruitmentNavLabel: !dashboard.includes('Professional Network & Committee Recruitment'),
  reviewerOpportunityLabel: dashboard.includes('Publish Reviewer Opportunity'),
  expertiseFocusLabel: dashboard.includes('Expertise focus, comma separated'),
  committeeMessagingUI: dashboard.includes('Send Message & Notification') && dashboard.includes('Message Technical Committee'),
  committeeMessagingClient: clientActivity.includes('sendCommitteeAnnouncement') && clientActivity.includes('/api/activity/organizer/committee-message'),
  committeeMessagingServer: serverActivity.includes('/organizer/committee-message') && serverActivity.includes("role_type IN ('committee','chair')") && serverActivity.includes('createNotification(recipient.professional_id'),
  recruitmentWordingClean: recruitment.includes('Connect with the right committee') && recruitment.includes('connect committee'),
  uploadLabelClear: upload.includes('Upload abstract / review document') && upload.includes("accept=\".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document\""),
  editProfileWired: dashboard.includes('onClick={onEditOrganizerProfile}') && dashboard.includes('Edit Profile'),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ organizerFinalUX: 'failed', failed, checks }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ organizerFinalUX: 'passed', ...checks }));
