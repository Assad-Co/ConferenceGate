import { SponsorProfile } from '../types';

/** Sponsors rated below this average are auto-blocked from registering. */
export const SPONSOR_RATING_THRESHOLD = 3.0;

// A sponsor with no reviews yet has no track record to restrict on, so they're provisionally
// verified until their first review lands.
export const isSponsorVerified = (profile: Pick<SponsorProfile, 'rating' | 'reviewsCount'>): boolean =>
  profile.reviewsCount === 0 || profile.rating >= SPONSOR_RATING_THRESHOLD;

export const sponsorVerificationReason = (profile: Pick<SponsorProfile, 'rating' | 'reviewsCount'>): string =>
  profile.reviewsCount === 0
    ? 'No organizer reviews yet — provisionally verified until a review is recorded.'
    : isSponsorVerified(profile)
    ? `Rating of ${profile.rating.toFixed(1)}/5 across ${profile.reviewsCount} reviews meets the ${SPONSOR_RATING_THRESHOLD.toFixed(1)}+ verification threshold.`
    : `Rating of ${profile.rating.toFixed(1)}/5 is below the ${SPONSOR_RATING_THRESHOLD.toFixed(1)} minimum required for marketplace registration.`;

/** Match % between a sponsor's declared industry and an opportunity/package's ideal sectors. */
export const sponsorOpportunityMatch = (
  sponsor: Pick<SponsorProfile, 'industry' | 'rating'>,
  idealSectors: string[]
): number => {
  const sponsorTag = sponsor.industry.toLowerCase();
  const overlap = idealSectors.filter(
    (sector) => sponsorTag.includes(sector.toLowerCase()) || sector.toLowerCase().includes(sponsorTag)
  ).length;
  const overlapRatio = idealSectors.length > 0 ? overlap / idealSectors.length : 0;
  // Blend sector overlap (primary signal) with the sponsor's real track record (rating) for a realistic score.
  const score = overlapRatio * 80 + (sponsor.rating / 5) * 20;
  return Math.max(35, Math.min(99, Math.round(score)));
};
