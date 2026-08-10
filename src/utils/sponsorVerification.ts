import { SponsorProfile } from '../types';

/** Sponsors rated below this average are auto-blocked from registering. */
export const SPONSOR_RATING_THRESHOLD = 3.0;

export const isSponsorVerified = (profile: Pick<SponsorProfile, 'rating'>): boolean =>
  profile.rating >= SPONSOR_RATING_THRESHOLD;

export const sponsorVerificationReason = (profile: Pick<SponsorProfile, 'rating' | 'reviewsCount'>): string =>
  isSponsorVerified(profile)
    ? `Rating of ${profile.rating.toFixed(1)}/5 across ${profile.reviewsCount} reviews meets the ${SPONSOR_RATING_THRESHOLD.toFixed(1)}+ verification threshold.`
    : `Rating of ${profile.rating.toFixed(1)}/5 is below the ${SPONSOR_RATING_THRESHOLD.toFixed(1)} minimum required for marketplace registration.`;

/** Match % between a sponsor's declared interests and an opportunity/package's ideal sectors. */
export const sponsorOpportunityMatch = (
  sponsor: Pick<SponsorProfile, 'preferredSectors' | 'industry' | 'roiScore'>,
  idealSectors: string[]
): number => {
  const sponsorTags = new Set(
    [...sponsor.preferredSectors, sponsor.industry].map((s) => s.toLowerCase())
  );
  const overlap = idealSectors.filter((sector) =>
    Array.from(sponsorTags).some((tag) => tag.includes(sector.toLowerCase()) || sector.toLowerCase().includes(tag))
  ).length;
  const overlapRatio = idealSectors.length > 0 ? overlap / idealSectors.length : 0;
  // Blend sector overlap (primary signal) with the sponsor's track record (ROI score) for a realistic score.
  const score = overlapRatio * 80 + (sponsor.roiScore / 100) * 20;
  return Math.max(35, Math.min(99, Math.round(score)));
};
