import { NextRequest } from "next/server";
import { getOrCreateRoom, encodeSSE, roomStore, SignalEvent } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  const myLang = req.nextUrl.searchParams.get("myLang");
  const targetLang = req.nextUrl.searchParams.get("targetLang");
  const role = (req.nextUrl.searchParams.get("role") || "caller") as "caller" | "callee";

  if (!roomId) {
    return new Response("Missing roomId", { status: 400 });
  }

  const uppercaseId = roomId.toUpperCase();
  const room = getOrCreateRoom(uppercaseId, {
    id: uppercaseId,
    hostLang: myLang || undefined,
    targetLang: targetLang || undefined,
  });

  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }

  const redis = getRedis();

  const stream = new ReadableStream({
    async start(controller) {
      console.log(`[Signal SSE] ${role} connected for room: ${uppercaseId}.`);

      // 1. Flush in-memory queue
      for (const event of room.queue) {
        controller.enqueue(encodeSSE(event));
      }
      room.subscribers.add(controller);

      // Track already delivered signals
      let hasDeliveredOffer = false;
      let hasDeliveredAnswer = false;
      let deliveredIceCount = 0;
      let hasDeliveredProfile = false;

      const peerRole = role === "caller" ? "callee" : "caller";

      // 2. Redis polling loop (400ms) for real-time cross-container delivery
      let redisPollTimer: NodeJS.Timeout | null = null;

      if (redis) {
        async function pollRedis() {
          try {
            if (!redis) return;

            // Deliver Offer to Callee
            if (role === "callee" && !hasDeliveredOffer) {
              const offerRaw = await redis.get<string | object>(`room:${uppercaseId}:offer`);
              if (offerRaw) {
                const payload = typeof offerRaw === "string" ? JSON.parse(offerRaw) : offerRaw;
                controller.enqueue(encodeSSE({ type: "offer", payload, from: "caller" }));
                hasDeliveredOffer = true;
              }
            }

            // Deliver Answer to Caller
            if (role === "caller" && !hasDeliveredAnswer) {
              const answerRaw = await redis.get<string | object>(`room:${uppercaseId}:answer`);
              if (answerRaw) {
                const payload = typeof answerRaw === "string" ? JSON.parse(answerRaw) : answerRaw;
                controller.enqueue(encodeSSE({ type: "answer", payload, from: "callee" }));
                hasDeliveredAnswer = true;
              }
            }

            // Deliver Profile
            if (!hasDeliveredProfile) {
              const profileRaw = await redis.get<string | object>(`room:${uppercaseId}:profile:${peerRole}`);
              if (profileRaw) {
                const payload = typeof profileRaw === "string" ? JSON.parse(profileRaw) : profileRaw;
                controller.enqueue(encodeSSE({ type: "profile", payload, from: peerRole }));
                hasDeliveredProfile = true;
              }
            }

            // Deliver new ICE candidates from peer
            const iceKey = `room:${uppercaseId}:ice:${peerRole}`;
            const iceCandidates = await redis.lrange(iceKey, deliveredIceCount, -1);
            if (iceCandidates && iceCandidates.length > 0) {
              for (const candRaw of iceCandidates) {
                const payload = typeof candRaw === "string" ? JSON.parse(candRaw) : candRaw;
                controller.enqueue(encodeSSE({ type: "ice", payload, from: peerRole }));
                deliveredIceCount++;
              }
            }
          } catch (pErr) {
            console.warn("[Signal SSE] Redis poll error:", pErr);
          }
        }

        // Initial fetch immediately
        await pollRedis();
        redisPollTimer = setInterval(pollRedis, 400);
      }

      // 3. Keepalive ping every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(": keepalive\n\n");
        } catch {
          clearInterval(keepalive);
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        console.log(`[Signal SSE] Subscriber (${role}) disconnected from room: ${uppercaseId}`);
        clearInterval(keepalive);
        if (redisPollTimer) clearInterval(redisPollTimer);
        room.subscribers.delete(controller);

        if (room.subscribers.size === 0) {
          if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
          room.cleanupTimer = setTimeout(async () => {
            if (room.subscribers.size === 0) {
              console.log(`[Signal SSE] Cleaning up empty room: ${uppercaseId}`);
              roomStore.delete(uppercaseId);
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
                } catch (cErr) {
                  console.warn("[Signal SSE] Redis cleanup error:", cErr);
                }
              }
            }
          }, 15_000);
        }

        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}