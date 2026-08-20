"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES } from "@/lib/languages";

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function LandingPage() {
  const router = useRouter();
  const [myLang, setMyLang] = useState("hi");
  const [targetLang, setTargetLang] = useState("en");
  const [joinId, setJoinId] = useState("");
  const [joinMyLang, setJoinMyLang] = useState("en");
  const [joinTargetLang, setJoinTargetLang] = useState("hi");

  function handleCreate() {
    const roomId = randomRoomId();
    router.push(
      `/room/${roomId}?myLang=${myLang}&targetLang=${targetLang}&role=caller`
    );
  }

  function handleJoin() {
    const id = joinId.trim().toUpperCase();
    if (!id) return;
    router.push(
      `/room/${id}?myLang=${joinMyLang}&targetLang=${joinTargetLang}&role=callee`
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 gap-10">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">🎙️ LiveTranslate</h1>
        <p className="text-gray-400 mt-2 text-sm">Real-time voice translation, peer-to-peer</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl">
        {/* Create Room */}
        <div className="flex-1 bg-gray-900 rounded-2xl p-6 flex flex-col gap-4 border border-gray-800">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-lg">Create a Room</h2>
            <span className="text-xs bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded font-mono">Peer 1 (Caller)</span>
          </div>
          <p className="text-xs text-gray-500">Creates a new room and gives you a Room ID to share with the other person.</p>
          <label className="flex flex-col gap-1 text-sm text-gray-400">
            I speak
            <select
              className="bg-gray-800 rounded-lg px-3 py-2 text-white border border-gray-700"
              value={myLang}
              onChange={(e) => setMyLang(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-400">
            They speak
            <select
              className="bg-gray-800 rounded-lg px-3 py-2 text-white border border-gray-700"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={handleCreate}
            className="mt-2 bg-indigo-600 hover:bg-indigo-500 transition rounded-xl py-2.5 font-semibold"
          >
            Create Room
          </button>
        </div>

        {/* Join Room */}
        <div className="flex-1 bg-gray-900 rounded-2xl p-6 flex flex-col gap-4 border border-gray-800">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-lg">Join a Room</h2>
            <span className="text-xs bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded font-mono">Peer 2 (Callee)</span>
          </div>
          <p className="text-xs text-gray-500">Paste the Room ID created by Peer 1 to connect both peers.</p>
          <label className="flex flex-col gap-1 text-sm text-gray-400">
            Room ID
            <input
              className="bg-gray-800 rounded-lg px-3 py-2 text-white uppercase tracking-widest border border-gray-700 focus:border-emerald-500 outline-none"
              placeholder="e.g. ABC123"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              maxLength={6}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-400">
            I speak
            <select
              className="bg-gray-800 rounded-lg px-3 py-2 text-white border border-gray-700"
              value={joinMyLang}
              onChange={(e) => setJoinMyLang(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-400">
            They speak
            <select
              className="bg-gray-800 rounded-lg px-3 py-2 text-white border border-gray-700"
              value={joinTargetLang}
              onChange={(e) => setJoinTargetLang(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <button
            onClick={handleJoin}
            disabled={!joinId.trim()}
            className="mt-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition rounded-xl py-2.5 font-semibold"
          >
            Join Room
          </button>
        </div>
      </div>
    </main>
  );
}