import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const rawUrl = process.env.EXPRESSTURN_URL || "free.expressturn.com:3478";
  const host = rawUrl.replace(/^(turn:|turns:|stun:)/, "");
  const hostWithoutPort = host.split(":")[0];
  const username = process.env.EXPRESSTURN_USERNAME;
  const credential = process.env.EXPRESSTURN_PASSWORD;

  const iceServers: RTCIceServer[] = [
    // 1. Google Public STUN (Preserved)
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },

    // 2. Cloudflare Public STUN (Anycast high-availability backup)
    { urls: ["stun:stun.cloudflare.com:3478"] },

    // 3. Open Relay Project (20 GB/month Free, Ports 80 & 443 for Strict Firewalls / CGNAT)
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
        "turns:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];

  // 4. ExpressTurn (Preserved 100%)
  if (username && credential) {
    iceServers.push(
      {
        urls: [
          `turn:${hostWithoutPort}:3478?transport=udp`,
          `turn:${host}`,
        ],
        username,
        credential,
      },
      {
        urls: [
          `turn:${hostWithoutPort}:443?transport=tcp`,
        ],
        username,
        credential,
      }
    );
  }

  return NextResponse.json({ iceServers });
}
