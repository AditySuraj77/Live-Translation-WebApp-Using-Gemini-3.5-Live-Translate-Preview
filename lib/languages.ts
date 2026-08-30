// Add new languages here — they appear automatically in the UI selectors.
// bcp47 must be a valid BCP-47 tag for gemini-3.5-live-translate-preview.

export interface Language {
  code: string;   // internal key / URL param value
  label: string;  // display label
  bcp47: string;  // sent to Gemini translationConfig.targetLanguageCode
}

export const LANGUAGES: Language[] = [
  { code: "hi", label: "Hindi (हिंदी)", bcp47: "hi" },
  { code: "en", label: "English", bcp47: "en" },
  { code: "es", label: "Spanish (Español)", bcp47: "es" },
  { code: "fr", label: "French (Français)", bcp47: "fr" },
  { code: "de", label: "German (Deutsch)", bcp47: "de" },
  { code: "ja", label: "Japanese (日本語)", bcp47: "ja" },
  { code: "ar", label: "Arabic (العربية)", bcp47: "ar" },
  { code: "bn", label: "Bengali (বাংলা)", bcp47: "bn" },
  { code: "pt", label: "Portuguese (Português)", bcp47: "pt" },
  { code: "ru", label: "Russian (Русский)", bcp47: "ru" },
  { code: "zh", label: "Chinese Mandarin (中文)", bcp47: "zh" },
  { code: "ko", label: "Korean (한국어)", bcp47: "ko" },
  { code: "it", label: "Italian (Italiano)", bcp47: "it" },
  { code: "tr", label: "Turkish (Türkçe)", bcp47: "tr" },
  { code: "ta", label: "Tamil (தமிழ்)", bcp47: "ta" },
  { code: "te", label: "Telugu (తెలుగు)", bcp47: "te" },
  { code: "mr", label: "Marathi (मराठी)", bcp47: "mr" },
  { code: "gu", label: "Gujarati (ગુજરાતી)", bcp47: "gu" },
  { code: "ur", label: "Urdu (اردو)", bcp47: "ur" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)", bcp47: "pa" },
  { code: "kn", label: "Kannada (ಕನ್ನಡ)", bcp47: "kn" },
  { code: "ml", label: "Malayalam (മലയാളം)", bcp47: "ml" },
  { code: "vi", label: "Vietnamese (Tiếng Việt)", bcp47: "vi" },
  { code: "th", label: "Thai (ไทย)", bcp47: "th" },
  { code: "id", label: "Indonesian (Bahasa Indonesia)", bcp47: "id" },
  { code: "nl", label: "Dutch (Nederlands)", bcp47: "nl" },
  { code: "pl", label: "Polish (Polski)", bcp47: "pl" },
  { code: "sv", label: "Swedish (Svenska)", bcp47: "sv" },
];

export function findLanguage(code: string): Language {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) {
    // Fallback to English if unknown code provided
    return LANGUAGES.find((l) => l.code === "en") || LANGUAGES[0];
  }
  return lang;
}