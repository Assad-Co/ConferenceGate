import fs from 'node:fs';

const files = ['scripts/finalizeConferenceCoverage.mjs', 'scripts/sanitizeConferenceDetailData.mjs'];
const marker = 'A bare Open/Closed status is not enough to claim the CFP tab has useful content.';

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) continue;

  const blockRe = /  if \(key === 'cfp'\) \{[\s\S]*?\n  \}/;
  const replacement = `  if (key === 'cfp') {\n    if (!value || typeof value !== 'object') return false;\n    // A bare Open/Closed status is not enough to claim the CFP tab has useful content.\n    // Require at least one actionable/substantive submission field or a real topics list.\n    return [\n      value.abstract_submission_deadline, value.paper_submission_deadline, value.submission_deadline,\n      value.submission_url, value.notification_date, value.submission_guidelines,\n      value.abstract_requirements, value.paper_requirements, value.submission_format, value.length_limit,\n      value.review_process, value.publication_information,\n      ...(Array.isArray(value.topics_tracks) ? value.topics_tracks : []),\n    ].some(hasContent);\n  }`;

  if (blockRe.test(source)) {
    source = source.replace(blockRe, replacement);
    fs.writeFileSync(file, source);
  } else {
    console.warn(`[catalogue-cfp-quality] CFP block not found in ${file}; leaving unchanged`);
  }
}

console.log('[catalogue-cfp-quality] CFP completeness now requires substantive submission data');
