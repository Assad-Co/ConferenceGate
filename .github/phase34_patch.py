from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:160]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique in {path}: {text.count(old)} matches for {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# --- backend mount + payload size for PDF/DOC/DOCX base64 (server enforces decoded 5MB) ---
replace_once('server.ts',
'import { workspacesRouter } from "./server/workspaces";\n',
'import { workspacesRouter } from "./server/workspaces";\nimport { professionalTrustRouter, initProfessionalTrustSchema } from "./server/professionalTrust";\n')
replace_once('server.ts',
'  await initGrowthAutomationSchema();\n',
'  await initGrowthAutomationSchema();\n  await initProfessionalTrustSchema();\n')
replace_once('server.ts', '  app.use(express.json({ limit: "3mb" }));', '  app.use(express.json({ limit: "8mb" }));')
replace_once('server.ts',
'  app.use("/api/workspaces", workspacesRouter);\n',
'  app.use("/api/workspaces", workspacesRouter);\n\n  // Phase 34: Professional trust, reviewer eligibility, pre-wizard recruitment and secure review files.\n  app.use("/api/professional-trust", professionalTrustRouter);\n')

# --- professional trust reusable evidence + draft acceptance count ---
replace_once('server/professionalTrust.ts', 'async function buildProfessionalTrust(userId: string) {', 'export async function buildProfessionalTrust(userId: string) {')
replace_once('server/professionalTrust.ts',
'    updatedAt: row.updated_at,\n  };',
'    updatedAt: row.updated_at,\n    acceptedCount: Number(row.accepted_count || 0),\n    pendingCount: Number(row.pending_count || 0),\n  };')
replace_once('server/professionalTrust.ts',
'  const rows = await dbAll<any>("SELECT * FROM conference_recruitment_drafts WHERE organizer_id=? AND status!=\'archived\' ORDER BY created_at DESC", [context.accountId]);',
'''  const rows = await dbAll<any>(`SELECT d.*,\n      (SELECT COUNT(*) FROM professional_invitations i WHERE i.conference_id=d.id AND i.status IN ('accepted','completed')) AS accepted_count,\n      (SELECT COUNT(*) FROM professional_invitations i WHERE i.conference_id=d.id AND i.status='pending') AS pending_count\n    FROM conference_recruitment_drafts d\n    WHERE d.organizer_id=? AND d.status!='archived'\n    ORDER BY d.created_at DESC`, [context.accountId]);''')

# --- reviewer eligibility enforced at assignment, volunteering, and deeper professional directory ---
replace_once('server/activity.ts',
'import { resolvePaidAccountContext, canOperateWorkspace } from "./workspaceAccess";\n',
'import { resolvePaidAccountContext, canOperateWorkspace } from "./workspaceAccess";\nimport { buildProfessionalTrust } from "./professionalTrust";\n')
replace_once('server/activity.ts',
'''    if (!reviewer) {\n      return res.status(404).json({ error: "Reviewer account not found" });\n    }\n\n    // Only the conference's own organizer may invite reviewers''',
'''    if (!reviewer) {\n      return res.status(404).json({ error: "Reviewer account not found" });\n    }\n    const reviewerTrust = await buildProfessionalTrust(reviewerId);\n    if (!reviewerTrust?.reviewerEligible) {\n      return res.status(409).json({\n        error: reviewerTrust?.eligibilityReason || "This Professional is not eligible for the reviewer pool."\n      });\n    }\n\n    // Only the conference's own organizer may invite reviewers''')
replace_once('server/activity.ts',
'''activityRouter.post("/reviews/volunteer", asyncHandler(async (req: AuthedRequest, res: Response) => {\n  const body = req.body || {};''',
'''activityRouter.post("/reviews/volunteer", asyncHandler(async (req: AuthedRequest, res: Response) => {\n  const trust = await buildProfessionalTrust(req.userId!);\n  if (!trust?.reviewerEligible) {\n    return res.status(403).json({ error: trust?.eligibilityReason || "Reviewer eligibility requirements are not met." });\n  }\n  const body = req.body || {};''')

old_search = '''      const expertise = parseStringArray(professional.professional_expertise);\n      const specialization = parseStringArray(professional.technical_specialization);\n      const interests = parseStringArray(professional.research_interests);\n      const regions = parseStringArray(professional.preferred_regions);\n      const profileTokens = tokenSet([\n        professional.name,\n        professional.title,\n        professional.organization,\n        professional.bio,\n        ...expertise,\n        ...specialization,\n        ...interests,\n        ...regions,\n      ]);\n\n      if (q && !String([\n        professional.name,professional.title,professional.organization,professional.country,\n        ...expertise,...specialization,...interests,\n      ].filter(Boolean).join(" ")).toLowerCase().includes(q.toLowerCase()) && queryTokens.size > 0) {\n        const overlap = [...queryTokens].some((token) => profileTokens.has(token));\n        if (!overlap) continue;\n      }\n\n      let overlap = 0;\n      for (const token of queryTokens) if (profileTokens.has(token)) overlap += 1;\n      const relevance = queryTokens.size ? overlap / queryTokens.size : 0.5;\n\n      const [reviewCountRow, roleCountRow] = await Promise.all([\n        dbGet<{ count: number }>(\n          "SELECT COUNT(*) as count FROM submission_reviews WHERE reviewer_id = ?",\n          [professional.id]\n        ),\n        dbGet<{ count: number }>(\n          "SELECT COUNT(*) as count FROM professional_invitations WHERE professional_id = ? AND status = 'completed'",\n          [professional.id]\n        ),\n      ]);\n      const reviewCount = reviewCountRow?.count || 0;\n      const completedRoleCount = roleCountRow?.count || 0;\n      const evidenceScore = Math.min(1, (reviewCount / 10) * 0.6 + (completedRoleCount / 5) * 0.4);\n      const profileCompleteness = [\n        professional.title, professional.organization, professional.bio, professional.country,\n        expertise.length, specialization.length, interests.length, regions.length\n      ].filter(Boolean).length / 8;\n      const score = Math.round(\n        Math.max(0, Math.min(1, relevance * 0.65 + evidenceScore * 0.2 + profileCompleteness * 0.15)) * 100\n      );\n\n      results.push({\n        id: professional.id,\n        name: professional.name,\n        title: professional.title || "",\n        organization: professional.organization || "",\n        country: professional.country || "",\n        avatar: professional.avatar || null,\n        expertise,\n        technicalSpecialization: specialization,\n        researchInterests: interests,\n        preferredRegions: regions,\n        identityVerified: Boolean(professional.linkedin_id || professional.google_id),\n        reviewerAvailable: Boolean(professional.reviewer_available),\n        committeeAvailable: Boolean(professional.committee_available),\n        sessionChairAvailable: Boolean(professional.session_chair_available),\n        speakerAvailable: Boolean(professional.speaker_available),\n        verifiedReviews: reviewCount,\n        verifiedCompletedRoles: completedRoleCount,\n        matchScore: score,\n      });'''
new_search = '''      const expertise = parseStringArray(professional.professional_expertise);\n      const specialization = parseStringArray(professional.technical_specialization);\n      const interests = parseStringArray(professional.research_interests);\n      const regions = parseStringArray(professional.preferred_regions);\n      const linkedin = await dbGet<any>(\n        "SELECT experience,publications,certifications FROM linkedin_profile_enrichment WHERE user_id=?",\n        [professional.id]\n      ).catch(() => undefined);\n      const parseEvidence = (value: unknown): any[] => {\n        if (Array.isArray(value)) return value;\n        if (typeof value !== "string") return [];\n        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }\n      };\n      const positionRows = parseEvidence(linkedin?.experience);\n      const publicationRows = parseEvidence(linkedin?.publications);\n      const certificationRows = parseEvidence(linkedin?.certifications);\n      const cutoffYear = new Date().getUTCFullYear() - 7;\n      const evidenceText = (item: any) => typeof item === "string" ? item : [item?.title,item?.position,item?.role,item?.companyName,item?.company,item?.organization,item?.name,item?.issuer,item?.authority,item?.dateRange,item?.startDate,item?.endDate].filter(Boolean).join(" · ");\n      const evidenceYear = (item: any) => {\n        const text = evidenceText(item);\n        const years = text.match(/\\b(?:19|20)\\d{2}\\b/g) || [];\n        return years.length ? Math.max(...years.map(Number)) : new Date().getUTCFullYear();\n      };\n      const recentPositions = positionRows.filter((item: any) => evidenceYear(item) >= cutoffYear).map(evidenceText).filter(Boolean).slice(0, 12);\n      const certifications = certificationRows.map(evidenceText).filter(Boolean).slice(0, 20);\n      const profileTokens = tokenSet([\n        professional.name, professional.title, professional.organization, professional.bio,\n        ...expertise, ...specialization, ...interests, ...regions, ...recentPositions, ...certifications,\n      ]);\n\n      if (q && !String([\n        professional.name,professional.title,professional.organization,professional.country,\n        ...expertise,...specialization,...interests,...recentPositions,...certifications,\n      ].filter(Boolean).join(" ")).toLowerCase().includes(q.toLowerCase()) && queryTokens.size > 0) {\n        const hasOverlap = [...queryTokens].some((token) => profileTokens.has(token));\n        if (!hasOverlap) continue;\n      }\n\n      let overlap = 0;\n      for (const token of queryTokens) if (profileTokens.has(token)) overlap += 1;\n      const relevance = queryTokens.size ? overlap / queryTokens.size : 0.5;\n\n      const [reviewCountRow, roleCountRow, trust] = await Promise.all([\n        dbGet<{ count: number }>("SELECT COUNT(*) as count FROM submission_reviews WHERE reviewer_id = ?", [professional.id]),\n        dbGet<{ count: number }>("SELECT COUNT(*) as count FROM professional_invitations WHERE professional_id = ? AND status = 'completed'", [professional.id]),\n        buildProfessionalTrust(professional.id),\n      ]);\n      const reviewCount = reviewCountRow?.count || 0;\n      const completedRoleCount = roleCountRow?.count || 0;\n      const evidenceScore = Math.min(1, (reviewCount / 10) * 0.5 + (completedRoleCount / 5) * 0.3 + Math.min(0.2, (trust?.conferenceGateIndex || 0) / 500));\n      const profileCompleteness = [professional.title, professional.organization, professional.bio, professional.country, expertise.length, specialization.length, interests.length, regions.length, recentPositions.length, certifications.length].filter(Boolean).length / 10;\n      const score = Math.round(Math.max(0, Math.min(1, relevance * 0.6 + evidenceScore * 0.25 + profileCompleteness * 0.15)) * 100);\n\n      results.push({\n        id: professional.id, name: professional.name, title: professional.title || "",\n        organization: professional.organization || "", country: professional.country || "", avatar: professional.avatar || null,\n        expertise, technicalSpecialization: specialization, researchInterests: interests, preferredRegions: regions,\n        identityVerified: Boolean(professional.linkedin_id || professional.google_id),\n        reviewerAvailable: Boolean(professional.reviewer_available), committeeAvailable: Boolean(professional.committee_available),\n        sessionChairAvailable: Boolean(professional.session_chair_available), speakerAvailable: Boolean(professional.speaker_available),\n        verifiedReviews: reviewCount, verifiedCompletedRoles: completedRoleCount, matchScore: score,\n        reviewerEligible: Boolean(trust?.reviewerEligible), reviewerEligibilityReason: trust?.eligibilityReason || "",\n        conferenceGateIndex: trust?.conferenceGateIndex || 0, experienceYears: trust?.evidence.experienceYears || 0,\n        publicationCount: publicationRows.length, recentPositions, certifications,\n      });'''
replace_once('server/activity.ts', old_search, new_search)

old_invite = '''    const organizer = organizerContext.actor;\n    const conference = await dbGet<CreatedConferenceRow>(\n      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",\n      [body.conferenceId, accountId]\n    );\n    if (!conference) {\n      return res.status(404).json({ error: "You can only invite professionals to conferences in this workspace." });\n    }\n    const professional = await dbGet<{ role: string; name: string }>(\n      "SELECT role,name FROM users WHERE id = ?",\n      [body.professionalId]\n    );'''
new_invite = '''    const organizer = organizerContext.actor;\n    const conference = await dbGet<CreatedConferenceRow>(\n      "SELECT * FROM created_conferences WHERE id = ? AND organizer_id = ?",\n      [body.conferenceId, accountId]\n    );\n    const recruitmentDraft = conference ? undefined : await dbGet<any>(\n      "SELECT * FROM conference_recruitment_drafts WHERE id=? AND organizer_id=? AND status IN ('recruiting','ready')",\n      [body.conferenceId, accountId]\n    ).catch(() => undefined);\n    if (!conference && !recruitmentDraft) {\n      return res.status(404).json({ error: "You can only invite Professionals to a published conference or pre-wizard recruitment draft in this workspace." });\n    }\n    const professional = await dbGet<{ role: string; name: string }>(\n      "SELECT role,name FROM users WHERE id = ?",\n      [body.professionalId]\n    );'''
replace_once('server/activity.ts', old_invite, new_invite)
replace_once('server/activity.ts',
'''    const conferenceData = JSON.parse(conference.data);\n    const existing = await dbGet<ProfessionalInvitationRow>(''',
'''    const conferenceData = conference ? JSON.parse(conference.data) : { title: recruitmentDraft.title };\n    const existing = await dbGet<ProfessionalInvitationRow>(''')

# Original submission attachment saved atomically after submission record creation.
replace_once('server/activity.ts',
'''      body.conflictOfInterest || null,\n    ]\n  );\n\n  const row = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [id]))!;''',
'''      body.conflictOfInterest || null,\n    ]\n  );\n\n  if (body.attachment && typeof body.attachment === "object") {\n    const fileName = String(body.attachment.fileName || "").trim().slice(0, 240);\n    const mimeType = String(body.attachment.mimeType || "").trim().toLowerCase();\n    const dataBase64 = String(body.attachment.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();\n    const allowedMime = new Set(["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);\n    const byteSize = Math.floor((dataBase64.length * 3) / 4);\n    if (fileName && dataBase64 && allowedMime.has(mimeType) && byteSize > 0 && byteSize <= 5 * 1024 * 1024) {\n      await dbRun("INSERT INTO submission_documents(id,submission_id,uploader_id,kind,file_name,mime_type,byte_size,data_base64) VALUES(?,?,?,?,?,?,?,?)", [`doc_${crypto.randomUUID()}`,id,req.userId!,"author_original",fileName,mimeType,byteSize,dataBase64]);\n    }\n  }\n\n  const row = (await dbGet<SubmissionRow>("SELECT * FROM submissions WHERE id = ?", [id]))!;''')

# --- client API types ---
replace_once('src/api/activity.ts',
'''  conflictOfInterest: string;\n}''',
'''  conflictOfInterest: string;\n  attachment?: { fileName: string; mimeType: string; dataBase64: string };\n}''')
replace_once('src/api/activity.ts',
'''  verifiedCompletedRoles: number;\n  matchScore: number;\n}''',
'''  verifiedCompletedRoles: number;\n  matchScore: number;\n  reviewerEligible?: boolean;\n  reviewerEligibilityReason?: string;\n  conferenceGateIndex?: number;\n  experienceYears?: number;\n  publicationCount?: number;\n  recentPositions?: string[];\n  certifications?: string[];\n}''')

# --- author attachment in abstract submission ---
replace_once('src/components/AbstractSubmissionModal.tsx',
'''  const [aiChecking, setAiChecking] = useState(false);\n  const [aiFeedback, setAiFeedback] = useState<any>(null);''',
'''  const [aiChecking, setAiChecking] = useState(false);\n  const [aiFeedback, setAiFeedback] = useState<any>(null);\n  const [abstractFile, setAbstractFile] = useState<File | null>(null);''')
replace_once('src/components/AbstractSubmissionModal.tsx',
'''  const handleSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!title.trim() || !abstractText.trim() || !selectedConf) return;\n\n    onSubmit({''',
'''  const handleSubmit = async (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!title.trim() || !abstractText.trim() || !selectedConf) return;\n    let attachment: any = undefined;\n    if (abstractFile) {\n      const dataUrl = await new Promise<string>((resolve, reject) => {\n        const reader = new FileReader();\n        reader.onerror = () => reject(new Error('Could not read abstract file.'));\n        reader.onload = () => resolve(String(reader.result || ''));\n        reader.readAsDataURL(abstractFile);\n      });\n      attachment = { fileName: abstractFile.name, mimeType: abstractFile.type, dataBase64: dataUrl.split(',').pop() || '' };\n    }\n\n    onSubmit({''')
replace_once('src/components/AbstractSubmissionModal.tsx',
'''      reviews: [],\n    });''',
'''      reviews: [],\n      attachment,\n    } as any);''')
replace_once('src/components/AbstractSubmissionModal.tsx',
'''          {/* Co-Authors List */}''',
'''          <div className="space-y-1.5">\n            <label className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">Abstract File for Review</label>\n            <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setAbstractFile(e.target.files?.[0] || null)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs" />\n            <p className="text-[10px] text-slate-500">Optional PDF/DOC/DOCX, max 5 MB. Assigned reviewers receive secure access; returned review files go back through the organizer.</p>\n          </div>\n\n          {/* Co-Authors List */}''')

# App passes attachment to the API.
replace_once('src/App.tsx',
'''        conflictOfInterest: newSubData.conflictOfInterest?.trim() || 'None declared.',\n      });''',
'''        conflictOfInterest: newSubData.conflictOfInterest?.trim() || 'None declared.',\n        attachment: (newSubData as any).attachment,\n      });''')

# --- Reviewer portal: eligibility, conference evaluation, file handoff ---
replace_once('src/components/ReviewerPortal.tsx',
'''import { ConferenceLink } from './ConferenceLink';\n''',
'''import { ConferenceLink } from './ConferenceLink';\nimport { ProfessionalConferenceEvaluation, ReviewerDocumentWorkflow, ReviewerEligibilityCard } from './ReviewerTrustWorkflow';\n''')
replace_once('src/components/ReviewerPortal.tsx',
'''  return (\n    <div className="space-y-8">\n      {/* Top Banner & Reviewer Availability Toggle */}''',
'''  return (\n    <div className="space-y-8">\n      <ReviewerEligibilityCard />\n      <ProfessionalConferenceEvaluation conferences={conferences} />\n      {/* Top Banner & Reviewer Availability Toggle */}''')
replace_once('src/components/ReviewerPortal.tsx',
'''          <div className="pb-4 border-b border-slate-100 space-y-2">\n            <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">''',
'''          <ReviewerDocumentWorkflow submission={selectedSub} />\n          <div className="pb-4 border-b border-slate-100 space-y-2">\n            <span className="text-[10px] font-bold uppercase text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md">''')

# --- Organizer dashboard: professional network before wizard, draft workflow at top ---
replace_once('src/components/OrganizerDashboard.tsx',
'''import { importOrganizerConferenceFromOfficialUrl''',
'''import { ProfessionalRecruitmentPanel } from './ProfessionalRecruitmentPanel';\nimport { importOrganizerConferenceFromOfficialUrl''')
replace_once('src/components/OrganizerDashboard.tsx',
'''          { id: 'overview', label: 'Dashboard Overview' },\n          { id: 'wizard', label: 'Conference Wizard' },\n          { id: 'abstracts', label: `Abstracts & AI Matcher (${myConferenceSubmissions.length})` },\n          { id: 'professionals', label: 'Professional Network' },''',
'''          { id: 'overview', label: 'Dashboard Overview' },\n          { id: 'professionals', label: 'Professional Network & Committee Recruitment' },\n          { id: 'wizard', label: 'Conference Wizard' },\n          { id: 'abstracts', label: `Abstracts & AI Matcher (${myConferenceSubmissions.length})` },''')
replace_once('src/components/OrganizerDashboard.tsx',
'''      {activeTab === 'professionals' && (\n        <div className="space-y-6">''',
'''      {activeTab === 'professionals' && (\n        <div className="space-y-6">\n          <ProfessionalRecruitmentPanel\n            conferences={conferences}\n            onContinueToWizard={(draft) => {\n              setNewConfTitle(draft.title || '');\n              setNewConfDescription(draft.description || '');\n              setNewConfStartDate(draft.startDate || '');\n              setNewConfEndDate(draft.endDate || '');\n              setNewConfLocation([draft.city, draft.country].filter(Boolean).join(', '));\n              setNewConfMainThemes((draft.topics || []).join(', '));\n              setNewConfOfficialWebsite(draft.officialUrl || '');\n              setActiveTab('wizard');\n            }}\n          />''')
replace_once('src/components/OrganizerDashboard.tsx',
'''              <h2 className="text-xl font-bold text-slate-900">Professional Network</h2>''',
'''              <h2 className="text-xl font-bold text-slate-900">Published Conference Professional Search</h2>''')

# --- Profile: ConferenceGate Index + approve/remove dropdown for confirmed publications ---
replace_once('src/components/UserProfileView.tsx',
'''import { LinkedInImportedTabSections } from './LinkedInImportedTabSections';\n''',
'''import { LinkedInImportedTabSections } from './LinkedInImportedTabSections';\nimport { ConferenceGateIndexCard } from './ConferenceGateIndexCard';\n''')
replace_once('src/components/UserProfileView.tsx',
'''            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">''',
'''            <ConferenceGateIndexCard />\n\n            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">''')
replace_once('src/components/UserProfileView.tsx',
'''                      <button\n                        onClick={() => handleDecideExternalPaper(paper, 'dismissed')}\n                        disabled={decidingDoi === paper.doi}\n                        className="px-2.5 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"\n                      >\n                        Remove confirmation\n                      </button>''',
'''                      <select\n                        defaultValue="approved"\n                        disabled={decidingDoi === paper.doi}\n                        onChange={(e) => { if (e.target.value === 'remove') handleDecideExternalPaper(paper, 'dismissed'); }}\n                        className="px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"\n                        aria-label={`Publication status for ${paper.title}`}\n                      >\n                        <option value="approved">Approved</option>\n                        <option value="remove">Remove</option>\n                      </select>''')

# --- Certificates: white cards + evaluation-based ConferenceGate Professional Credential ---
replace_once('src/components/CertificatesView.tsx',
'''import React, { useMemo, useState } from 'react';''',
'''import React, { useEffect, useMemo, useState } from 'react';''')
replace_once('src/components/CertificatesView.tsx',
'''import { ConferenceLink } from './ConferenceLink';\n''',
'''import { ConferenceLink } from './ConferenceLink';\nimport { fetchMyProfessionalTrust, type ProfessionalTrustSummary } from '../api/professionalTrust';\n''')
replace_once('src/components/CertificatesView.tsx',
'''  const [downloadingId, setDownloadingId] = useState<string | null>(null);\n\n  const certificates = useMemo<Certificate[]>(() => {''',
'''  const [downloadingId, setDownloadingId] = useState<string | null>(null);\n  const [professionalTrust, setProfessionalTrust] = useState<ProfessionalTrustSummary | null>(null);\n  useEffect(() => { fetchMyProfessionalTrust().then(setProfessionalTrust).catch(() => setProfessionalTrust(null)); }, [currentUserId]);\n\n  const certificates = useMemo<Certificate[]>(() => {''')
replace_once('src/components/CertificatesView.tsx',
'''    return certs;\n  }, [submissions, registrations, professionalInvitations, currentUserId, currentUserEmail]);''',
'''    if (professionalTrust && professionalTrust.evidence.organizerEvaluations > 0 && professionalTrust.evidence.evaluationAverage >= 3.5) {\n      certs.unshift({\n        id: `professional_credential_${currentUserId || 'me'}`,\n        title: `ConferenceGate ${professionalTrust.credentialLevel[0].toUpperCase() + professionalTrust.credentialLevel.slice(1)} Professional Credential`,\n        event: 'ConferenceGate Professional Network',\n        conferenceId: '',\n        paperTitle: `ConferenceGate Index ${professionalTrust.conferenceGateIndex}/100 · organizer evaluation ${professionalTrust.evidence.evaluationAverage.toFixed(2)}/5`,\n        date: new Date().toISOString().split('T')[0],\n        issuer: 'ConferenceGate verified professional evaluation system',\n        verificationHash: certHash(`professional_${currentUserId}_${professionalTrust.conferenceGateIndex}_${professionalTrust.evidence.organizerEvaluations}`),\n      });\n    }\n    return certs;\n  }, [submissions, registrations, professionalInvitations, currentUserId, currentUserEmail, professionalTrust]);''')
replace_once('src/components/CertificatesView.tsx',
'''<div key={cert.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 flex flex-col justify-between">''',
'''<div key={cert.id} className="p-6 bg-white rounded-2xl border border-slate-200 space-y-4 flex flex-col justify-between shadow-xs">''')
replace_once('src/components/CertificatesView.tsx',
'''            completed peer reviews, completed organizer roles, and conference registrations.''',
'''            completed peer reviews, completed organizer roles, conference registrations, and evaluation-based Professional credentials.''')

# --- Footer naming ---
replace_once('src/components/Footer.tsx', 'For Researchers & Reviewers', 'For Professionals & Reviewers')
replace_once('src/components/Footer.tsx', 'Verified Digital Certificates', 'ConferenceGate Index & Digital Credentials')
replace_once('src/components/Footer.tsx', 'Verified Conference Activity Records', 'ConferenceGate Index · Verified Professional Records')

# --- Organizer official-page import: a reachable but sparse schedule page becomes an honest partial draft rather than generic failure. ---
old_unreadable = '''    if (!best || importExtractionScore(best.raw) === 0) {\n      return res.status(422).json({\n        code: "IMPORT_PAGE_UNREADABLE",\n        error:\n          "ConferenceGate could not extract conference details from this page. " +\n          "The page may be blocking automated readers or may require a login. You can still enter the details manually.",\n        attempts,\n      });\n    }'''
new_unreadable = '''    if (!best) {\n      return res.status(422).json({\n        code: "IMPORT_PAGE_UNREADABLE",\n        error: "ConferenceGate could not read this page through direct, rendered, or readable-page routes. You can still enter the details manually.",\n        attempts,\n      });\n    }\n    if (importExtractionScore(best.raw) === 0) {\n      return res.json({\n        draft: { sourceUrl: best.sourceUrl || url.href, title: null, description: null, startDate: null, endDate: null, location: null, topics: [], bannerUrl: null, format: null, priceRange: null, organizer: null, confidence: 0, extractedFields: [] },\n        method: best.route, attempts,\n        note: "The official page was reachable but did not expose structured conference facts. ConferenceGate kept the source URL and opened an empty reviewable draft instead of failing; enter the missing fields manually or try a conference-specific page."\n      });\n    }'''
replace_once('server/workspaces.ts', old_unreadable, new_unreadable)
