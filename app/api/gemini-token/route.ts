import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// Returns a short-lived ephemeral Gemini authentication token (server-side only).
// The permanent GEMINI_API_KEY is never exposed to the client.
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on server" },
      { status: 500 }
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const tokenResponse = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      },
    });

    if (!tokenResponse.name) {
      return NextResponse.json(
        { error: "Failed to generate ephemeral token" },
        { status: 500 }
      );
    }

    return NextResponse.json({ token: tokenResponse.name });
  } catch (err) {
    console.error("[Gemini Token] Error generating ephemeral token:", err);
    return NextResponse.json(
      { error: "Failed to create ephemeral token" },
      { status: 500 }
    );
  }
}

