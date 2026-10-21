import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ImageUrlUploadEnhancer } from './components/ImageUrlUploadEnhancer';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ImageUrlUploadEnhancer />
      <AppErrorBoundary><App /></AppErrorBoundary>
    </ToastProvider>
  </StrictMode>,
);
