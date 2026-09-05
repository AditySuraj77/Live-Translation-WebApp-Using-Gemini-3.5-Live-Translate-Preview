// Add new languages here — they appear automatically in the UI selectors.
// bcp47 must be a valid BCP-47 tag for gemini-3.5-live-translate-preview.

export interface Language {
  code: string;   // internal key / URL param value
  label: string;  // display label
  bcp47: string;  // sent to Gemini translationConfig.targetLanguageCode
}

export const LANGUAGES: Language[] = [
  // Top Global Major Languages
  { code: "en", label: "English", bcp47: "en" },
  { code: "hi", label: "Hindi (हिंदी)", bcp47: "hi" },
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
  { code: "nl", label: "Dutch (Nederlands)", bcp47: "nl" },
  { code: "pl", label: "Polish (Polski)", bcp47: "pl" },
  { code: "sv", label: "Swedish (Svenska)", bcp47: "sv" },
  { code: "vi", label: "Vietnamese (Tiếng Việt)", bcp47: "vi" },
  { code: "th", label: "Thai (ไทย)", bcp47: "th" },
  { code: "id", label: "Indonesian (Bahasa Indonesia)", bcp47: "id" },

  // Indian Regional Languages
  { code: "ta", label: "Tamil (தமிழ்)", bcp47: "ta" },
  { code: "te", label: "Telugu (తెలుగు)", bcp47: "te" },
  { code: "mr", label: "Marathi (मराठी)", bcp47: "mr" },
  { code: "gu", label: "Gujarati (ગુજરાતી)", bcp47: "gu" },
  { code: "ur", label: "Urdu (اردو)", bcp47: "ur" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)", bcp47: "pa" },
  { code: "kn", label: "Kannada (ಕನ್ನಡ)", bcp47: "kn" },
  { code: "ml", label: "Malayalam (മലയാളം)", bcp47: "ml" },
  { code: "or", label: "Odia (ଓଡ଼ିଆ)", bcp47: "or" },
  { code: "as", label: "Assamese (অসমীয়া)", bcp47: "as" },
  { code: "ne", label: "Nepali (नेपाली)", bcp47: "ne" },
  { code: "si", label: "Sinhala (සිංහල)", bcp47: "si" },

  // European Languages
  { code: "uk", label: "Ukrainian (Українська)", bcp47: "uk" },
  { code: "el", label: "Greek (Ελληνικά)", bcp47: "el" },
  { code: "cs", label: "Czech (Čeština)", bcp47: "cs" },
  { code: "ro", label: "Romanian (Română)", bcp47: "ro" },
  { code: "hu", label: "Hungarian (Magyar)", bcp47: "hu" },
  { code: "fi", label: "Finnish (Suomi)", bcp47: "fi" },
  { code: "da", label: "Danish (Dansk)", bcp47: "da" },
  { code: "no", label: "Norwegian (Norsk)", bcp47: "no" },
  { code: "sk", label: "Slovak (Slovenčina)", bcp47: "sk" },
  { code: "bg", label: "Bulgarian (Български)", bcp47: "bg" },
  { code: "hr", label: "Croatian (Hrvatski)", bcp47: "hr" },
  { code: "sr", label: "Serbian (Српски)", bcp47: "sr" },
  { code: "lt", label: "Lithuanian (Lietuvių)", bcp47: "lt" },
  { code: "lv", label: "Latvian (Latviešu)", bcp47: "lv" },
  { code: "sl", label: "Slovenian (Slovenščina)", bcp47: "sl" },
  { code: "et", label: "Estonian (Eesti)", bcp47: "et" },
  { code: "ca", label: "Catalan (Català)", bcp47: "ca" },
  { code: "eu", label: "Basque (Euskara)", bcp47: "eu" },
  { code: "gl", label: "Galician (Galego)", bcp47: "gl" },
  { code: "sq", label: "Albanian (Shqip)", bcp47: "sq" },
  { code: "bs", label: "Bosnian (Bosanski)", bcp47: "bs" },
  { code: "mk", label: "Macedonian (Македонски)", bcp47: "mk" },
  { code: "is", label: "Icelandic (Íslenska)", bcp47: "is" },
  { code: "ga", label: "Irish (Gaeilge)", bcp47: "ga" },
  { code: "cy", label: "Welsh (Cymraeg)", bcp47: "cy" },
  { code: "mt", label: "Maltese (Malti)", bcp47: "mt" },

  // Asian & Middle Eastern Languages
  { code: "fil", label: "Filipino (Tagalog)", bcp47: "fil" },
  { code: "ms", label: "Malay (Bahasa Melayu)", bcp47: "ms" },
  { code: "he", label: "Hebrew (עברית)", bcp47: "he" },
  { code: "fa", label: "Persian / Farsi (فارسی)", bcp47: "fa" },
  { code: "kk", label: "Kazakh (Қазақша)", bcp47: "kk" },
  { code: "uz", label: "Uzbek (Oʻzbekcha)", bcp47: "uz" },
  { code: "az", label: "Azerbaijani (Azərbaycan)", bcp47: "az" },
  { code: "ka", label: "Georgian (ქართული)", bcp47: "ka" },
  { code: "hy", label: "Armenian (Հայերեն)", bcp47: "hy" },
  { code: "km", label: "Khmer (ភាសាខ្មែរ)", bcp47: "km" },
  { code: "lo", label: "Lao (ລາວ)", bcp47: "lo" },
  { code: "my", label: "Burmese (မြန်မာစာ)", bcp47: "my" },
  { code: "mn", label: "Mongolian (Монгол)", bcp47: "mn" },

  // African Languages
  { code: "sw", label: "Swahili (Kiswahili)", bcp47: "sw" },
  { code: "af", label: "Afrikaans", bcp47: "af" },
  { code: "am", label: "Amharic (አማርኛ)", bcp47: "am" },
  { code: "zu", label: "Zulu (isiZulu)", bcp47: "zu" },
  { code: "yo", label: "Yoruba (Èdè Yorùbá)", bcp47: "yo" },
  { code: "ig", label: "Igbo (Asụsụ Igbo)", bcp47: "ig" },
  { code: "ha", label: "Hausa (Harshen Hausa)", bcp47: "ha" },
  { code: "so", label: "Somali (Soomaali)", bcp47: "so" },
];

export function findLanguage(code: string): Language {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) {
    // Fallback to English if unknown code provided
    return LANGUAGES.find((l) => l.code === "en") || LANGUAGES[0];
  }
  return lang;
}