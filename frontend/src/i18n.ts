import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import da from "./locales/da.json";
import en from "./locales/en.json";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "da", label: "Dansk" },
];

const STORAGE_KEY = "arrdeck.lang";

function initialLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    /* fall through to browser language */
  }
  return navigator.language?.toLowerCase().startsWith("da") ? "da" : "en";
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, da: { translation: da } },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(code: string) {
  i18n.changeLanguage(code);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(code));
  } catch {
    /* not persisted */
  }
}

export default i18n;
