import { NextRequest } from "next/server";
import { getOrCreateRoom, encodeSSE } from "@/lib/room-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("roomId");
  if (!roomId) {
    return new Response("Missing roomId", { status: 400 });
  }

  const room = getOrCreateRoom(roomId);

  const stream = new ReadableStream({
    start(controller) {
      console.log(`[Signal SSE] New subscriber connected for room: ${roomId}. Current queued events: ${room.queue.length}`);
      
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
        console.log(`[Signal SSE] Subscriber disconnected from room: ${roomId}`);
        clearInterval(keepalive);
        room.subscribers.delete(controller);
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