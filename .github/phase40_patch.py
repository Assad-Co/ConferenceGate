from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor missing in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique in {path}: {text.count(old)}")
    p.write_text(text.replace(old, new, 1))


# Hook the public-evidence research queue into every successful LinkedIn link/login/signup.
replace_once(
    'server/auth.ts',
    'import { isOwnerPreviewEmail } from "./ownerPreview";\n',
    'import { isOwnerPreviewEmail } from "./ownerPreview";\nimport { queueProfessionalEvidenceResearch } from "./professionalEvidenceResearchBootstrap";\n',
)

replace_once(
    'server/auth.ts',
    '      await persistAuthenticatedLinkedInPicture(linkingRow.id, picture);\n\n      const refreshed =',
    '      await persistAuthenticatedLinkedInPicture(linkingRow.id, picture);\n      void queueProfessionalEvidenceResearch(linkingRow.id, { trigger: "linkedin_oauth" })\n        .catch((err) => console.error("[professional-evidence] LinkedIn link queue failed", err));\n\n      const refreshed =',
)

replace_once(
    'server/auth.ts',
    '    if (row) {\n      await persistAuthenticatedLinkedInPicture(row.id, picture);\n      row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [row.id]);',
    '    if (row) {\n      await persistAuthenticatedLinkedInPicture(row.id, picture);\n      void queueProfessionalEvidenceResearch(row.id, { trigger: "linkedin_oauth" })\n        .catch((err) => console.error("[professional-evidence] LinkedIn sign-in queue failed", err));\n      row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [row.id]);',
)

replace_once(
    'server/auth.ts',
    '  res.clearCookie(LINKEDIN_PENDING_COOKIE, { path: "/" });\n  const token = signToken(row.id);',
    '  void queueProfessionalEvidenceResearch(row.id, { trigger: "linkedin_oauth" })\n    .catch((err) => console.error("[professional-evidence] LinkedIn signup queue failed", err));\n\n  res.clearCookie(LINKEDIN_PENDING_COOKIE, { path: "/" });\n  const token = signToken(row.id);',
)

# The evidence backend can use the ConferenceGate profile organization/title before a public
# LinkedIn profile scrape has ever run.
replace_once(
    'server/professionalEvidenceResearchBootstrap.ts',
    '`SELECT id,name,email,linkedin_id,linkedin_url FROM users WHERE id = ?`,',
    '`SELECT id,name,email,linkedin_id,linkedin_url,organization,title FROM users WHERE id = ?`,',
)
replace_once(
    'server/professionalEvidenceResearchBootstrap.ts',
    '    title: clean(linkedInProfile?.current_title) || null,\n    organization: clean(linkedInProfile?.current_organization) || null,',
    '    title: clean(linkedInProfile?.current_title) || clean(user.title) || null,\n    organization: clean(linkedInProfile?.current_organization) || clean(user.organization) || null,',
)

# Show the Evidence Graph inside the existing LinkedIn Professional profile.
replace_once(
    'src/components/LinkedInProfilePanel.tsx',
    "import React, { useEffect, useState } from 'react';\n",
    "import React, { useEffect, useState } from 'react';\nimport ProfessionalDeepResearchPanel from './ProfessionalDeepResearchPanel';\n",
)
replace_once(
    'src/components/LinkedInProfilePanel.tsx',
    '      {explicitClaims.length > 0 && (\n',
    '      <ProfessionalDeepResearchPanel />\n\n      {explicitClaims.length > 0 && (\n',
)
