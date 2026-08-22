import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const rawUrl = process.env.EXPRESSTURN_URL || "free.expressturn.com:3478";
  const host = rawUrl.replace(/^(turn:|turns:|stun:)/, "");
  const hostWithoutPort = host.split(":")[0];
  const username = process.env.EXPRESSTURN_USERNAME;
  const credential = process.env.EXPRESSTURN_PASSWORD;

  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

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
