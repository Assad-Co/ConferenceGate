import fs from 'node:fs';

const file = 'src/App.tsx';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`[phase12-authenticity] ${label}: source anchor not found`);
  source = source.replace(before, after);
}

replaceOnce(
`  const handleAddSubmission = async (newSubData: Partial<AbstractSubmission>) => {\n    try {\n      const newSubmission = await createSubmission({\n        conferenceId: newSubData.conferenceId || 'conf_1',\n        conferenceTitle: newSubData.conferenceTitle || 'Conference Title',\n        title: newSubData.title || 'Untitled Abstract',\n        track: newSubData.track || 'General Track',\n        topic: newSubData.topic || 'General Topic',\n        keywords: newSubData.keywords || [],\n        abstractText: newSubData.abstractText || '',\n        preferredType: newSubData.preferredType || 'Oral',\n        primaryAuthor: newSubData.primaryAuthor || {\n          name: userProfile.name,\n          email: 'author@conferencegate.com',\n          affiliation: userProfile.organization,\n          bio: userProfile.bio,\n        },\n        coAuthors: newSubData.coAuthors || [],\n        conflictOfInterest: newSubData.conflictOfInterest || 'None declared.',\n      });`,
`  const handleAddSubmission = async (newSubData: Partial<AbstractSubmission>) => {\n    try {\n      const conferenceId = newSubData.conferenceId?.trim();\n      const conferenceTitle = newSubData.conferenceTitle?.trim();\n      const title = newSubData.title?.trim();\n      const abstractText = newSubData.abstractText?.trim();\n      if (!conferenceId || !conferenceTitle || !title || !abstractText) {\n        throw new Error('Choose a real conference and provide both an abstract title and abstract text before submitting.');\n      }\n      const primaryAuthor = {\n        name: newSubData.primaryAuthor?.name?.trim() || userProfile.name,\n        email: newSubData.primaryAuthor?.email?.trim() || authUser.email,\n        affiliation: newSubData.primaryAuthor?.affiliation?.trim() || userProfile.organization,\n        bio: newSubData.primaryAuthor?.bio?.trim() || userProfile.bio,\n      };\n      const newSubmission = await createSubmission({\n        conferenceId,\n        conferenceTitle,\n        title,\n        track: newSubData.track?.trim() || 'General Track',\n        topic: newSubData.topic?.trim() || 'General Topic',\n        keywords: newSubData.keywords || [],\n        abstractText,\n        preferredType: newSubData.preferredType || 'Oral',\n        primaryAuthor,\n        coAuthors: newSubData.coAuthors || [],\n        conflictOfInterest: newSubData.conflictOfInterest?.trim() || 'None declared.',\n      });`,
'abstract submission real-data guard'
);

