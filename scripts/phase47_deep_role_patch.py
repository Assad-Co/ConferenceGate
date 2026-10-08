from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one exact match, found {count}")
    p.write_text(text.replace(old, new, 1))


# Backend: wire the dedicated deep role researcher into the evidence graph.
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    'import { isSerperConfigured, serperSearch } from "./serperSearch";\n',
    'import { isSerperConfigured, serperSearch } from "./serperSearch";\nimport { deepProfessionalRoleEvidence } from "./professionalRoleEvidence";\n',
)
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    'const RESEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;\n',
    'const RESEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;\nconst RESEARCH_VERSION = 47;\n',
)
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    '    const key = [item.kind, canonicalTitle(item.title), item.year || ""].join("|");\n',
    '    const key = item.kind === "conference_role"\n      ? [item.kind, canonicalTitle(item.conferenceTitle || item.title), normalize(item.role || ""), item.year || ""].join("|")\n      : [item.kind, canonicalTitle(item.title), item.year || ""].join("|");\n',
)
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    '    const independent = new Set(group.map((item) => item.sourceType).filter((type) => type !== "linkedin_public"));\n',
    '    const independent = new Set(\n      group\n        .map((item) => clean(item.payload?.host) || item.sourceType)\n        .filter((origin) => origin !== "linkedin_public"),\n    );\n',
)
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    '    const [scholarly, web, linkedIn] = await Promise.all([\n      scholarlyEvidence(identity),\n      webEvidence(identity),\n      linkedInClaimEvidence(identity),\n    ]);\n    const evidence = promoteCorroborated([...scholarly, ...web, ...linkedIn]);\n',
    '    const [scholarly, web, deepRoles, linkedIn] = await Promise.all([\n      scholarlyEvidence(identity),\n      webEvidence(identity),\n      deepProfessionalRoleEvidence(identity),\n      linkedInClaimEvidence(identity),\n    ]);\n    const evidence = promoteCorroborated([...scholarly, ...web, ...deepRoles, ...linkedIn]);\n',
)
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    '    const counts = evidence.reduce((acc: Record<string, number>, item) => {\n      acc[item.confidence] = (acc[item.confidence] || 0) + 1;\n      acc[item.kind] = (acc[item.kind] || 0) + 1;\n      return acc;\n    }, {});\n',
    '    const counts = evidence.reduce((acc: Record<string, number>, item) => {\n      acc[item.confidence] = (acc[item.confidence] || 0) + 1;\n      acc[item.kind] = (acc[item.kind] || 0) + 1;\n      return acc;\n    }, {});\n    counts.researchVersion = RESEARCH_VERSION;\n',
)
replace_once(
    "server/professionalEvidenceResearchBootstrap.ts",
    'router.get("/me", requireMember, safe(async (req, res) => {\n  res.json(await snapshot(req.professionalEvidenceUserId!));\n}));\n',
    'router.get("/me", requireMember, safe(async (req, res) => {\n  const userId = req.professionalEvidenceUserId!;\n  let current = await snapshot(userId);\n  if (current.status !== "running" && current.lastRun?.counts?.researchVersion !== RESEARCH_VERSION) {\n    await queueProfessionalEvidenceResearch(userId, { trigger: "manual_refresh", force: true });\n    current = { ...current, status: "queued" };\n  }\n  res.json(current);\n}));\n',
)

