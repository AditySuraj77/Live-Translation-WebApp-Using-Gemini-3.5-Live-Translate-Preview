import { NextRequest, NextResponse } from "next/server";
import { roomStore } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { roomId, role } = await req.json();
    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const uppercaseId = roomId.toUpperCase();
    console.log(`[Signal Leave] Room leave requested for: ${uppercaseId}, role: ${role || "all"}`);

    const redis = getRedis();

    if (redis) {
      try {
        if (role === "caller") {
          // Host left — end and delete the room completely
          console.log(`[Signal Leave] Host left room ${uppercaseId}. Closing room permanently.`);
          await redis.del(
            `room:${uppercaseId}:meta`,
            `room:${uppercaseId}:occupants`,
            `room:${uppercaseId}:presence:caller`,
            `room:${uppercaseId}:presence:callee`,
            `room:${uppercaseId}:offer`,
            `room:${uppercaseId}:answer`,
            `room:${uppercaseId}:ice:caller`,
            `room:${uppercaseId}:ice:callee`,
            `room:${uppercaseId}:profile:caller`,
            `room:${uppercaseId}:profile:callee`,
            `room:${uppercaseId}:peer_left`
          );
          await redis.srem("active_rooms", uppercaseId);
          roomStore.delete(uppercaseId);
          return NextResponse.json({ ok: true, roomClosed: true });
        }

        if (role === "callee") {
          // Guest left — Host is still in room, reset occupants to 1 (1/2 Waiting)
          console.log(`[Signal Leave] Callee left room ${uppercaseId}. Setting occupants = 1 for Host.`);
          await redis.del(
            `room:${uppercaseId}:presence:callee`,
            `room:${uppercaseId}:answer`,
            `room:${uppercaseId}:ice:callee`,
            `room:${uppercaseId}:profile:callee`
          );
          await redis.set(`room:${uppercaseId}:occupants`, 1, { ex: 21600 });
          await redis.expire(`room:${uppercaseId}:meta`, 21600);
          await redis.sadd("active_rooms", uppercaseId);

          return NextResponse.json({ ok: true, remaining: 1 });
        }

        // Full deletion if role not specified
        await redis.del(
          `room:${uppercaseId}:meta`,
          `room:${uppercaseId}:occupants`,
          `room:${uppercaseId}:presence:caller`,
          `room:${uppercaseId}:presence:callee`,
          `room:${uppercaseId}:offer`,
          `room:${uppercaseId}:answer`,
          `room:${uppercaseId}:ice:caller`,
          `room:${uppercaseId}:ice:callee`,
          `room:${uppercaseId}:profile:caller`,
          `room:${uppercaseId}:profile:callee`
        );
        await redis.srem("active_rooms", uppercaseId);
      } catch (err) {
        console.warn("[Signal Leave] Redis error:", err);
      }
    }

    roomStore.delete(uppercaseId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Signal Leave] Error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
