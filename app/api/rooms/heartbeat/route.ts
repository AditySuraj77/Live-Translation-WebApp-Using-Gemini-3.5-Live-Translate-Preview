import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  // Presence and lifecycle are now managed by Pusher Presence channels and webhooks.
  // This endpoint returns immediate success without consuming Redis commands.
  return NextResponse.json({ ok: true, managedBy: "pusher" });
}