# Frontend: top Professional Roles count now includes verified evidence-graph roles and polls while
# the new deep research pass is queued/running.
replace_once(
    "src/components/UserProfileView.tsx",
    "import type { ProfessionalPreferencesPayload } from '../api/auth';\n",
    "import type { ProfessionalPreferencesPayload } from '../api/auth';\nimport { fetchProfessionalEvidence, type ProfessionalEvidenceSnapshot } from '../api/professionalEvidence';\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);\n  const [feedbackConference, setFeedbackConference] = useState<AttendedConference | null>(null);\n",
    "  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);\n  const [feedbackConference, setFeedbackConference] = useState<AttendedConference | null>(null);\n  const [professionalEvidenceSnapshot, setProfessionalEvidenceSnapshot] = useState<ProfessionalEvidenceSnapshot | null>(null);\n\n  useEffect(() => {\n    if (variant !== 'professional') {\n      setProfessionalEvidenceSnapshot(null);\n      return;\n    }\n    let cancelled = false;\n    let timer: number | null = null;\n    const load = async () => {\n      try {\n        const next = await fetchProfessionalEvidence();\n        if (cancelled) return;\n        setProfessionalEvidenceSnapshot(next);\n        if (['queued', 'running'].includes(next.status)) {\n          timer = window.setTimeout(() => { void load(); }, 5000);\n        }\n      } catch {\n        if (!cancelled) setProfessionalEvidenceSnapshot(null);\n      }\n    };\n    void load();\n    return () => {\n      cancelled = true;\n      if (timer !== null) window.clearTimeout(timer);\n    };\n  }, [currentUserId, variant]);\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    "  const verifiedSpeakerCount = keynoteSpeakerMatches.filter((match) => match.verified).length;\n  const verifiedProfessionalRoleCount = verifiedRoleCount + verifiedSpeakerCount;\n",
    "  const canonicalProfessionalRole = (conference: string, role: string) =>\n    `${paperIdentityKey(conference || 'conference')}|${paperIdentityKey(role || 'role')}`;\n  const verifiedProfessionalRoleKeys = new Set<string>();\n  completedProfessionalRoles.forEach((item) => {\n    verifiedProfessionalRoleKeys.add(canonicalProfessionalRole(item.conferenceTitle, item.roleType));\n  });\n  keynoteSpeakerMatches\n    .filter((match) => match.verified)\n    .forEach((match) => {\n      verifiedProfessionalRoleKeys.add(canonicalProfessionalRole(match.conferenceTitle, match.role || 'speaker'));\n    });\n  (professionalEvidenceSnapshot?.items || [])\n    .filter((item) => item.kind === 'conference_role' && item.confidence === 'verified')\n    .forEach((item) => {\n      verifiedProfessionalRoleKeys.add(\n        canonicalProfessionalRole(item.conferenceTitle || item.title, item.role || item.title)\n      );\n    });\n  const verifiedProfessionalRoleCount = verifiedProfessionalRoleKeys.size;\n",
)
replace_once(
    "src/components/UserProfileView.tsx",
    '              <div className="mt-1 text-[9px] text-slate-400">organizer-confirmed or verified speaker evidence</div>\n',
    '              <div className="mt-1 text-[9px] text-slate-400">organizer-confirmed or independently verified public evidence</div>\n',
)

# Make the deep research panel explain exactly where role evidence is now searched.
replace_once(
    "src/components/ProfessionalDeepResearchPanel.tsx",
    '            LinkedIn anchors identity. ConferenceGate cross-checks Crossref, OpenAlex, Semantic Scholar, DBLP, official conference/society pages and other public professional sources. Independent-source agreement strengthens a record; same-name matches remain candidates until the evidence is strong enough.\n',
    '            LinkedIn anchors identity. ConferenceGate cross-checks Crossref, OpenAlex, Semantic Scholar, DBLP, official conference and society sites, speaker pages, technical/program/scientific committee rosters, session schedules, workshop agendas, and conference-program PDFs. Independent-source agreement strengthens a record; same-name matches remain candidates until the evidence is strong enough.\n',
)
replace_once(
    "src/components/ProfessionalDeepResearchPanel.tsx",
    '      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">\n',
    '      {summary && (\n        <div className="mt-4 rounded-xl border border-indigo-100 bg-white px-4 py-3 text-xs text-slate-600">\n          <span className="font-extrabold text-indigo-800">Professional role evidence: {summary.conferenceRoles}</span>\n          <span className="ml-2">speaker, chair, committee, moderator, panel and workshop roles found across public sources.</span>\n        </div>\n      )}\n\n      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">\n',
)

print("Phase 47 deep professional role integration applied")
