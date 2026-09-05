import { NextRequest, NextResponse } from "next/server";
import { roomStore, getOrCreateRoom, RoomMetadata } from "@/lib/room-store";
import { getRedis } from "@/lib/redis";

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

    const MAX_CONCURRENT_ROOMS = 20;
    const redis = getRedis();

    // Enforce 20 concurrent active rooms limit
    if (redis) {
      try {
        const activeCount = await redis.scard("active_rooms");
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
        // Active for up to 6 hours; Pusher channel_vacated webhook deletes it immediately upon exit
        await redis.set(`room:${uppercaseId}:meta`, JSON.stringify(metadata), { ex: 21600 });
        await redis.set(`room:${uppercaseId}:occupants`, 1, { ex: 21600 });
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
