import { NextRequest, NextResponse } from "next/server";
import { getPusherServer } from "@/lib/pusher-server";
import { getRedis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const pusher = getPusherServer();
  if (!pusher) {
    return NextResponse.json({ error: "Pusher not configured" }, { status: 500 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let socketId = "";
    let channelName = "";

    if (contentType.includes("application/json")) {
      const body = await req.json();
      socketId = body.socket_id;
      channelName = body.channel_name;
    } else {
      const formData = await req.formData();
      socketId = formData.get("socket_id") as string;
      channelName = formData.get("channel_name") as string;
    }

    if (!socketId || !channelName) {
      return NextResponse.json({ error: "Missing socket_id or channel_name" }, { status: 400 });
    }

    // Check channel occupancy to prevent more than 2 members in the room
    try {
      const res = await pusher.get({
        path: `/channels/${channelName}`,
        params: { info: "user_count" },
      });
      if (res.status === 200) {
        const info = (await res.json()) as { user_count?: number };
        if (typeof info?.user_count === "number") {
          if (info.user_count >= 2) {
            return NextResponse.json({ error: "Room is full (max 2 occupants)" }, { status: 403 });
          }
          // If 1 person is already in channel, this incoming 2nd user makes room 2/2 Full instantly
          if (info.user_count === 1) {
            const match = channelName.match(/presence-room-(.+)/i);
            if (match && match[1]) {
              const redis = getRedis();
              if (redis) {
                await redis.set(`room:${match[1].toUpperCase()}:occupants`, 2, { ex: 21600 });
              }
            }
          }
        }
      }
    } catch {
      // Channel may not exist yet, allow first subscriber
    }

    // Generate ephemeral presence session ID
    const userId = `user_${Math.random().toString(36).substring(2, 9)}`;
    const presenceData = {
      user_id: userId,
      user_info: {
        joinedAt: Date.now(),
      },
    };

    const authResponse = pusher.authorizeChannel(socketId, channelName, presenceData);
    return NextResponse.json(authResponse);
  } catch (err) {
    console.error("[Pusher Auth] Error during channel authorization:", err);
    return NextResponse.json({ error: "Authorization failed" }, { status: 500 });
  }
}
