import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
// Repair the rich launch catalogue before Vite/server bundling so production never has to
// silently downgrade to the thinner CSV fallback because of a malformed JSON boundary.
// @ts-ignore -- side-effect-only maintenance script; scripts are excluded from app TS checks.
import './scripts/repairLaunchDatasetJson.mjs';
// Production-data and Organizer UI compatibility patches run before Vite scans application modules.
// @ts-ignore -- side-effect-only local maintenance script; scripts are excluded from app TS checks.
import './scripts/patchRealProductionData.mjs';
// @ts-ignore -- side-effect-only local maintenance script; scripts are excluded from app TS checks.
import './scripts/patchGlobalDiscoveryExpansion.mjs';
// @ts-ignore -- side-effect-only local maintenance script; scripts are excluded from app TS checks.
import './scripts/patchImageUploadUX.mjs';
// @ts-ignore -- side-effect-only local maintenance script; scripts are excluded from app TS checks.
import './scripts/patchSponsorEvaluationCTA.mjs';
// @ts-ignore -- side-effect-only signup UX patch; scripts are excluded from app TS checks.
import './scripts/patchProfessionalSignupOnboarding.mjs';
// @ts-ignore -- side-effect-only Professional navigation patch; scripts are excluded from app TS checks.
import './scripts/patchProfessionalNavigation.mjs';
// @ts-ignore -- side-effect-only Professional experience polish patch; scripts are excluded from app TS checks.
import './scripts/patchProfessionalExperiencePolish.mjs';
// @ts-ignore -- side-effect-only save-only conference UX patch; scripts are excluded from app TS checks.
import './scripts/patchMyConferencesSaveOnly.mjs';
// @ts-ignore -- side-effect-only LinkedIn deep Professional patch; scripts are excluded from app TS checks.
import './scripts/patchLinkedInDeepProfessional.mjs';
// @ts-ignore -- side-effect-only Professional action clarity patch; scripts are excluded from app TS checks.
import './scripts/patchProfessionalControlsClarity.mjs';
// @ts-ignore -- side-effect-only Professional profile simplification patch; scripts are excluded from app TS checks.
import './scripts/patchProfessionalProfileSimplify.mjs';
// @ts-ignore -- side-effect-only Professional profile/communication reliability patch.
import './scripts/patchProfessionalCommunicationReliability.mjs';
// @ts-ignore -- side-effect-only final Professional navigation/profile polish.
import './scripts/patchProfessionalFinalPolish.mjs';
// @ts-ignore -- side-effect-only LinkedIn full career-history preservation patch.
import './scripts/patchLinkedInFullCareerHistory.mjs';
// @ts-ignore -- side-effect-only complete LinkedIn evidence/profile merge patch.
import './scripts/patchLinkedInCompleteProfileMerge.mjs';
// @ts-ignore -- side-effect-only papers/abstracts completeness patch.
import './scripts/patchPapersAbstractsCompleteness.mjs';
// @ts-ignore -- side-effect-only final Professional acceptance cleanup.
import './scripts/patchProfessionalFinalAcceptance.mjs';
// @ts-ignore -- side-effect-only heavy conference/public-evidence enrichment patch.
import './scripts/patchHeavyProfessionalConferenceEvidence.mjs';
// @ts-ignore -- side-effect-only post-merge readStored compatibility patch.
import './scripts/patchHeavyProfessionalConferenceReadStored.mjs';
// @ts-ignore -- side-effect-only verified Professional role counter patch.
import './scripts/patchProfessionalRoleEvidenceCounts.mjs';
// @ts-ignore -- side-effect-only final Professional declutter patch.
import './scripts/patchProfessionalFinalDeclutter.mjs';
// @ts-ignore -- side-effect-only final Organizer UX and committee communication patch.
import './scripts/patchOrganizerFinalUX.mjs';
// @ts-ignore -- side-effect-only Organizer group messaging and branded PDF delivery patch.
import './scripts/patchOrganizerMessagingDelivery.mjs';
// @ts-ignore -- side-effect-only Organizer broadcast group delivery patch.
import './scripts/patchOrganizerBroadcastDelivery.mjs';
// @ts-ignore -- side-effect-only Organizer/Sponsor Edit Profile owner-preview fix.
import './scripts/patchOrganizerEditProfilePreview.mjs';
// @ts-ignore -- side-effect-only final click-through routing/search/persistence UX patch.
import './scripts/patchFinalUxAuditPass2.mjs';
// @ts-ignore -- side-effect-only Sponsor Profile metric correction.
import './scripts/patchSponsorCompletedSponsorships.mjs';
// @ts-ignore -- side-effect-only final mobile/responsive visual polish.
import './scripts/patchFinalMobileVisualPolish.mjs';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});