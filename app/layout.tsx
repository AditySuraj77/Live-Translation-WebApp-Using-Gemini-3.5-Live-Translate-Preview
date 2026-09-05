import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#030712",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://voxlive.vercel.app"),
  title: "VoxLive — Real-Time Voice Translator | Free 1-to-1 Speech Translation Online",
  description:
    "Break language barriers instantly. VoxLive is a free real-time speech-to-speech voice translator powered by Gemini Live AI. Speak naturally in your native language and hear live translated audio across 70+ languages simultaneously.",
  keywords: [
    "real-time voice translation",
    "speech to speech translator online",
    "live speech translation",
    "live conversation translator",
    "voxlive translator",
    "google translate voice alternative",
    "free4talk alternative",
    "AI voice translator",
    "simultaneous voice interpreter",
    "practice languages live voice",
    "low latency voice translator",
    "bilingual voice chat online",
  ],
  authors: [{ name: "VoxLive Team" }],
  creator: "VoxLive",
  publisher: "VoxLive",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://voxlive.vercel.app",
    siteName: "VoxLive",
    title: "VoxLive — Real-Time Voice Translator | Free 1-to-1 Speech Translation",
    description:
      "Speak naturally in your native language and hear your partner in real time across 70+ languages with zero lag. Powered by Gemini Live AI.",
    images: [
      {
        url: "/logo.jpg",
        width: 1024,
        height: 1024,
        alt: "VoxLive — Real-Time Voice Translator Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VoxLive — Real-Time Voice Translator",
    description: "Instant 1-on-1 speech-to-speech conversation translation across 70+ languages.",
    images: ["/logo.jpg"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "VoxLive",
  applicationCategory: "CommunicationApplication",
  operatingSystem: "All",
  description:
    "Free real-time 1-to-1 speech-to-speech voice translation web app powered by Gemini Live AI.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Real-time speech-to-speech translation",
    "1-to-1 live WebRTC voice lounges",
    "70+ international languages supported",
    "Live floating subtitles and captions",
    "P2P direct voice streaming",
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Is VoxLive completely free to use?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, VoxLive is 100% free with no subscription, credit card, or account signup required. You can start or join a bilingual voice room immediately.",
      },
    },
    {
      "@type": "Question",
      name: "How does real-time voice-to-voice translation work on VoxLive?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "When you speak into your microphone, your raw audio is streamed continuously via WebSockets to Gemini Live Translate AI. The AI translates your speech simultaneously and streams natural synthesized voice audio to your partner over peer-to-peer WebRTC with sub-second latency.",
      },
    },
    {
      "@type": "Question",
      name: "Do I need to push a button every time I speak?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No! Unlike traditional translation apps that require pressing a button back-and-forth, VoxLive operates continuously like a normal phone call. You speak freely in your language, and your partner hears the translated voice automatically.",
      },
    },
    {
      "@type": "Question",
      name: "Are voice conversations and files private?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Voice audio and in-room chat messages/files are transmitted directly between the two participants via encrypted peer-to-peer WebRTC DataChannels.",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon.png?v=2" type="image/png" sizes="64x64" />
        <link rel="shortcut icon" href="/favicon.ico?v=2" />
        <link rel="apple-touch-icon" href="/apple-icon.png?v=2" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      </head>
      <body className="bg-gray-950 antialiased">{children}</body>
    </html>
  );
}
