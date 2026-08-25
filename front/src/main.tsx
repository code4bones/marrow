import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './shared/i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// T-context (2026-08-26, owner's ask: mobile PWA layout, Task C): the
// service worker is what actually makes the browser offer an install
// affordance -- a manifest alone isn't enough. Registered after the
// initial render, not blocking it; a failed registration (unsupported
// browser, dev server without HTTPS, etc.) is swallowed since installability
// is a progressive enhancement, not a requirement to use the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* installability is optional */ });
  });
}
