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


// Offer a clear choice before loading third-party analytics. Visitors can decline.
if (/^G-[A-Z0-9]+$/.test(ga4MeasurementId) && !analyticsConsent) {
  let priorChoice: string | null = null;
  try { priorChoice = window.localStorage.getItem('conferencegate_analytics_consent'); }
  catch { /* Browser storage may be disabled. */ }
  if (priorChoice === null) {
    const banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Analytics preferences');
    banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:99999;max-width:650px;margin:auto;padding:16px;background:#fff;color:#12284a;border:1px solid #d9e4f3;border-radius:12px;box-shadow:0 8px 28px #0002;font:14px system-ui,sans-serif';
    const message = document.createElement('p');
    message.textContent = 'May ConferenceGate use optional Google Analytics cookies to understand website visits and improve the experience?';
    message.style.cssText = 'margin:0 0 12px';
    const choices = document.createElement('div');
    choices.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
    for (const [label, choice] of [['Accept analytics', 'granted'], ['Decline', 'denied']] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'padding:9px 16px;border-radius:8px;border:1px solid #aac1df;cursor:pointer;background:' + (choice === 'granted' ? '#1759c7;color:white' : '#fff;color:#12284a');
      button.addEventListener('click', () => {
        try { window.localStorage.setItem('conferencegate_analytics_consent', choice); }
        catch { /* No tracking if consent cannot be stored. */ }
        banner.remove();
        if (choice === 'granted') window.location.reload();
      });
      choices.appendChild(button);
    }
    banner.append(message, choices);
    document.body.appendChild(banner);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ImageUrlUploadEnhancer />
      <AppErrorBoundary><App /></AppErrorBoundary>
    </ToastProvider>
  </StrictMode>,
);
