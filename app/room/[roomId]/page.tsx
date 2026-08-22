"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Room from "@/components/Room";

function RoomView() {
  const params = useParams();
  const searchParams = useSearchParams();

  const rawRoomId = params?.roomId;
  const roomId = typeof rawRoomId === "string" ? rawRoomId : Array.isArray(rawRoomId) ? rawRoomId[0] : "";
  const myLang = searchParams.get("myLang") || "hi";
  const targetLang = searchParams.get("targetLang") || "en";
  const role = (searchParams.get("role") || "callee") as "caller" | "callee";

  if (!roomId) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Loading Room...
      </div>
    );
  }

  return (
    <Room
      roomId={roomId.toUpperCase()}
      myLangCode={myLang}
      targetLangCode={targetLang}
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