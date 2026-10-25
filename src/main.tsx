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

// Optional Google Analytics is disabled. No third-party analytics script or consent banner is loaded.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ImageUrlUploadEnhancer />
      <AppErrorBoundary><App /></AppErrorBoundary>
    </ToastProvider>
  </StrictMode>,
);
