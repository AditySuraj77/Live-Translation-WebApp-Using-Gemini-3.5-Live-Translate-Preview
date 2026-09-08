import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

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

    const roomName = roomId.toUpperCase();
    const redis = getRedis();

    // Check room capacity and manage occupants in Redis
    if (redis) {
      try {
        if (role === "callee") {
          const occRaw = await redis.get(`room:${roomName}:occupants`);
          const currentOccupants = Number(occRaw) || 0;
          if (currentOccupants >= 2) {
            return NextResponse.json(
              { error: "Room is full (maximum 2 participants allowed)", code: "ROOM_FULL" },
              { status: 403 }
            );
          }
          // Set occupants to 2 so lobby immediately updates to 2/2 Full
          await redis.set(`room:${roomName}:occupants`, 2, { ex: 21600 });
        } else if (role === "caller") {
          // Ensure caller has at least 1 occupant recorded
          const occRaw = await redis.get(`room:${roomName}:occupants`);
          if (!occRaw || Number(occRaw) === 0) {
            await redis.set(`room:${roomName}:occupants`, 1, { ex: 21600 });
          }
        }
      } catch (rErr) {
        console.warn("[LiveKit Token API] Redis occupant sync warning:", rErr);
      }
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
