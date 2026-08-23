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
        for (const id of activeIds) {
          const metaRaw = await redis.get<string | RoomMetadata>(`room:${id}:meta`);
          if (!metaRaw) {
            // Clean up stale ID from active_rooms set
            await redis.srem("active_rooms", id);
            continue;
          }
          const meta: RoomMetadata = typeof metaRaw === "string" ? JSON.parse(metaRaw) : metaRaw;
          const occupants = Number(await redis.get(`room:${id}:occupants`)) || 1;

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
      if (entry.metadata && now - entry.metadata.createdAt < 15_000) {
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

    const uppercaseId = id.toUpperCase();
    const metadata: RoomMetadata = {
      id: uppercaseId,
      name: name?.trim() || `${(hostLang || "hi").toUpperCase()} ↔ ${(targetLang || "en").toUpperCase()} Lounge`,
      hostLang: hostLang || "hi",
      targetLang: targetLang || "en",
      hostProfile: hostProfile || undefined,
      createdAt: Date.now(),
    };

    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(`room:${uppercaseId}:meta`, JSON.stringify(metadata), { ex: 180 });
        await redis.set(`room:${uppercaseId}:occupants`, 1, { ex: 180 });
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
