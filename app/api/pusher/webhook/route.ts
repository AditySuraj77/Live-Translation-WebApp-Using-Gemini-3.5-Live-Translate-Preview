import { NextRequest, NextResponse } from "next/server";
import { getPusherServer } from "@/lib/pusher-server";
import { getRedis } from "@/lib/redis";
import { roomStore } from "@/lib/room-store";

export async function POST(req: NextRequest) {
  const pusher = getPusherServer();
  if (!pusher) {
    return NextResponse.json({ error: "Pusher not configured" }, { status: 500 });
  }

  try {
    const rawBody = await req.text();
    const webhookHeaders: Record<string, string> = {};
    req.headers.forEach((val, key) => {
      webhookHeaders[key.toLowerCase()] = val;
    });

    // Validate webhook signature from Pusher
    let webhook;
    try {
      webhook = pusher.webhook({
        headers: webhookHeaders,
        rawBody,
      });
    } catch {
      // If validation fails or headers missing, parse body safely
      webhook = { isValid: () => false, getEvents: () => [] };
    }

    let events: Array<{ name: string; channel: string }> = [];
    if (webhook.isValid()) {
      events = webhook.getEvents();
    } else {
      try {
        const parsed = JSON.parse(rawBody);
        events = parsed.events || [];
      } catch {
        return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
      }
    }

    const redis = getRedis();

    for (const evt of events) {
      const channelName = evt.channel;
      const match = channelName.match(/presence-room-(.+)/i);
      if (!match || !match[1]) continue;
      const roomId = match[1].toUpperCase();

      // Case 1: Entire channel vacated (all participants closed tabs or left)
      if (evt.name === "channel_vacated") {
        console.log(`[Pusher Webhook] Channel vacated: ${channelName}. Cleaning up room: ${roomId}`);
        if (redis) {
          try {
            await redis.del(
              `room:${roomId}:meta`,
              `room:${roomId}:occupants`,
              `room:${roomId}:presence:caller`,
              `room:${roomId}:presence:callee`,
              `room:${roomId}:offer`,
              `room:${roomId}:answer`,
              `room:${roomId}:ice:caller`,
              `room:${roomId}:ice:callee`,
              `room:${roomId}:profile:caller`,
              `room:${roomId}:profile:callee`,
              `room:${roomId}:peer_left`
            );
            await redis.srem("active_rooms", roomId);
          } catch (rErr) {
            console.warn(`[Pusher Webhook] Redis cleanup error for ${roomId}:`, rErr);
          }
        }
        roomStore.delete(roomId);
      }

      // Case 2: One member left (check remaining occupants)
      else if (evt.name === "member_removed") {
        console.log(`[Pusher Webhook] Member removed from ${channelName}`);
        try {
          const chRes = await pusher.get({
            path: `/channels/${channelName}`,
            params: { info: "user_count" },
          });
          if (chRes.status === 200) {
            const chInfo = (await chRes.json()) as { user_count?: number };
            const count = chInfo.user_count ?? 0;
            console.log(`[Pusher Webhook] Remaining occupants in ${roomId}:`, count);
            if (count === 0) {
              if (redis) {
                await redis.del(`room:${roomId}:meta`, `room:${roomId}:occupants`);
                await redis.srem("active_rooms", roomId);
              }
              roomStore.delete(roomId);
            } else if (count === 1) {
              // 1 member left in room -> set occupants = 1 (1/2 Waiting)
              if (redis) {
                await redis.set(`room:${roomId}:occupants`, 1, { ex: 21600 });
              }
            }
          }
        } catch (mErr) {
          console.warn(`[Pusher Webhook] member_removed check error for ${roomId}:`, mErr);
        }
      }

      // Case 3: Member added (2 people in room -> 2/2 Full)
      else if (evt.name === "member_added") {
        console.log(`[Pusher Webhook] Member added to ${channelName}`);
        if (redis) {
          try {
            await redis.set(`room:${roomId}:occupants`, 2, { ex: 21600 });
          } catch (aErr) {
            console.warn(`[Pusher Webhook] member_added update error for ${roomId}:`, aErr);
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[Pusher Webhook] Processing error:", err);
    return NextResponse.json({ error: "Webhook processing error" }, { status: 500 });
  }
}
