import { normalizeLinkedInProfilePayload, extractLinkedInProfileConferenceSignals } from "./linkedinImportNormalization";
const array = (value: unknown): any[] => {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
export async function mergeLinkedInProfileConferenceEvidence(userId: string, activity: any): Promise<any> {
  const { dbGet } = await import("./db");
  const row = await dbGet<any>("SELECT * FROM linkedin_profile_enrichment WHERE user_id = ?", [userId]).catch(() => undefined);
  if (!row?.linkedin_url) return activity;
  let raw: any = {};
  try { raw = JSON.parse(row.raw_profile || "{}"); } catch {}
  const profile = normalizeLinkedInProfilePayload(raw);
  for (const key of ["experience", "education", "publications", "patents", "certifications", "projects", "skills", "languages"]) {
    profile[key] = [...(profile[key] || []), ...array(row[key])];
  }
  profile.about = row.about || profile.about;
  const signals = extractLinkedInProfileConferenceSignals(profile, row.linkedin_url);
  if (!signals.length) return activity;
  const merged = new Map<string, any>();
  for (const signal of [...(activity?.conferenceActivity || []), ...signals]) merged.set(signal.id, signal);
  return {
    ...(activity || {}),
    linkedinUrl: activity?.linkedinUrl || row.linkedin_url,
    conferenceActivity: [...merged.values()],
    callsForPapers: activity?.callsForPapers || [],
    rawPosts: activity?.rawPosts || [],
    sourceActor: activity?.sourceActor || row.source_actor || "linkedin/profile",
    consentedAt: activity?.consentedAt || row.consented_at,
    fetchedAt: activity?.fetchedAt || row.fetched_at,
  };
}
