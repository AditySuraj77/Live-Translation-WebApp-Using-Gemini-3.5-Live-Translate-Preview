import { LANGUAGES, findLanguage, type Language } from "./languages";

export interface SeoPair {
  slug: string;
  fromCode: string;
  toCode: string;
  fromLang: Language;
  toLang: Language;
  title: string;
  metaDescription: string;
  h1: string;
  keywords: string[];
}

export const TOP_PAIRS_CONFIG: Array<{ from: string; to: string; slug: string }> = [
  // English global pairs
  { from: "en", to: "es", slug: "english-to-spanish" },
  { from: "es", to: "en", slug: "spanish-to-english" },
  { from: "en", to: "hi", slug: "english-to-hindi" },
  { from: "hi", to: "en", slug: "hindi-to-english" },
  { from: "en", to: "fr", slug: "english-to-french" },
  { from: "fr", to: "en", slug: "french-to-english" },
  { from: "en", to: "de", slug: "english-to-german" },
  { from: "de", to: "en", slug: "german-to-english" },
  { from: "en", to: "ja", slug: "english-to-japanese" },
  { from: "ja", to: "en", slug: "japanese-to-english" },
  { from: "en", to: "ar", slug: "english-to-arabic" },
  { from: "ar", to: "en", slug: "arabic-to-english" },
  { from: "en", to: "pt", slug: "english-to-portuguese" },
  { from: "pt", to: "en", slug: "portuguese-to-english" },
  { from: "en", to: "ru", slug: "english-to-russian" },
  { from: "ru", to: "en", slug: "russian-to-english" },
  { from: "en", to: "zh", slug: "english-to-chinese" },
  { from: "zh", to: "en", slug: "chinese-to-english" },
  { from: "en", to: "ko", slug: "english-to-korean" },
  { from: "ko", to: "en", slug: "korean-to-english" },
  { from: "en", to: "it", slug: "english-to-italian" },
  { from: "it", to: "en", slug: "italian-to-english" },
  { from: "en", to: "tr", slug: "english-to-turkish" },
  { from: "tr", to: "en", slug: "turkish-to-english" },
  { from: "en", to: "nl", slug: "english-to-dutch" },
  { from: "nl", to: "en", slug: "dutch-to-english" },
  { from: "en", to: "vi", slug: "english-to-vietnamese" },
  { from: "vi", to: "en", slug: "vietnamese-to-english" },
  { from: "en", to: "id", slug: "english-to-indonesian" },
  { from: "id", to: "en", slug: "indonesian-to-english" },

  // Indian regional pairs
  { from: "hi", to: "bn", slug: "hindi-to-bengali" },
  { from: "bn", to: "hi", slug: "bengali-to-hindi" },
  { from: "hi", to: "ta", slug: "hindi-to-tamil" },
  { from: "ta", to: "hi", slug: "tamil-to-hindi" },
  { from: "hi", to: "te", slug: "hindi-to-telugu" },
  { from: "te", to: "hi", slug: "telugu-to-hindi" },
  { from: "hi", to: "mr", slug: "hindi-to-marathi" },
  { from: "mr", to: "hi", slug: "marathi-to-hindi" },
  { from: "hi", to: "gu", slug: "hindi-to-gujarati" },
  { from: "gu", to: "hi", slug: "gujarati-to-hindi" },
  { from: "hi", to: "pa", slug: "hindi-to-punjabi" },
  { from: "pa", to: "hi", slug: "punjabi-to-hindi" },

  // European & Asian cross pairs
  { from: "es", to: "fr", slug: "spanish-to-french" },
  { from: "fr", to: "es", slug: "french-to-spanish" },
  { from: "es", to: "pt", slug: "spanish-to-portuguese" },
  { from: "pt", to: "es", slug: "portuguese-to-spanish" },
  { from: "fr", to: "de", slug: "french-to-german" },
  { from: "de", to: "fr", slug: "german-to-french" },
  { from: "ar", to: "fr", slug: "arabic-to-french" },
  { from: "fr", to: "ar", slug: "french-to-arabic" },

  // New Global High-Traffic Pairs
  { from: "en", to: "fil", slug: "english-to-filipino" },
  { from: "fil", to: "en", slug: "filipino-to-english" },
  { from: "en", to: "uk", slug: "english-to-ukrainian" },
  { from: "uk", to: "en", slug: "ukrainian-to-english" },
  { from: "en", to: "el", slug: "english-to-greek" },
  { from: "el", to: "en", slug: "greek-to-english" },
  { from: "en", to: "cs", slug: "english-to-czech" },
  { from: "cs", to: "en", slug: "czech-to-english" },
  { from: "en", to: "ro", slug: "english-to-romanian" },
  { from: "ro", to: "en", slug: "romanian-to-english" },
  { from: "en", to: "he", slug: "english-to-hebrew" },
  { from: "he", to: "en", slug: "hebrew-to-english" },
  { from: "en", to: "fa", slug: "english-to-persian" },
  { from: "fa", to: "en", slug: "persian-to-english" },
  { from: "en", to: "sw", slug: "english-to-swahili" },
  { from: "sw", to: "en", slug: "swahili-to-english" },
  { from: "en", to: "ms", slug: "english-to-malay" },
  { from: "ms", to: "en", slug: "malay-to-english" },
  { from: "en", to: "ne", slug: "english-to-nepali" },
  { from: "hi", to: "ne", slug: "hindi-to-nepali" },
];

