import { NextRequest, NextResponse } from "next/server";
import { roomStore } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const { roomId } = await req.json();
    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const uppercaseId = roomId.toUpperCase();
    console.log(`[Signal Leave] Instant room leave requested for: ${uppercaseId}`);

    // In-memory removal
    roomStore.delete(uppercaseId);

    // Redis removal
    const redis = getRedis();
    if (redis) {
      try {
        await redis.del(
          `room:${uppercaseId}:meta`,
          `room:${uppercaseId}:occupants`,
          `room:${uppercaseId}:offer`,
          `room:${uppercaseId}:answer`,
          `room:${uppercaseId}:ice:caller`,
          `room:${uppercaseId}:ice:callee`,
          `room:${uppercaseId}:profile:caller`,
          `room:${uppercaseId}:profile:callee`
        );
        await redis.srem("active_rooms", uppercaseId);
      } catch (err) {
        console.warn("[Signal Leave] Redis delete warning:", err);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Signal Leave] Error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
