import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ImageUrlUploadEnhancer } from './components/ImageUrlUploadEnhancer';
import './index.css';

// Remove inbound referral/tracking parameters without disturbing app routing.
try {
  const url = new URL(window.location.href);
  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid', 'msclkid', 'ref'].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
} catch { /* URL cleanup should never block app startup */ }

// Optional GA4 integration. Tracking is disabled until the site owner supplies a
// measurement ID and consent has been granted. Never send account identifiers or PII.
const ga4MeasurementId = String(import.meta.env.VITE_GA4_MEASUREMENT_ID || '').trim();
const analyticsConsent = (() => {
  try { return window.localStorage.getItem('conferencegate_analytics_consent') === 'granted'; }
  catch { return false; }
})();
if (/^G-[A-Z0-9]+$/.test(ga4MeasurementId) && analyticsConsent) {
  const analyticsWindow = window as typeof window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.gtag = (...args: unknown[]) => { analyticsWindow.dataLayer!.push(args); };
  analyticsWindow.gtag('js', new Date());
  analyticsWindow.gtag('config', ga4MeasurementId, { send_page_view: true });
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga4MeasurementId);
  document.head.appendChild(script);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ImageUrlUploadEnhancer />
      <AppErrorBoundary><App /></AppErrorBoundary>
    </ToastProvider>
  </StrictMode>,
);
