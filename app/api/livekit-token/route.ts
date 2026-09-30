import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const roomId = searchParams.get("roomId");
    const role = searchParams.get("role") || "caller";
    const name = searchParams.get("name") || (role === "caller" ? "Host User" : "Guest User");
    const sessionId = searchParams.get("sessionId") || `${role}_${Math.random().toString(36).substring(2, 9)}`;

    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const roomName = roomId.toUpperCase();
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json(
        { error: "LiveKit environment variables (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL) not configured" },
        { status: 500 }
      );
    }

    const redis = getRedis();

    // Check room capacity and manage occupants idempotently in Redis
    if (redis) {
      try {
        if (role === "callee") {
          const currentGuestSession = await redis.get(`room:${roomName}:guest_session`);

          if (currentGuestSession && currentGuestSession === sessionId) {
            // Same guest reconnecting / refreshing (F5) — allow smoothly without incrementing
            console.log(`[LiveKit Token API] Callee ${sessionId} re-connecting to ${roomName} (session recognized)`);
            await redis.expire(`room:${roomName}:guest_session`, 3600);
            await redis.expire(`room:${roomName}:occupants`, 3600);
            await redis.expire(`room:${roomName}:meta`, 3600);
          } else if (currentGuestSession && currentGuestSession !== sessionId) {
            // A different session wants to join. Check LiveKit directly to see if previous guest is really there.
            let isPreviousGuestStillActive = true;
            try {
              const httpUrl = wsUrl.replace("wss://", "https://").replace("ws://", "http://");
              const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
              const participants = await roomService.listParticipants(roomName);
              const calleeParticipants = participants.filter((p) => p.identity.startsWith("callee"));
              if (calleeParticipants.length === 0) {
                // The previous guest has disconnected from WebRTC
                isPreviousGuestStillActive = false;
              }
            } catch (lkErr) {
              console.warn("[LiveKit Token API] Participant check error:", lkErr);
            }

            if (isPreviousGuestStillActive) {
              return NextResponse.json(
                { error: "Room is full (maximum 2 participants allowed)", code: "ROOM_FULL" },
                { status: 403 }
              );
            } else {
              // Replace disconnected guest with the new guest
              await redis.set(`room:${roomName}:guest_session`, sessionId, { ex: 3600 });
              await redis.set(`room:${roomName}:occupants`, 2, { ex: 3600 });
              await redis.expire(`room:${roomName}:meta`, 3600);
            }
          } else {
            // First time this guest joins
            await redis.set(`room:${roomName}:guest_session`, sessionId, { ex: 3600 });
            await redis.set(`room:${roomName}:occupants`, 2, { ex: 3600 });
            await redis.expire(`room:${roomName}:meta`, 3600);
          }
        } else if (role === "caller") {
          // Caller session registration & TTL refresh
          await redis.set(`room:${roomName}:caller_session`, sessionId, { ex: 3600 });
          const occRaw = await redis.get(`room:${roomName}:occupants`);
          if (!occRaw || Number(occRaw) === 0) {
            await redis.set(`room:${roomName}:occupants`, 1, { ex: 3600 });
          }
        }
      } catch (rErr) {
        console.warn("[LiveKit Token API] Redis occupant sync warning:", rErr);
      }
    }

    // Use consistent identity based on sessionId so LiveKit recognizes reconnections
    const identity = sessionId.startsWith(`${role}_`) ? sessionId : `${role}_${sessionId}`;

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
