import { refreshLinkedInProfileEnrichment, type LinkedInProfileImportResult } from './linkedinProfile';
import { refreshLinkedInConferenceActivity, type LinkedInConferenceImportResult } from './linkedinConferenceActivity';

export interface LinkedInOnboardingResult {
  profile: LinkedInProfileImportResult | null;
  conference: LinkedInConferenceImportResult | null;
  warnings: string[];
}

/**
 * Builds a member's ConferenceGate profile from public LinkedIn data after explicit consent.
 * The professional-profile and conference-post imports are independent so one can succeed
 * even if the other provider call is temporarily unavailable.
 */
export async function syncLinkedInOnboarding(linkedinUrl: string): Promise<LinkedInOnboardingResult> {
  const [profileResult, conferenceResult] = await Promise.allSettled([
    refreshLinkedInProfileEnrichment(linkedinUrl),
    refreshLinkedInConferenceActivity(linkedinUrl),
  ]);

  const warnings: string[] = [];
  if (profileResult.status === 'rejected') warnings.push(profileResult.reason?.message || 'Professional profile import failed.');
  if (conferenceResult.status === 'rejected') warnings.push(conferenceResult.reason?.message || 'Conference activity import failed.');

  if (profileResult.status === 'rejected' && conferenceResult.status === 'rejected') {
    throw new Error(warnings[0] || 'LinkedIn import failed.');
  }

  return {
    profile: profileResult.status === 'fulfilled' ? profileResult.value : null,
    conference: conferenceResult.status === 'fulfilled' ? conferenceResult.value : null,
    warnings,
  };
}
