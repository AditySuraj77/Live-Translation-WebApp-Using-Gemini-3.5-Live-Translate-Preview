import { NextRequest, NextResponse } from "next/server";
import { roomStore, getOrCreateRoom, RoomMetadata } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";
import { RoomServiceClient } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

export async function GET() {
  const redis = getRedis();
  const rooms = [];
  const now = Date.now();

  if (redis) {
    try {
      const activeIds: string[] = await redis.smembers("active_rooms");
      if (activeIds && activeIds.length > 0) {
        const pipe = redis.pipeline();
        for (const id of activeIds) {
          pipe.get(`room:${id}:meta`);
          pipe.get(`room:${id}:occupants`);
        }
        const results = await pipe.exec();

        const staleIds: string[] = [];
        for (let i = 0; i < activeIds.length; i++) {
          const id = activeIds[i];
          const metaRaw = results[i * 2] as string | RoomMetadata | null;
          const occRaw = results[i * 2 + 1];

          if (!metaRaw) {
            staleIds.push(id);
            continue;
          }

          let meta: RoomMetadata;
          if (typeof metaRaw === "string") {
            try {
              meta = JSON.parse(metaRaw);
            } catch {
              staleIds.push(id);
              continue;
            }
          } else {
            meta = metaRaw;
          }

          const occupants = Number(occRaw) || 1;

          rooms.push({
            id,
            name: meta.name || `Room ${id}`,
            hostLang: meta.hostLang || "hi",
            targetLang: meta.targetLang || "en",
            hostProfile: meta.hostProfile || {
              name: "Host User",
              avatar: "🎙️",
              color: "indigo",
            },
            occupants,
            maxOccupants: 2,
            status: occupants >= 2 ? ("full" as const) : ("open" as const),
            createdAt: meta.createdAt || now,
          });
        }

        if (staleIds.length > 0) {
          await redis.srem("active_rooms", ...staleIds);
        }
      }

      rooms.sort((a, b) => {
        if (a.status === "open" && a.occupants === 1 && b.occupants !== 1) return -1;
        if (b.status === "open" && b.occupants === 1 && a.occupants !== 1) return 1;
        return b.createdAt - a.createdAt;
      });

      return NextResponse.json({ rooms });
    } catch (err) {
      console.warn("[Rooms API] Redis fetch error, falling back to local memory:", err);
    }
  }

  // In-memory fallback
  for (const [id, entry] of Array.from(roomStore.entries())) {
    const occupants = entry.subscribers.size;

    if (occupants === 0) {
      if (entry.metadata && now - entry.metadata.createdAt < 120_000) {
        rooms.push({
          id,
          name: entry.metadata.name || `Room ${id}`,
          hostLang: entry.metadata.hostLang || "hi",
          targetLang: entry.metadata.targetLang || "en",
          hostProfile: entry.metadata.hostProfile || {
            name: "Host User",
            avatar: "🎙️",
            color: "indigo",
          },
          occupants: 1,
          maxOccupants: 2,
          status: "open" as const,
          createdAt: entry.metadata.createdAt,
        });
      } else {
        roomStore.delete(id);
      }
      continue;
    }

    rooms.push({
      id,
      name: entry.metadata?.name || `Room ${id}`,
      hostLang: entry.metadata?.hostLang || "hi",
      targetLang: entry.metadata?.targetLang || "en",
      hostProfile: entry.metadata?.hostProfile || {
        name: "Host User",
        avatar: "🎙️",
        color: "indigo",
      },
      occupants,
      maxOccupants: 2,
      status: occupants >= 2 ? ("full" as const) : ("open" as const),
      createdAt: entry.metadata?.createdAt || now,
    });
  }

  rooms.sort((a, b) => {
    if (a.status === "open" && a.occupants === 1 && b.occupants !== 1) return -1;
    if (b.status === "open" && b.occupants === 1 && a.occupants !== 1) return 1;
    return b.createdAt - a.createdAt;
  });

  return NextResponse.json({ rooms });
}

