import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoom, encodeSSE, type SignalEvent } from "@/lib/room-store";

export async function POST(req: NextRequest) {
  try {
    const { roomId, type, payload, from } = await req.json();
    if (!roomId || !type || !from) {
      return NextResponse.json({ error: "Missing roomId, type, or from" }, { status: 400 });
    }

    const event: SignalEvent = { type, payload, from };
    const room = getOrCreateRoom(roomId);

    console.log(`[Signal POST] Room: ${roomId}, Event: ${type}, From: ${from}, Subscribers: ${room.subscribers.size}`);

    // If caller sends offer and callee hasn't joined or closed, store/keep it
    if (type === "offer") {
      // replace any previous offer in queue
      room.queue = room.queue.filter((e) => e.type !== "offer");
      room.queue.push(event);
    } else if (type === "answer") {
      room.queue.push(event);
    } else if (type === "ice") {
      room.queue.push(event);
    }

    // Broadcast to any active subscribers
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