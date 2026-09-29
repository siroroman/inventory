import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import cs from './cs.json';

// Czech only. Resources are bundled, so init is synchronous and `t` works right after import.
i18n.use(initReactI18next).init({
  lng: 'cs',
  fallbackLng: false,
  resources: { cs: { translation: cs } },
  initAsync: false,
  interpolation: { escapeValue: false },
});

export default i18n;
