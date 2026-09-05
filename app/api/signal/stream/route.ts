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
      let lastPeerLeftTimestamp = 0;
      let consecutiveStablePolls = 0;

      const peerRole = role === "caller" ? "callee" : "caller";

      // 2. Smart Adaptive Redis polling loop (400ms during handshake -> 6000ms once connected)
      let redisPollTimer: NodeJS.Timeout | null = null;
      let pollIntervalMs = 400;
      let isAborted = false;

      if (redis) {
        async function pollRedis() {
          if (isAborted || !redis) return;

          try {
            // Is handshake already complete?
            const isHandshakeComplete =
              (role === "callee" ? hasDeliveredOffer : hasDeliveredAnswer) &&
              hasDeliveredProfile;

            // Deliver Offer to Callee (Only if not yet delivered)
            if (role === "callee" && !hasDeliveredOffer) {
              const offerRaw = await redis.get<string | object>(`room:${uppercaseId}:offer`);
              if (offerRaw) {
                const payload = typeof offerRaw === "string" ? JSON.parse(offerRaw) : offerRaw;
                controller.enqueue(encodeSSE({ type: "offer", payload, from: "caller" }));
                hasDeliveredOffer = true;
              }
            }

            // Deliver Answer to Caller (Only if not yet delivered)
            if (role === "caller" && !hasDeliveredAnswer) {
              const answerRaw = await redis.get<string | object>(`room:${uppercaseId}:answer`);
              if (answerRaw) {
                const payload = typeof answerRaw === "string" ? JSON.parse(answerRaw) : answerRaw;
                controller.enqueue(encodeSSE({ type: "answer", payload, from: "callee" }));
                hasDeliveredAnswer = true;
              }
            }

            // Deliver Profile (Only if not yet delivered)
            if (!hasDeliveredProfile) {
              const profileRaw = await redis.get<string | object>(`room:${uppercaseId}:profile:${peerRole}`);
              if (profileRaw) {
                const payload = typeof profileRaw === "string" ? JSON.parse(profileRaw) : profileRaw;
                controller.enqueue(encodeSSE({ type: "profile", payload, from: peerRole }));
                hasDeliveredProfile = true;
              }
            }

            // Check for peer_left event from peerRole
            const peerLeftRaw = await redis.get<string | { role: string; timestamp: number }>(`room:${uppercaseId}:peer_left`);
            if (peerLeftRaw) {
              const data = typeof peerLeftRaw === "string" ? JSON.parse(peerLeftRaw) : peerLeftRaw;
              if (data && data.role === peerRole && data.timestamp > lastPeerLeftTimestamp) {
                lastPeerLeftTimestamp = data.timestamp;
                controller.enqueue(encodeSSE({ type: "peer_left", payload: data, from: peerRole }));
                // Reset delivery flags so that a NEW peer can deliver fresh profile, answer, & ICE!
                hasDeliveredProfile = false;
                hasDeliveredAnswer = false;
                hasDeliveredOffer = false;
                deliveredIceCount = 0;
                consecutiveStablePolls = 0;
                // Instantly ramp back up to 400ms for incoming new guest!
                pollIntervalMs = 400;
              }
            }

            // Deliver new ICE candidates from peer (Only check if not in slow idle mode or if candidates still pending)
            if (pollIntervalMs === 400 || deliveredIceCount === 0) {
              const iceKey = `room:${uppercaseId}:ice:${peerRole}`;
              const iceCandidates = await redis.lrange(iceKey, deliveredIceCount, -1);
              if (iceCandidates && iceCandidates.length > 0) {
                for (const candRaw of iceCandidates) {
                  const payload = typeof candRaw === "string" ? JSON.parse(candRaw) : candRaw;
                  controller.enqueue(encodeSSE({ type: "ice", payload, from: peerRole }));
                  deliveredIceCount++;
                }
                consecutiveStablePolls = 0;
              } else if (isHandshakeComplete) {
                consecutiveStablePolls++;
              }
            }

            // Adaptive backoff: if handshake is complete and ICE candidates have settled,
            // switch to 6-second low-frequency check (saves 98% Upstash quota!)
            if (isHandshakeComplete && consecutiveStablePolls >= 3 && pollIntervalMs === 400) {
              console.log(`[Signal SSE] Handshake settled for room ${uppercaseId}. Transitioning to 6s backoff.`);
              pollIntervalMs = 6000;
            }
          } catch (pErr) {
            console.warn("[Signal SSE] Redis poll error:", pErr);
          }

          // Schedule next poll using dynamic interval
          if (!isAborted) {
            redisPollTimer = setTimeout(pollRedis, pollIntervalMs);
          }
        }

        // Initial fetch immediately
        pollRedis();
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
        isAborted = true;
        clearInterval(keepalive);
        if (redisPollTimer) clearTimeout(redisPollTimer);
        room.subscribers.delete(controller);

        if (room.subscribers.size === 0) {
          if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
          room.cleanupTimer = setTimeout(() => {
            if (room.subscribers.size === 0) {
              console.log(`[Signal SSE] Cleaning up local in-memory room: ${uppercaseId}`);
              roomStore.delete(uppercaseId);
            }
          }, 45_000);
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