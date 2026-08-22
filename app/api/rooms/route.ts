import { NextRequest, NextResponse } from "next/server";
import { roomStore, getOrCreateRoom } from "@/lib/room-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const rooms = [];
  const now = Date.now();

  for (const [id, entry] of roomStore.entries()) {
    const occupants = entry.subscribers.size;

    // Filter out abandoned empty rooms older than 5 minutes
    if (occupants === 0 && entry.metadata && now - entry.metadata.createdAt > 300_000) {
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
      status: occupants >= 2 ? "full" : "open",
      createdAt: entry.metadata?.createdAt || now,
    });
  }

  // Sort: open rooms with 1 occupant first (active waiting), then by recency
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
    const entry = getOrCreateRoom(uppercaseId, {
      id: uppercaseId,
      name: name?.trim() || `${(hostLang || "hi").toUpperCase()} ↔ ${(targetLang || "en").toUpperCase()} Lounge`,
      hostLang: hostLang || "hi",
      targetLang: targetLang || "en",
      hostProfile: hostProfile || undefined,
      createdAt: Date.now(),
    });

    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = undefined;
    }

    return NextResponse.json({ ok: true, room: entry.metadata });
  } catch (err) {
    console.error("[Rooms API] Error creating room:", err);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}
