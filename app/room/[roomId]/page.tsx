"use client";

import { Suspense, useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Room from "@/components/Room";

function RoomView() {
  const params = useParams();
  const searchParams = useSearchParams();

  const rawRoomId = params?.roomId;
  const roomId = typeof rawRoomId === "string" ? rawRoomId : Array.isArray(rawRoomId) ? rawRoomId[0] : "";
  const queryMyLang = searchParams.get("myLang");
  const queryTargetLang = searchParams.get("targetLang");
  const role = (searchParams.get("role") || "callee") as "caller" | "callee";

  const [resolvedLangs, setResolvedLangs] = useState<{ my: string; target: string } | null>(
    queryMyLang && queryTargetLang ? { my: queryMyLang, target: queryTargetLang } : null
  );

  useEffect(() => {
    if (resolvedLangs || !roomId) return;

    let cancelled = false;
    async function resolveRoomLangs() {
      try {
        const res = await fetch("/api/rooms", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const found = (data.rooms || []).find((r: any) => r.id?.toUpperCase() === roomId.toUpperCase());
          if (found && !cancelled) {
            // Callee speaks what host expects (targetLang) and listens to hostLang
            setResolvedLangs({
              my: found.targetLang || "en",
              target: found.hostLang || "hi",
            });
            return;
          }
        }
      } catch (e) {
        console.warn("[RoomPage] Failed to fetch room metadata for direct link:", e);
      }
      if (!cancelled) {
        setResolvedLangs({ my: "en", target: "hi" });
      }
    }

    resolveRoomLangs();
    return () => {
      cancelled = true;
    };
  }, [roomId, resolvedLangs]);

  if (!roomId || !resolvedLangs) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Loading Room...
      </div>
    );
  }

  return (
    <Room
      roomId={roomId.toUpperCase()}
      myLangCode={resolvedLangs.my}
      targetLangCode={resolvedLangs.target}
      role={role}
    />
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
          Loading Room...
        </div>
      }
    >
      <RoomView />
    </Suspense>
  );
}