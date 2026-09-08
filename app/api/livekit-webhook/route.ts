import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { getRedis } from "@/lib/redis";
import { roomStore } from "@/lib/room-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "LiveKit credentials (LIVEKIT_API_KEY, LIVEKIT_API_SECRET) not configured" },
        { status: 500 }
      );
    }

    const rawBody = await req.text();
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
    }

    const receiver = new WebhookReceiver(apiKey, apiSecret);
    let event;
    try {
      event = await receiver.receive(rawBody, authHeader);
    } catch (err) {
      console.warn("[LiveKit Webhook] Signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const eventName = event.event;
    const roomName = event.room?.name?.toUpperCase();

    if (!roomName) {
      return NextResponse.json({ ok: true, ignored: "No room name" });
    }

    console.log(`[LiveKit Webhook] Received event '${eventName}' for room '${roomName}'`);

    const redis = getRedis();

    // 1. Entire room finished or closed
    if (eventName === "room_finished") {
      console.log(`[LiveKit Webhook] Room finished: ${roomName}. Cleaning up all room data.`);
      if (redis) {
        await redis.del(
          `room:${roomName}:meta`,
          `room:${roomName}:occupants`,
          `room:${roomName}:presence:caller`,
          `room:${roomName}:presence:callee`,
          `room:${roomName}:offer`,
          `room:${roomName}:answer`,
          `room:${roomName}:ice:caller`,
          `room:${roomName}:ice:callee`,
          `room:${roomName}:profile:caller`,
          `room:${roomName}:profile:callee`,
          `room:${roomName}:peer_left`
        );
        await redis.srem("active_rooms", roomName);
      }
      roomStore.delete(roomName);
      return NextResponse.json({ ok: true, handled: "room_finished" });
    }

    // 2. Participant disconnected / sudden power-cut / battery death / internet loss
    if (eventName === "participant_left") {
      const identity = event.participant?.identity || "";
      const isCaller = identity.startsWith("caller");
      const isCallee = identity.startsWith("callee");

      console.log(`[LiveKit Webhook] Participant left: ${identity} in room ${roomName}`);

      if (isCaller) {
        // Host disconnected / died -> delete room permanently so lobby stays clean
        console.log(`[LiveKit Webhook] Host (${identity}) left. Removing room ${roomName} from active rooms.`);
        if (redis) {
          await redis.del(
            `room:${roomName}:meta`,
            `room:${roomName}:occupants`,
            `room:${roomName}:presence:caller`,
            `room:${roomName}:presence:callee`,
            `room:${roomName}:offer`,
            `room:${roomName}:answer`,
            `room:${roomName}:ice:caller`,
            `room:${roomName}:ice:callee`,
            `room:${roomName}:profile:caller`,
            `room:${roomName}:profile:callee`,
            `room:${roomName}:peer_left`
          );
          await redis.srem("active_rooms", roomName);
        }
        roomStore.delete(roomName);
        return NextResponse.json({ ok: true, handled: "host_left_room_deleted" });
      }

      if (isCallee) {
        // Guest disconnected -> Host is still in room, so update lobby to 1/2 Waiting
        console.log(`[LiveKit Webhook] Guest (${identity}) left. Updating room ${roomName} to 1/2 Waiting.`);
        if (redis) {
          await redis.del(
            `room:${roomName}:presence:callee`,
            `room:${roomName}:answer`,
            `room:${roomName}:ice:callee`,
            `room:${roomName}:profile:callee`
          );
          await redis.set(`room:${roomName}:occupants`, 1, { ex: 21600 });
        }
        return NextResponse.json({ ok: true, handled: "guest_left_occupants_reset" });
      }
    }

    // 3. Participant joined
    if (eventName === "participant_joined") {
      const identity = event.participant?.identity || "";
      if (identity.startsWith("callee")) {
        console.log(`[LiveKit Webhook] Guest joined: setting occupants = 2 for ${roomName}`);
        if (redis) {
          await redis.set(`room:${roomName}:occupants`, 2, { ex: 21600 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[LiveKit Webhook] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error processing webhook" }, { status: 500 });
  }
}
