import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ToastProvider } from './components/Toast';
import { ImageUrlUploadEnhancer } from './components/ImageUrlUploadEnhancer';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ImageUrlUploadEnhancer />
      <App />
    </ToastProvider>
  </StrictMode>,
);
