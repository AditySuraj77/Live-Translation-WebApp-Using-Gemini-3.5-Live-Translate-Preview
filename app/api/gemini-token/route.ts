import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const dynamic = "force-dynamic";

// Helper: Collect all configured Gemini API keys from environment variables
function getGeminiKeyPool(): string[] {
  const keys: string[] = [];

  // Primary standard key
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }

  // Scan for any multi-pool keys (e.g. liveTranslate_GeminiSecondKey, liveTranslate_GeminiThirdKey, etc.)
  for (const [envName, envVal] of Object.entries(process.env)) {
    if (
      envVal &&
      envName !== "GEMINI_API_KEY" &&
      (envName.toLowerCase().includes("gemini") || envName.toLowerCase().startsWith("livetranslat"))
    ) {
      const trimmed = envVal.trim();
      if (trimmed && !keys.includes(trimmed)) {
        keys.push(trimmed);
      }
    }
  }

  return keys;
}

// Global round-robin pointer for distributed load balancing across active keys
let currentKeyPointer = 0;

// Returns a short-lived ephemeral Gemini authentication token (server-side only).
// The permanent API keys are never exposed to the client.
export async function GET() {
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

