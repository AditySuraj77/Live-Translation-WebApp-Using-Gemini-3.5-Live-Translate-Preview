import { NextRequest, NextResponse } from "next/server";
import { roomStore, encodeSSE } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";
import { getPusherServer } from "@/lib/pusher-server";

export async function POST(req: NextRequest) {
  try {
    const { roomId, role } = await req.json();
    if (!roomId) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    const uppercaseId = roomId.toUpperCase();
    console.log(`[Signal Leave] Room leave requested for: ${uppercaseId}, role: ${role || "all"}`);

    const pusher = getPusherServer();
    const redis = getRedis();

    if (redis) {
      try {
        if (role === "caller") {
          // Rule 3: Host left — end and delete the room completely
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

          // Real-time broadcast to Guest via Pusher so Guest is notified and redirected to lobby
          if (pusher) {
            try {
              await pusher.trigger(`presence-room-${uppercaseId}`, "signal", {
                type: "peer_left",
                payload: { role: "caller" },
                from: "caller",
              });
            } catch (pErr) {
              console.warn("[Signal Leave] Pusher trigger error (caller leave):", pErr);
            }
          }

          // Broadcast peer_left event to callee (SSE fallback)
          const room = roomStore.get(uppercaseId);
          if (room) {
            const event = { type: "peer_left" as const, payload: { role: "caller" }, from: "caller" as const };
            const encoded = encodeSSE(event);
            for (const ctrl of Array.from(room.subscribers)) {
              try {
                ctrl.enqueue(encoded);
              } catch {
                room.subscribers.delete(ctrl);
              }
            }
          }

          roomStore.delete(uppercaseId);
          return NextResponse.json({ ok: true, roomClosed: true });
        }

        if (role === "callee") {
          // Rule 2: Guest left — Host is still in room, so update lobby to 1/2 Waiting
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

          // Real-time broadcast to Host via Pusher so Host resets and waits for new guest
          if (pusher) {
            try {
              await pusher.trigger(`presence-room-${uppercaseId}`, "signal", {
                type: "peer_left",
                payload: { role: "callee" },
                from: "callee",
              });
            } catch (pErr) {
              console.warn("[Signal Leave] Pusher trigger error (callee leave):", pErr);
            }
          }

          // Broadcast peer_left to host (SSE fallback)
          const room = roomStore.get(uppercaseId);
          if (room) {
            const event = { type: "peer_left" as const, payload: { role: "callee" }, from: "callee" as const };
            const encoded = encodeSSE(event);
            for (const ctrl of Array.from(room.subscribers)) {
              try {
                ctrl.enqueue(encoded);
              } catch {
                room.subscribers.delete(ctrl);
              }
            }
          }

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