export async function POST(req: NextRequest) {
  try {
    const { id, name, hostLang, targetLang, hostProfile } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
    }

    // Validate roomId format: alphanumeric, 2-20 chars
    const roomIdRegex = /^[A-Za-z0-9_-]{2,20}$/;
    if (!roomIdRegex.test(id)) {
      return NextResponse.json(
        { error: "Invalid room ID. Use 2-20 alphanumeric characters." },
        { status: 400 }
      );
    }

    const MAX_CONCURRENT_ROOMS = 20;
    const redis = getRedis();

    // Enforce 20 concurrent active rooms limit with zero-quota Lazy Pruning
    if (redis) {
      try {
        let activeCount = await redis.scard("active_rooms");

        if (activeCount >= MAX_CONCURRENT_ROOMS) {
          // Lazy Pruning: Check with LiveKit Server SDK if registered rooms are still actually alive
          const apiKey = process.env.LIVEKIT_API_KEY;
          const apiSecret = process.env.LIVEKIT_API_SECRET;
          const wsUrl = process.env.LIVEKIT_URL;

          if (apiKey && apiSecret && wsUrl) {
            try {
              const httpUrl = wsUrl.replace("wss://", "https://").replace("ws://", "http://");
              const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
              const liveRooms = await roomService.listRooms();

              const registeredRooms: string[] = await redis.smembers("active_rooms");
              const zombiesToRemove: string[] = [];
              const now = Date.now();

              for (const rId of registeredRooms) {
                const liveRoom = liveRooms.find((lr) => lr.name.toUpperCase() === rId.toUpperCase());
                const isAliveInLivekit = liveRoom && liveRoom.numParticipants > 0;

                if (!isAliveInLivekit) {
                  // Allow a 3-minute grace period for host to finish loading and joining
                  const metaRaw = await redis.get(`room:${rId}:meta`);
                  let isRecent = false;
                  if (metaRaw) {
                    try {
                      const parsed = typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw;
                      if (parsed.createdAt && now - parsed.createdAt < 3 * 60 * 1000) {
                        isRecent = true;
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                  if (!isRecent) {
                    zombiesToRemove.push(rId);
                  }
                }
              }

              if (zombiesToRemove.length > 0) {
                console.log(`[Rooms API] Lazy Prune: removing ${zombiesToRemove.length} zombie room(s):`, zombiesToRemove);
                for (const zid of zombiesToRemove) {
                  await redis.del(
                    `room:${zid}:meta`,
                    `room:${zid}:occupants`,
                    `room:${zid}:guest_session`,
                    `room:${zid}:caller_session`
                  );
                }
                await redis.srem("active_rooms", ...zombiesToRemove);
                activeCount = await redis.scard("active_rooms");
              }
            } catch (pruneErr) {
              console.warn("[Rooms API] Lazy pruning warning:", pruneErr);
            }
          }

          if (activeCount >= MAX_CONCURRENT_ROOMS) {
            console.warn(`[Rooms API] Room creation blocked: active count (${activeCount}) reached limit of ${MAX_CONCURRENT_ROOMS}`);
            return NextResponse.json(
              {
                error: `All ${MAX_CONCURRENT_ROOMS} call channels are currently active. Please join an existing open room or wait a moment for a slot to free up!`,
                code: "ROOM_CAP_REACHED",
              },
              { status: 429 }
            );
          }
        }
      } catch (cErr) {
        console.warn("[Rooms API] Room count check warning:", cErr);
      }
    } else {
      if (roomStore.size >= MAX_CONCURRENT_ROOMS) {
        return NextResponse.json(
          {
            error: `All ${MAX_CONCURRENT_ROOMS} call channels are currently active. Please join an existing open room or wait a moment for a slot to free up!`,
            code: "ROOM_CAP_REACHED",
          },
          { status: 429 }
        );
      }
    }

    const uppercaseId = id.toUpperCase();
    const metadata: RoomMetadata = {
      id: uppercaseId,
      name: name?.trim() || `${(hostLang || "hi").toUpperCase()} ↔ ${(targetLang || "en").toUpperCase()} Lounge`,
      hostLang: hostLang || "hi",
      targetLang: targetLang || "en",
      hostProfile: hostProfile || undefined,
      createdAt: Date.now(),
    };

    if (redis) {
      try {
        // Active for up to 15 minutes while waiting for guest (renewed upon call entry)
        await redis.set(`room:${uppercaseId}:meta`, JSON.stringify(metadata), { ex: 900 });
        await redis.set(`room:${uppercaseId}:occupants`, 1, { ex: 900 });
        await redis.sadd("active_rooms", uppercaseId);
      } catch (rErr) {
        console.warn("[Rooms API] Redis write warning:", rErr);
      }
    }

    const entry = getOrCreateRoom(uppercaseId, metadata);
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = undefined;
    }

    return NextResponse.json({ ok: true, room: metadata });
  } catch (err) {
    console.error("[Rooms API] Error creating room:", err);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}
