import fs from 'node:fs';

const files = ['scripts/finalizeConferenceCoverage.mjs', 'scripts/sanitizeConferenceDetailData.mjs'];

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  const oldBlock = `    return [\n      value.status, value.abstract_submission_deadline, value.notification_date,\n      value.submission_guidelines, value.submission_format, value.length_limit,\n      value.review_process, value.publication_information,\n      ...(Array.isArray(value.topics_tracks) ? value.topics_tracks : []),\n    ].some(hasContent);`;
  const newBlock = `    // A bare Open/Closed status is not enough to claim the CFP tab has useful content.\n    // Require at least one actionable/substantive submission field or a real topics list.\n    return [\n      value.abstract_submission_deadline, value.paper_submission_deadline, value.submission_deadline,\n      value.submission_url, value.notification_date, value.submission_guidelines,\n      value.abstract_requirements, value.paper_requirements, value.submission_format, value.length_limit,\n      value.review_process, value.publication_information,\n      ...(Array.isArray(value.topics_tracks) ? value.topics_tracks : []),\n    ].some(hasContent);`;
  if (!source.includes(newBlock)) {
    if (!source.includes(oldBlock)) throw new Error(`[catalogue-cfp-quality] anchor missing in ${file}`);
    source = source.replace(oldBlock, newBlock);
    fs.writeFileSync(file, source);
  }
}

console.log('[catalogue-cfp-quality] CFP completeness now requires substantive submission data');
