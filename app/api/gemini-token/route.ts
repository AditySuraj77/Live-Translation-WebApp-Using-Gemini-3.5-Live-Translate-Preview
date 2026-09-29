import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const dynamic = "force-dynamic";

// Helper: Collect all configured Gemini API keys from environment variables
let hasLoggedPoolSize = false;

function getGeminiKeyPool(): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  const addKey = (val?: string) => {
    if (!val) return;
    const trimmed = val.trim();
    // Valid Google API keys are non-empty strings (at least 20 chars)
    if (trimmed.length >= 20 && !seen.has(trimmed)) {
      seen.add(trimmed);
      keys.push(trimmed);
    }
  };

  // 1. Primary standard key (always prioritized first)
  addKey(process.env.GEMINI_API_KEY);

  // 2. Scan all process.env keys dynamically for custom names and numbered patterns:
  // - GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
  // - liveTranslate_GeminiSecondKey, liveTransalte_GeminiSeventhKey, etc.
  // - Any environment variable containing 'gemini' and 'key'
  for (const [envName, envVal] of Object.entries(process.env)) {
    if (envName === "GEMINI_API_KEY") continue; // already added first

    const lower = envName.toLowerCase();
    const isGeminiKey =
      lower.startsWith("gemini_api_key") ||
      lower.includes("geminikey") ||
      (lower.includes("livetranslat") && lower.includes("gemini")) ||
      (lower.includes("gemini") && lower.includes("key"));

    if (isGeminiKey && typeof envVal === "string") {
      addKey(envVal);
    }
  }

  if (!hasLoggedPoolSize && keys.length > 0) {
    console.log(`[Gemini Token Pool] Successfully loaded ${keys.length} active Gemini API key(s) into failover rotation pool.`);
    hasLoggedPoolSize = true;
  }

  return keys;
}

// Global round-robin pointer for distributed load balancing across active keys
let currentKeyPointer = 0;

// Returns a short-lived ephemeral Gemini authentication token (server-side only).
// The permanent API keys are never exposed to the client.
export async function GET(req: NextRequest) {
  // Basic abuse prevention: verify request originates from our own app
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  const host = req.headers.get('host') || '';
  if (origin && !origin.includes(host) && !origin.includes('localhost')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const keyPool = getGeminiKeyPool();

  if (keyPool.length === 0) {
    return NextResponse.json(
      { error: "No GEMINI_API_KEY configured on server" },
      { status: 500 }
    );
  }

  const totalKeys = keyPool.length;
  let lastError: unknown = null;

  // Try up to totalKeys in round-robin sequence (Auto-Failover)
  for (let attempt = 0; attempt < totalKeys; attempt++) {
    const selectedIndex = (currentKeyPointer + attempt) % totalKeys;
    const apiKey = keyPool[selectedIndex];

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1alpha" },
      });

      const tokenResponse = await ai.authTokens.create({
        config: {
          uses: 15,
          expireTime: new Date(Date.now() + 35 * 60 * 1000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        },
      });

      if (tokenResponse.name) {
        // Advance round-robin pointer for the next request
        currentKeyPointer = (selectedIndex + 1) % totalKeys;
        console.log(`[Gemini Token Pool] Issued ephemeral token from Key #${selectedIndex + 1}/${totalKeys}`);
        return NextResponse.json({ token: tokenResponse.name });
      }
    } catch (err) {
      console.warn(`[Gemini Token Pool] Key #${selectedIndex + 1} failed or rate-limited, failing over to next key:`, err);
      lastError = err;
    }
  }

  console.error("[Gemini Token Pool] All keys in pool exhausted:", lastError);
  return NextResponse.json(
    { error: "All Gemini API keys in pool are currently exhausted or rate-limited" },
    { status: 500 }
  );
}

