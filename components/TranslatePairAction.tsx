"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUserProfile } from "@/lib/user-profile";

interface TranslatePairActionProps {
  fromCode: string;
  toCode: string;
  fromName: string;
  toName: string;
}

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function TranslatePairAction({
  fromCode,
  toCode,
  fromName,
  toName,
}: TranslatePairActionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleStartCall() {
    setLoading(true);
    const roomId = randomRoomId();
    const profile = getStoredUserProfile();

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: roomId,
          name: `${fromName} ⇄ ${toName} Live Lounge`,
          hostLang: fromCode,
          targetLang: toCode,
          hostProfile: {
            name: profile.name,
            avatar: profile.avatar,
            color: profile.color,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.code === "ROOM_CAP_REACHED" || data.error) {
          alert(data.error || "All 20 call channels are currently active. Please wait a minute for a slot to free up!");
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn("[TranslatePair] Pre-register room error:", e);
    }

    const targetUrl = `/room/${roomId}?myLang=${fromCode}&targetLang=${toCode}&role=caller`;
    router.push(targetUrl);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-md mt-4">
      <button
        onClick={handleStartCall}
        disabled={loading}
        className="w-full sm:flex-1 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 transition py-3.5 px-6 rounded-xl font-bold text-white shadow-lg shadow-indigo-900/40 cursor-pointer flex items-center justify-center gap-2 text-sm sm:text-base disabled:opacity-60"
      >
        <span>{loading ? "Starting Room..." : "🎙️ Start Voice Conversation"}</span>
        {!loading && <span>→</span>}
      </button>

      <a
        href="/"
        className="w-full sm:w-auto bg-gray-900 hover:bg-gray-800 border border-gray-800 transition py-3.5 px-5 rounded-xl text-sm font-semibold text-gray-300 text-center"
      >
        Browse Lobby
      </a>
    </div>
  );
}
