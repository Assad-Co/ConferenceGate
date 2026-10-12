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

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