export const POPULAR_PAIRS: SeoPair[] = TOP_PAIRS_CONFIG.map((cfg) => {
  const fromLang = findLanguage(cfg.from);
  const toLang = findLanguage(cfg.to);
  const fromClean = fromLang.label.split(" (")[0];
  const toClean = toLang.label.split(" (")[0];

  return {
    slug: cfg.slug,
    fromCode: cfg.from,
    toCode: cfg.to,
    fromLang,
    toLang,
    title: `${fromClean} to ${toClean} Real-Time Voice Translator | Live Speech Translation`,
    h1: `${fromClean} to ${toClean} Real-Time Voice Translator`,
    metaDescription: `Translate spoken ${fromClean} to ${toClean} in real time with continuous AI voice output. Free 1-to-1 bilingual speech conversation powered by Gemini Live AI.`,
    keywords: [
      `${fromClean} to ${toClean} voice translator`,
      `translate ${fromClean} to ${toClean} by voice`,
      `live ${fromClean} to ${toClean} speech translation`,
      `real time ${fromClean} to ${toClean} audio translator`,
      `talk in ${fromClean} hear in ${toClean}`,
      `${fromClean} ${toClean} voice conversation online`,
    ],
  };
});

export function findPairBySlug(slug: string): SeoPair | null {
  const exact = POPULAR_PAIRS.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
  if (exact) return exact;

  // Check code format: e.g. "en-to-es" or "en-es"
  const match = slug.toLowerCase().match(/^([a-z]{2})(?:-to-|-)([a-z]{2})$/);
  if (match) {
    const [, from, to] = match;
    const fromLang = LANGUAGES.find((l) => l.code === from);
    const toLang = LANGUAGES.find((l) => l.code === to);
    if (fromLang && toLang) {
      const fromClean = fromLang.label.split(" (")[0];
      const toClean = toLang.label.split(" (")[0];
      return {
        slug,
        fromCode: from,
        toCode: to,
        fromLang,
        toLang,
        title: `${fromClean} to ${toClean} Real-Time Voice Translator | VoxLive`,
        h1: `${fromClean} to ${toClean} Real-Time Voice Translator`,
        metaDescription: `Speak ${fromClean} and hear real-time ${toClean} voice translation. Free 1-to-1 speech-to-speech call with live AI translation.`,
        keywords: [
          `${fromClean} to ${toClean} voice translator`,
          `live ${fromClean} ${toClean} translation`,
        ],
      };
    }
  }

  return null;
}
