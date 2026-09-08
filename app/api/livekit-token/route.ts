import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const roomId = searchParams.get("roomId");
    const role = searchParams.get("role") || "caller";
    const name = searchParams.get("name") || (role === "caller" ? "Host User" : "Guest User");

    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json(
        { error: "LiveKit environment variables (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL) not configured" },
        { status: 500 }
      );
    }

    const roomName = roomId.toUpperCase();
    const identity = `${role}_${Math.random().toString(36).substring(2, 9)}`;

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: "6h",
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return NextResponse.json({
      token,
      wsUrl,
      identity,
      roomName,
    });
  } catch (error) {
    console.error("[LiveKit Token API] Error generating token:", error);
    return NextResponse.json({ error: "Failed to generate LiveKit access token" }, { status: 500 });
  }
}
