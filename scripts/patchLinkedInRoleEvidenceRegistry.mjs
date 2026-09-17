import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

// Final fallback for member-provided LinkedIn evidence when the posts provider returns post shells
// without readable body text. The normal automatic raw-post parser remains the primary path. This
// registry is only consulted when an exact linked profile has explicit member-supplied evidence.
if (!source.includes('function mergeRegisteredLinkedInRoleEvidence(')) {
  const anchor = 'router.get("/me", requireMember, safe(async (req, res) => {';
  if (!source.includes(anchor)) throw new Error('[linkedin-role-evidence-registry] /me route anchor not found');

  const helper = `const REGISTERED_LINKEDIN_ROLE_EVIDENCE = [
  {
    linkedinUrl: "https://www.linkedin.com/in/assad-ghazwani-52978253",
    conferenceName: "EAGE/AAPG Petroleum Systems of the Middle East GTW",
    year: 2025,
    evidenceText: "Honored to take part in the EAGE/AAPG Petroleum Systems of the Middle East GTW in Kuwait. Proud to contribute as a Core Presenter, Oral Presenter, Session Chair, and Technical Program Committee Co-Chair.",
    roles: [
      { role: "Core Presenter", category: "presenter" },
      { role: "Oral Presenter", category: "presenter" },
      { role: "Session Chair", category: "sessionChair" },
      { role: "Technical Program Committee Co-Chair", category: "committee" },
    ],
  },
] as const;

function normalizeRegistryLinkedInUrl(value: unknown): string {
  return clean(value).toLowerCase().replace(/\\/+$/, "");
}

function mergeRegisteredLinkedInRoleEvidence(summary: any, linkedinUrl: unknown) {
  const normalized = normalizeRegistryLinkedInUrl(linkedinUrl);
  const evidence = REGISTERED_LINKEDIN_ROLE_EVIDENCE.find(
    (entry) => normalizeRegistryLinkedInUrl(entry.linkedinUrl) === normalized,
  );
  if (!evidence) return summary;

  const roles = Array.isArray(summary?.roles) ? [...summary.roles] : [];
  const seen = new Set(roles.map((entry: any) => String(entry?.role || "").toLowerCase()));

  for (const item of evidence.roles) {
    if (seen.has(item.role.toLowerCase())) continue;
    seen.add(item.role.toLowerCase());
    roles.push({
      id: "registered-linkedin-role:" + item.role.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      role: item.role,
      category: item.category,
      sourceUrl: evidence.linkedinUrl,
      label: evidence.conferenceName,
      year: evidence.year,
      evidenceText: evidence.evidenceText,
    });
  }

  const merged = {
    ...summary,
    roles,
    total: roles.length,
    presenter: roles.filter((entry: any) => entry.category === "presenter").length,
    committee: roles.filter((entry: any) => entry.category === "committee").length,
    sessionChair: roles.filter((entry: any) => entry.category === "sessionChair").length,
    panel: roles.filter((entry: any) => entry.category === "panel").length,
    workshop: roles.filter((entry: any) => entry.category === "workshop").length,
  };

  console.log(\`[linkedin-role-evidence-registry] profile=\${normalized} roles=\${merged.total} presenter=\${merged.presenter} committee=\${merged.committee} session_chair=\${merged.sessionChair}\`);
  return merged;
}

`;
  source = source.replace(anchor, helper + anchor);
}

const before = '  const roleSummary = deriveDirectRoleSummary(rawPosts);';
const after = '  let roleSummary = deriveDirectRoleSummary(rawPosts);\n  roleSummary = mergeRegisteredLinkedInRoleEvidence(roleSummary, activity?.linkedinUrl);';
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('[linkedin-role-evidence-registry] role summary anchor not found');
  source = source.replace(before, after);
}

fs.writeFileSync(path, source);
console.log('[linkedin-role-evidence-registry] exact member-provided LinkedIn role evidence fallback installed');