replaceOnce(
`  const handleCreateConference = async (newConfData: Partial<Conference>): Promise<Conference> => {\n    const newConf: Conference = {\n      id: \`conf_\${Date.now()}\`,\n      title: newConfData.title || 'New Conference',\n      organizerName: newConfData.organizerName || 'Conference Organizing Board',\n      organizerLogo: newConfData.organizerLogo || '',\n      banner: newConfData.banner || '',\n      logo: newConfData.logo || '',\n      description: newConfData.description || '',\n      industry: newConfData.industry || 'General Science',\n      topics: newConfData.topics || [],\n      tracks: newConfData.tracks || ['Track 1'],\n      location: newConfData.location || { city: 'Paris', country: 'France', venue: 'Convention Center' },\n      dates: newConfData.dates || { start: '2026-10-15', end: '2026-10-18' },\n      format: newConfData.format || 'Hybrid',\n      priceRange: '$300 - $800',\n      registrationPackages: [],\n      earlyBirdDeadline: '2026-09-01',\n      abstractDeadline: '2026-08-01',\n      cfpStatus: 'Open',\n      attendeeCount: 0,\n      mainThemes: newConfData.mainThemes || ['Innovation'],\n      submissionGuidelines: newConfData.submissionGuidelines ?? null,\n      agendaDays: newConfData.agendaDays || [],\n      speakers: newConfData.speakers || [],\n      committee: newConfData.committee || [],\n      sponsors: [],\n      exhibitors: [],\n      accommodation: 'Partner Hotels',\n      travelInfo: 'City Airport Transit',\n      communityPosts: 0,\n    };`,
`  const handleCreateConference = async (newConfData: Partial<Conference>): Promise<Conference> => {\n    const title = newConfData.title?.trim();\n    const location = newConfData.location;\n    const dates = newConfData.dates;\n    if (!title || !location?.city?.trim() || !location?.country?.trim() || !location?.venue?.trim() || !dates?.start || !dates?.end || !newConfData.format) {\n      throw new Error('Conference title, city, country, venue, dates and format are required before publishing.');\n    }\n    if (dates.end < dates.start) {\n      throw new Error('Conference end date cannot be earlier than its start date.');\n    }\n    const newConf: Conference = {\n      id: \`conf_\${Date.now()}\`,\n      title,\n      organizerName: newConfData.organizerName?.trim() || organizerNameOverride || authUser.organization || authUser.name,\n      organizerLogo: newConfData.organizerLogo || '',\n      banner: newConfData.banner || '',\n      logo: newConfData.logo || '',\n      officialWebsite: newConfData.officialWebsite?.trim() || undefined,\n      description: newConfData.description?.trim() || '',\n      industry: newConfData.industry?.trim() || '',\n      topics: newConfData.topics || [],\n      tracks: newConfData.tracks || [],\n      location: { city: location.city.trim(), country: location.country.trim(), venue: location.venue.trim() },\n      dates,\n      format: newConfData.format,\n      priceRange: newConfData.priceRange?.trim() || 'Inquire now',\n      registrationPackages: newConfData.registrationPackages || [],\n      earlyBirdDeadline: newConfData.earlyBirdDeadline || '',\n      abstractDeadline: newConfData.abstractDeadline || '',\n      cfpStatus: newConfData.cfpStatus || 'Closed',\n      attendeeCount: 0,\n      mainThemes: newConfData.mainThemes || [],\n      submissionGuidelines: newConfData.submissionGuidelines ?? null,\n      agendaDays: newConfData.agendaDays || [],\n      speakers: newConfData.speakers || [],\n      committee: newConfData.committee || [],\n      sponsors: newConfData.sponsors || [],\n      exhibitors: newConfData.exhibitors || [],\n      accommodation: newConfData.accommodation?.trim() || '',\n      travelInfo: newConfData.travelInfo?.trim() || '',\n      communityPosts: 0,\n    };`,
'conference publishing real-data guard'
);

const professionalBlocks = [
  ['<AbstractTrackerView', 'onOpenNewSubmission'],
  ['<ReviewerPortal', 'onCompleteReview'],
  ['<CommunityFeed', 'userProfile'],
  ['<UserProfileView', 'onSelectConference'],
  ['<CertificatesView', 'onSelectConference'],
];
for (const [startToken, endToken] of professionalBlocks) {
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`[phase12-authenticity] ${startToken} render not found`);
  const end = source.indexOf(endToken, start);
  if (end < 0) throw new Error(`[phase12-authenticity] ${startToken} end anchor not found`);
  const block = source.slice(start, end);
  if (block.includes('conferences={conferences}')) {
    source = source.slice(0, start) + block.replace('conferences={conferences}', 'conferences={discoverConferences}') + source.slice(end);
  }
}

for (const token of ["'conf_1'", "'Conference Title'", "'author@conferencegate.com'", "city: 'Paris'", "'Partner Hotels'", "'City Airport Transit'", "'$300 - $800'"]) {
  if (source.includes(token)) throw new Error(`[phase12-authenticity] fabricated fallback remains: ${token}`);
}

fs.writeFileSync(file, source);
console.log('[phase12-authenticity] removed demo conference leakage and fabricated publishing/submission defaults');
