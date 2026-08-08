import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { API_BASE_URL } from '../config/env';

// Translation strings are stored and served from the backend (see
// GET /i18n/:locale/:namespace in backend/src/gateway/http-server.ts) rather
// than static frontend JSON files, so an editor can fix a translation by
// changing a DB row -- no frontend rebuild/redeploy required. Detected
// language defaults to the user's own browser language, falling back to
// English (see `detection`/`fallbackLng` below).
void i18next
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ru'],
    ns: ['nav'],
    defaultNS: 'nav',
    backend: {
      loadPath: `${API_BASE_URL}/i18n/{{lng}}/{{ns}}`,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18next;
