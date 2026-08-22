import { NextRequest } from "next/server";
import { getOrCreateRoom, encodeSSE, roomStore } from "@/lib/room-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  const myLang = req.nextUrl.searchParams.get("myLang");
  const targetLang = req.nextUrl.searchParams.get("targetLang");

  if (!roomId) {
    return new Response("Missing roomId", { status: 400 });
  }

  const uppercaseId = roomId.toUpperCase();
  const room = getOrCreateRoom(uppercaseId, {
    id: uppercaseId,
    hostLang: myLang || undefined,
    targetLang: targetLang || undefined,
  });

  // Cancel any pending cleanup timer when someone connects
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = undefined;
  }

  // Max 2 users per room rule
  if (room.subscribers.size >= 2) {
    console.warn(`[Signal SSE] Room ${uppercaseId} is full! Rejecting new subscriber.`);
    const fullStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encodeSSE({
            type: "room_full",
            payload: { message: "Room is full. Only 2 participants are allowed per room." },
            from: "system",
          })
        );
        controller.close();
      },
    });
    return new Response(fullStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      console.log(`[Signal SSE] New subscriber connected for room: ${uppercaseId}. Current subscribers: ${room.subscribers.size + 1}`);

      // Flush currently queued events for this room so late-joiners get the offer/ICE
      for (const event of room.queue) {
        controller.enqueue(encodeSSE(event));
      }

      room.subscribers.add(controller);

      // Keepalive ping every 15s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(": keepalive\n\n");
        } catch {
          clearInterval(keepalive);
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        console.log(`[Signal SSE] Subscriber disconnected from room: ${uppercaseId}`);
        clearInterval(keepalive);
        room.subscribers.delete(controller);

        // If no users are left in the room, schedule cleanup after 5 seconds
        if (room.subscribers.size === 0) {
          if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
          room.cleanupTimer = setTimeout(() => {
            if (room.subscribers.size === 0) {
              console.log(`[Signal SSE] Cleaning up empty room: ${uppercaseId}`);
              roomStore.delete(uppercaseId);
            }
          }, 5_000);
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