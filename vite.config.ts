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
