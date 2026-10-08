from pathlib import Path

p = Path('server/professionalRoleEvidence.ts')
text = p.read_text()

def one(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, found {count}: {old[:80]}')
    text = text.replace(old, new, 1)

one(
    '  { pattern: /\\bguest\\s+speaker\\b/i, label: "Guest Speaker" },\n  { pattern: /\\b(?:session|technical session)\\s+co[- ]?chair\\b/i, label: "Session Co-Chair" },\n',
    '  { pattern: /\\bguest\\s+speaker\\b/i, label: "Guest Speaker" },\n  { pattern: /\\b(?:session|technical session)\\s+co[- ]?chair\\b/i, label: "Session Co-Chair" },\n  { pattern: /\\bco[- ]?chair\\b/i, label: "Co-Chair" },\n',
)
one(
    '    `${exact}${org} "session chair" OR "track chair" OR "program chair" OR moderator OR panelist`,\n',
    '    `${exact}${org} "session chair" OR "co-chair" OR "track chair" OR "program chair" OR moderator OR panelist`,\n',
)
one(
    '    `${exact} site:seg.org speaker committee chair program`,\n',
    '    `${exact} site:seg.org speaker committee chair program`,\n    `${exact} site:agu.org speaker committee chair program`,\n    `${exact} site:onepetro.org speaker committee chair program`,\n',
)
one(
    '    const organizationMatched = organizationMatches(identity.organization, context)\n      || organizationMatches(identity.organization, pageText.slice(0, MAX_PAGE_TEXT));\n',
    '    const contextOrganizationMatched = organizationMatches(identity.organization, context);\n    const pageOrganizationMatched = organizationMatches(identity.organization, pageText.slice(0, MAX_PAGE_TEXT));\n    const organizationMatched = contextOrganizationMatched || pageOrganizationMatched;\n    const emailMatched = Boolean(identity.email && normalize(pageText).includes(normalize(identity.email)));\n',
)
one(
    '    if (organizationMatched && (authoritative || rolePage)) {\n      confidence = "verified";\n      confidenceScore = authoritative ? 96 : 93;\n      evidenceReason = authoritative\n        ? "Official/authoritative conference evidence places the member\'s exact name beside this role and matches the stored organization."\n        : "A role-specific conference page places the member\'s exact name beside this role and matches the stored organization.";\n    } else if (authoritative || rolePage) {\n',
    '    if (emailMatched && (authoritative || rolePage)) {\n      confidence = "verified";\n      confidenceScore = 98;\n      evidenceReason = "Official conference evidence places the member\'s name beside this role and also matches the stored professional email.";\n    } else if (contextOrganizationMatched && (authoritative || rolePage)) {\n      confidence = "verified";\n      confidenceScore = authoritative ? 96 : 93;\n      evidenceReason = authoritative\n        ? "Official/authoritative conference evidence places the member\'s exact name beside this role and the stored organization appears in the same local context."\n        : "A role-specific conference page places the member\'s exact name beside this role and the stored organization appears in the same local context.";\n    } else if (authoritative && pageOrganizationMatched) {\n      confidence = "verified";\n      confidenceScore = 94;\n      evidenceReason = "An authoritative conference source places the member\'s exact name beside this role and independently matches the stored organization on the same source page.";\n    } else if (authoritative || rolePage) {\n',
)
one(
    '        organizationMatched,\n        authoritative,\n',
    '        organizationMatched,\n        contextOrganizationMatched,\n        pageOrganizationMatched,\n        emailMatched,\n        authoritative,\n',
)

p.write_text(text)
print('Phase 47 role verification refinements applied')
