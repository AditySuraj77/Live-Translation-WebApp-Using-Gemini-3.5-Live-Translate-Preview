import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { POPULAR_PAIRS, findPairBySlug } from "@/lib/seo-pairs";
import TranslatePairAction from "@/components/TranslatePairAction";

interface PageProps {
  params: Promise<{ pair: string }>;
}

export async function generateStaticParams() {
  return POPULAR_PAIRS.map((p) => ({
    pair: p.slug,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pair: slug } = await params;
  const pair = findPairBySlug(slug);
  if (!pair) {
    return {
      title: "Language Pair Not Found | LinguaLive",
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://lingualive.app";
  const canonicalUrl = `${baseUrl}/translate/${pair.slug}`;

  return {
    title: pair.title,
    description: pair.metaDescription,
    keywords: pair.keywords,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: pair.title,
      description: pair.metaDescription,
      url: canonicalUrl,
      siteName: "LinguaLive",
      images: [
        {
          url: "/logo.jpg",
          width: 1024,
          height: 1024,
          alt: `${pair.fromLang.label} to ${pair.toLang.label} Voice Translator`,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: pair.title,
      description: pair.metaDescription,
      images: ["/logo.jpg"],
    },
  };
}

export default async function TranslatePairPage({ params }: PageProps) {
  const { pair: slug } = await params;
  const pair = findPairBySlug(slug);

  if (!pair) {
    notFound();
  }

  const otherPairs = POPULAR_PAIRS.filter((p) => p.slug !== pair.slug).slice(0, 8);
  const fromClean = pair.fromLang.label.split(" (")[0];
  const toClean = pair.toLang.label.split(" (")[0];

  const pageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: pair.title,
    description: pair.metaDescription,
    url: `https://lingualive.app/translate/${pair.slug}`,
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://lingualive.app",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Translate",
          item: "https://lingualive.app/#rooms",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: `${fromClean} to ${toClean}`,
          item: `https://lingualive.app/translate/${pair.slug}`,
        },
      ],
    },
  };

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-4 sm:p-8">
      {/* Schema injection */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pageSchema) }}
      />

      {/* Top Navigation */}
      <header className="w-full max-w-4xl flex justify-between items-center py-4 border-b border-gray-800/80 mb-6 sm:mb-8">
        <Link href="/" className="flex items-center gap-3">
          <img
            src="/logo.jpg"
            alt="LinguaLive Logo"
            className="w-9 h-9 rounded-xl border border-indigo-500/40 shadow-sm object-cover"
          />
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-emerald-300 bg-clip-text text-transparent">
            LinguaLive
          </span>
        </Link>

        <Link
          href="/"
          className="text-xs text-gray-400 hover:text-white transition px-3.5 py-1.5 bg-gray-900 border border-gray-800 rounded-full flex items-center gap-1.5"
        >
          <span>←</span> Back to Public Lobby
        </Link>
      </header>

      {/* Hero Section */}
      <article className="w-full max-w-4xl flex flex-col items-center text-center gap-6 my-4">
        {/* Breadcrumb pills */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/" className="hover:text-gray-300">Home</Link>
          <span>/</span>
          <span className="text-gray-400">Translate</span>
          <span>/</span>
          <span className="text-indigo-400 font-medium">{fromClean} to {toClean}</span>
        </nav>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-100 to-emerald-300 bg-clip-text text-transparent max-w-2xl leading-tight">
          {pair.h1}
        </h1>

        <p className="text-gray-400 text-sm sm:text-base max-w-xl leading-relaxed">
          Speak naturally in <strong className="text-indigo-300">{pair.fromLang.label}</strong> and your partner instantly hears live translated voice audio in <strong className="text-emerald-300">{pair.toLang.label}</strong> with zero push-to-talk lag.
        </p>

        {/* Translation Flow Card */}
        <div className="w-full max-w-xl bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-5">
          <div className="flex items-center justify-between w-full gap-3 sm:gap-6">
            {/* From Speaker */}
            <div className="flex-1 bg-indigo-950/40 border border-indigo-800/50 rounded-xl p-4 flex flex-col items-center text-center min-w-0">
              <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider mb-1">
                You Speak
              </span>
              <span className="text-base sm:text-lg font-bold text-white truncate w-full">
                {pair.fromLang.label}
              </span>
              <span className="text-xs text-indigo-300/80 mt-1">🎙️ Continuous Voice</span>
            </div>

            {/* Direction Icon */}
            <div className="w-10 h-10 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-lg text-emerald-400 shrink-0 shadow">
              ⇄
            </div>

            {/* To Speaker */}
            <div className="flex-1 bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-4 flex flex-col items-center text-center min-w-0">
              <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider mb-1">
                Partner Hears
              </span>
              <span className="text-base sm:text-lg font-bold text-white truncate w-full">
                {pair.toLang.label}
              </span>
              <span className="text-xs text-emerald-300/80 mt-1">🔊 Real-Time Audio</span>
            </div>
          </div>

          <TranslatePairAction
            fromCode={pair.fromCode}
            toCode={pair.toCode}
            fromName={fromClean}
            toName={toClean}
          />

          <div className="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-800/80 w-full justify-center">
            <span className="flex items-center gap-1">⚡ Sub-second Latency</span>
            <span>•</span>
            <span className="flex items-center gap-1">🔒 P2P WebRTC Audio</span>
            <span>•</span>
            <span className="flex items-center gap-1">🆓 100% Free</span>
          </div>
        </div>

        {/* How It Works Section */}
        <section className="w-full max-w-3xl mt-12 text-left">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 text-center">
            How {fromClean} to {toClean} Live Voice Translation Works
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-5 flex flex-col gap-2">
              <span className="text-2xl font-bold text-indigo-400">1</span>
              <h3 className="font-semibold text-white text-sm">Open Voice Room</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Click start to generate an instant bilingual room. Share the room link or ID with your partner.
              </p>
            </div>

            <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-5 flex flex-col gap-2">
              <span className="text-2xl font-bold text-emerald-400">2</span>
              <h3 className="font-semibold text-white text-sm">Speak Naturally</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Talk freely in {fromClean}. Raw audio streams over high-fidelity 16kHz AudioWorklets to Gemini Live AI.
              </p>
            </div>

            <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-5 flex flex-col gap-2">
              <span className="text-2xl font-bold text-indigo-300">3</span>
              <h3 className="font-semibold text-white text-sm">Hear Live Audio</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Your partner hears your words spoken in {toClean} in real time with synchronized floating subtitles.
              </p>
            </div>
          </div>
        </section>

        {/* Other Popular Pairs (Internal SEO Linking Network) */}
        <section className="w-full max-w-3xl mt-12 text-left border-t border-gray-800/80 pt-8">
          <h3 className="text-lg font-semibold text-white mb-4">
            Other Popular Voice Translation Pairs
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {otherPairs.map((op) => (
              <Link
                key={op.slug}
                href={`/translate/${op.slug}`}
                className="bg-gray-900/70 hover:bg-gray-800 border border-gray-800/80 hover:border-indigo-500/50 p-2.5 rounded-xl text-xs text-gray-300 hover:text-white transition truncate block"
              >
                {op.fromLang.label.split(" (")[0]} ⇄ {op.toLang.label.split(" (")[0]}
              </Link>
            ))}
          </div>
        </section>
      </article>
    </main>
  );
}
