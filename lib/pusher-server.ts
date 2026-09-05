import Pusher from "pusher";

let pusherServerInstance: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  if (pusherServerInstance) return pusherServerInstance;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap2";

  if (!appId || !key || !secret) {
    console.warn("[Pusher Server] Missing credentials in environment variables");
    return null;
  }

  try {
    pusherServerInstance = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });
    return pusherServerInstance;
  } catch (err) {
    console.error("[Pusher Server] Initialization failed:", err);
    return null;
  }
}
