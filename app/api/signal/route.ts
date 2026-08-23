import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoom, encodeSSE, type SignalEvent } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const { roomId, type, payload, from } = await req.json();
    if (!roomId || !type || !from) {
      return NextResponse.json({ error: "Missing roomId, type, or from" }, { status: 400 });
    }

    const uppercaseId = roomId.toUpperCase();
    const event: SignalEvent = { type, payload, from };
    const room = getOrCreateRoom(uppercaseId);

    console.log(`[Signal POST] Room: ${uppercaseId}, Event: ${type}, From: ${from}, Subscribers: ${room.subscribers.size}`);

    // 1. Sync to Redis for cross-instance Serverless signaling
    const redis = getRedis();
    if (redis) {
      try {
        if (type === "offer") {
          await redis.set(`room:${uppercaseId}:offer`, JSON.stringify(payload), { ex: 120 });
        } else if (type === "answer") {
          await redis.set(`room:${uppercaseId}:answer`, JSON.stringify(payload), { ex: 120 });
          // Callee joined and answered — set occupants = 2
          await redis.set(`room:${uppercaseId}:occupants`, 2, { ex: 120 });
        } else if (type === "ice") {
          await redis.rpush(`room:${uppercaseId}:ice:${from}`, JSON.stringify(payload));
          await redis.expire(`room:${uppercaseId}:ice:${from}`, 120);
        } else if (type === "profile") {
          await redis.set(`room:${uppercaseId}:profile:${from}`, JSON.stringify(payload), { ex: 120 });
        }
      } catch (rErr) {
        console.warn("[Signal POST] Redis write error:", rErr);
      }
    }

    // 2. In-memory queue & local broadcast fallback
    if (type === "offer") {
      room.queue = room.queue.filter((e) => e.type !== "offer");
      room.queue.push(event);
    } else if (type === "answer") {
      room.queue.push(event);
    } else if (type === "ice") {
      room.queue.push(event);
    }

    const encoded = encodeSSE(event);
    for (const ctrl of Array.from(room.subscribers)) {
      try {
        ctrl.enqueue(encoded);
      } catch (err) {
        console.warn("[Signal POST] Subscriber error, removing controller", err);
        room.subscribers.delete(ctrl);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Signal POST Error]:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}