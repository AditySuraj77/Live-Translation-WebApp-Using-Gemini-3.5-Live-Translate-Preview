"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LANGUAGES, findLanguage } from "@/lib/languages";
import {
  getStoredUserProfile,
  saveStoredUserProfile,
  AVATAR_OPTIONS,
  COLOR_OPTIONS,
  type UserProfile,
} from "@/lib/user-profile";

interface RoomInfo {
  id: string;
  name: string;
  hostLang: string;
  targetLang: string;
  hostProfile?: {
    name: string;
    avatar: string;
    color?: string;
  };
  occupants: number;
  maxOccupants: number;
  status: "open" | "full";
  createdAt: number;
}

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function LandingPage() {
  const router = useRouter();

  // Current user profile state
  const [profile, setProfile] = useState<UserProfile>({
    name: "Guest User",
    avatar: "👤",
    color: "indigo",
  });
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("🦊");
  const [editColor, setEditColor] = useState("indigo");

  // Active rooms list state
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Create room modal / state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomTitle, setRoomTitle] = useState("");
  const [myLang, setMyLang] = useState("hi");
  const [targetLang, setTargetLang] = useState("en");
  const [isCreating, setIsCreating] = useState(false);

  // Manual join fallback state
  const [showManualJoin, setShowManualJoin] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [joinMyLang, setJoinMyLang] = useState("en");
  const [joinTargetLang, setJoinTargetLang] = useState("hi");

  // Load profile on mount
  useEffect(() => {
    const current = getStoredUserProfile();
    setProfile(current);
    setEditName(current.name);
    setEditAvatar(current.avatar);
    setEditColor(current.color || "indigo");
  }, []);

  function handleSaveProfile() {
    if (!editName.trim()) return;
    const updated: UserProfile = {
      name: editName.trim(),
      avatar: editAvatar,
      color: editColor,
    };
    saveStoredUserProfile(updated);
    setProfile(updated);
    setShowProfileModal(false);
  }

  // Fetch active rooms from server
  const fetchRooms = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setRooms(data.rooms || []);
      }
    } catch (err) {
      console.warn("[Landing] Failed to fetch active rooms:", err);
    } finally {
      setLoadingRooms(false);
      if (isManual) setTimeout(() => setIsRefreshing(false), 500);
    }
  }, []);

  // Poll active rooms every 4 seconds
  useEffect(() => {
    fetchRooms();
    const interval = setInterval(() => {
      fetchRooms();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  // Create room handler
  async function handleCreate() {
    setIsCreating(true);
    const roomId = randomRoomId();
    const myLangObj = findLanguage(myLang);
    const targetLangObj = findLanguage(targetLang);
    const finalTitle =
      roomTitle.trim() || `${profile.name}'s ${myLangObj.label} Lounge`;

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: roomId,
          name: finalTitle,
          hostLang: myLang,
          targetLang: targetLang,
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
          setIsCreating(false);
          return;
        }
      }
    } catch (e) {
      console.warn("[Landing] Could not register room metadata ahead:", e);
    }

    const roomUrl = `/room/${roomId}?myLang=${myLang}&targetLang=${targetLang}&role=caller`;
    setIsCreating(false);
    setShowCreateModal(false);
    fetchRooms(true);

    const newTab = window.open(roomUrl, "_blank");
    if (!newTab) {
      router.push(roomUrl);
    }
  }

  // 1-Click Join handler from Free4Talk room card (opens in new tab)
  function handleQuickJoin(room: RoomInfo) {
    if (room.occupants >= 2) return;
    // Auto-align: guest speaks what the host is expecting (targetLang) and wants to hear hostLang
    const guestMyLang = room.targetLang;
    const guestTargetLang = room.hostLang;
    const roomUrl = `/room/${room.id}?myLang=${guestMyLang}&targetLang=${guestTargetLang}&role=callee`;

    const newTab = window.open(roomUrl, "_blank");
    if (!newTab) {
      router.push(roomUrl);
    }
  }

  // Manual join handler (opens in new tab)
  function handleManualJoin() {
    const id = joinId.trim().toUpperCase();
    if (!id) return;

    const existing = rooms.find((r) => r.id.toUpperCase() === id);
    if (existing && existing.occupants >= 2) {
      alert("This room is already full (2/2 participants). Please wait or choose another room.");
      return;
    }

    // Auto-align languages if joining an existing room:
    // Guest speaks host's target language, and hears host's native language
    const finalMyLang = existing ? existing.targetLang : joinMyLang;
    const finalTargetLang = existing ? existing.hostLang : joinTargetLang;

    const roomUrl = `/room/${id}?myLang=${finalMyLang}&targetLang=${finalTargetLang}&role=callee`;
    setShowManualJoin(false);

    const newTab = window.open(roomUrl, "_blank");
    if (!newTab) {
      router.push(roomUrl);
    }
  }

  const filteredRooms = rooms.filter((r) => {
    // Only display active rooms that have real occupants
    if (r.occupants === 0) return false;
    const host = findLanguage(r.hostLang).label.toLowerCase();
    const target = findLanguage(r.targetLang).label.toLowerCase();
    const hostName = (r.hostProfile?.name || "").toLowerCase();
    const q = searchQuery.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      host.includes(q) ||
      target.includes(q) ||
      hostName.includes(q)
    );
  });

  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center p-4 sm:p-8">
      {/* Top Navigation Bar */}
      <header className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 border-b border-gray-800/80 mb-6 sm:mb-8 gap-4">
        <div className="flex items-center gap-3.5">
          <img
            src="/logo.jpg"
            alt="LinguaLive Logo"
            className="w-10 h-10 rounded-xl border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.25)] object-cover"
          />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-emerald-300 bg-clip-text text-transparent">
              LinguaLive
            </h1>
            <p className="text-xs text-gray-400">
              Real-Time 1-to-1 Voice Translation Lounge
            </p>
          </div>
        </div>

        {/* User Profile Badge & Action Buttons */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
          <button
            onClick={() => {
              setEditName(profile.name);
              setEditAvatar(profile.avatar);
              setEditColor(profile.color || "indigo");
              setShowProfileModal(true);
            }}
            className="flex-1 sm:flex-none flex items-center gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-700/80 px-3 py-2 rounded-xl transition text-sm cursor-pointer shadow-sm group min-w-0"
            title="Click to change your name and avatar"
          >
            <span className="text-xl leading-none shrink-0">{profile.avatar}</span>
            <div className="flex flex-col text-left min-w-0">
              <span className="font-semibold text-white leading-tight flex items-center gap-1 truncate text-xs sm:text-sm">
                <span className="truncate">{profile.name}</span>
                <span className="text-[10px] text-gray-400 group-hover:text-indigo-400 shrink-0">✎</span>
              </span>
              <span className="text-[10px] text-emerald-400">Online Profile</span>
            </div>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 transition px-3.5 sm:px-4 py-2.5 rounded-xl font-semibold text-xs sm:text-sm shadow-lg shadow-indigo-900/30 cursor-pointer whitespace-nowrap"
          >
            <span className="text-base sm:text-lg font-bold leading-none">+</span>
            <span>Create Room</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="w-full max-w-5xl flex flex-col gap-6">
        {/* Controls Bar: Search + Filter + Refresh */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-gray-900/70 border border-gray-800 p-4 rounded-2xl">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search by topic, host name, language or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800/90 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2.5 text-xs text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 justify-between sm:justify-end">
            <span className="text-xs text-gray-400">
              {filteredRooms.length} Active {filteredRooms.length === 1 ? "Room" : "Rooms"}
            </span>
            <button
              onClick={() => fetchRooms(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-2 rounded-xl transition text-gray-300 disabled:opacity-50 cursor-pointer"
              title="Refresh active rooms"
            >
              <span className={isRefreshing ? "animate-spin" : ""}>🔄</span>
              <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </button>
          </div>
        </div>

        {/* Free4Talk-Style Active Rooms Grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>Active Public Rooms</span>
              <span className="text-xs bg-indigo-950 text-indigo-400 border border-indigo-800/60 px-2 py-0.5 rounded-full font-mono">
                1-to-1 Voice
              </span>
            </h2>
            <span className="text-xs text-gray-500">Auto-refreshes live</span>
          </div>

          {loadingRooms ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-gray-900/40 border border-gray-800/60 rounded-2xl p-5 h-44 animate-pulse flex flex-col justify-between"
                >
                  <div className="h-4 bg-gray-800 rounded w-2/3" />
                  <div className="h-8 bg-gray-800/60 rounded w-full" />
                  <div className="h-9 bg-gray-800 rounded w-full" />
                </div>
              ))}
            </div>
          ) : filteredRooms.length === 0 ? (
            /* Empty State */
            <div className="bg-gray-900/40 border border-dashed border-gray-800 rounded-2xl p-10 flex flex-col items-center justify-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center text-2xl">
                🌐
              </div>
              <div>
                <h3 className="font-semibold text-lg text-white">
                  {searchQuery ? "No rooms match your search" : "No Active Rooms Right Now"}
                </h3>
                <p className="text-sm text-gray-400 mt-1 max-w-sm">
                  {searchQuery
                    ? "Try clearing the search query or create a new room."
                    : "Create a room now! It will appear here and anyone can click to join you."}
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-2 bg-indigo-600 hover:bg-indigo-500 transition px-5 py-2.5 rounded-xl font-semibold text-sm shadow-md"
              >
                + Create First Room
              </button>
            </div>
          ) : (
            /* Room Cards Grid */
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRooms.map((room) => {
                const hostLang = findLanguage(room.hostLang);
                const targetLang = findLanguage(room.targetLang);
                const isFull = room.occupants >= 2;
                const isWaiting = room.occupants === 1;
                const hostName = room.hostProfile?.name || "Host";
                const hostAvatar = room.hostProfile?.avatar || "👤";

                return (
                  <div
                    key={room.id}
                    className={`bg-gray-900 border transition rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-lg ${
                      isFull
                        ? "border-gray-800/60 opacity-75"
                        : "border-gray-800 hover:border-indigo-500/50"
                    }`}
                  >
                    {/* Room Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center text-xl shadow-inner shrink-0">
                          {hostAvatar}
                        </div>
                        <div>
                          <h3 className="font-semibold text-white text-base line-clamp-1">
                            {room.name}
                          </h3>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Host: <span className="text-gray-200 font-medium">{hostName}</span>
                          </p>
                        </div>
                      </div>

                      {/* Capacity Badge */}
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                          isFull
                            ? "bg-amber-950/70 text-amber-300 border border-amber-800/50"
                            : isWaiting
                            ? "bg-emerald-950/70 text-emerald-300 border border-emerald-800/50"
                            : "bg-gray-800 text-gray-400 border border-gray-700"
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isFull
                              ? "bg-amber-400"
                              : isWaiting
                              ? "bg-emerald-400 animate-ping"
                              : "bg-gray-400"
                          }`}
                        />
                        {isFull ? "2/2 Full" : isWaiting ? "1/2 Waiting" : "0/2 Open"}
                      </span>
                    </div>

                    {/* Language Translation Flow Badge */}
                    <div className="bg-gray-950/70 border border-gray-800/80 rounded-xl p-3 flex items-center justify-between text-xs gap-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-gray-500 text-[11px] truncate">Host Speaks</span>
                        <span className="font-semibold text-indigo-300 truncate">
                          {hostLang.label}
                        </span>
                      </div>

                      <span className="text-gray-500 font-bold shrink-0">⇄</span>

                      <div className="flex flex-col text-right min-w-0">
                        <span className="text-emerald-400 font-medium text-[11px] truncate">👉 You Will Speak</span>
                        <span className="font-semibold text-emerald-300 truncate">
                          {targetLang.label}
                        </span>
                      </div>
                    </div>

                    {/* Join Button */}
                    <button
                      onClick={() => handleQuickJoin(room)}
                      disabled={isFull}
                      className={`w-full py-2.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 shadow-md ${
                        isFull
                          ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                          : "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                      }`}
                    >
                      {isFull ? (
                        <>
                          <span>🔒</span>
                          <span>In Conversation (Full)</span>
                        </>
                      ) : (
                        <>
                          <span>💬</span>
                          <span>Join as {targetLang.label.split(" ")[0]} Speaker</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Collapsible: Manual Room ID Entry (Private fallback) */}
        <div className="border border-gray-800/80 bg-gray-900/30 rounded-2xl overflow-hidden mt-4">
          <button
            onClick={() => setShowManualJoin(!showManualJoin)}
            className="w-full px-5 py-3.5 flex justify-between items-center text-sm font-medium text-gray-400 hover:text-white transition cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span>🔑</span>
              <span>Have a private Room ID? Click here to join manually</span>
            </span>
            <span>{showManualJoin ? "▲" : "▼"}</span>
          </button>

          {showManualJoin && (
            <div className="p-5 border-t border-gray-800 bg-gray-900/60 flex flex-col sm:flex-row items-end gap-4">
              <label className="flex-1 flex flex-col gap-1 text-xs text-gray-400 w-full">
                Room ID
                <input
                  className="bg-gray-800 rounded-lg px-3 py-2 text-white uppercase tracking-widest border border-gray-700 focus:border-indigo-500 outline-none text-sm"
                  placeholder="e.g. ABC123"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  maxLength={6}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-400 w-full sm:w-40">
                I speak
                <select
                  className="bg-gray-800 rounded-lg px-3 py-2 text-white border border-gray-700 text-sm"
                  value={joinMyLang}
                  onChange={(e) => setJoinMyLang(e.target.value)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-400 w-full sm:w-40">
                They speak
                <select
                  className="bg-gray-800 rounded-lg px-3 py-2 text-white border border-gray-700 text-sm"
                  value={joinTargetLang}
                  onChange={(e) => setJoinTargetLang(e.target.value)}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={handleManualJoin}
                disabled={!joinId.trim()}
                className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition px-6 py-2 rounded-lg font-semibold text-sm h-9 flex items-center justify-center cursor-pointer"
              >
                Join
              </button>
            </div>
          )}
        </div>

        {/* Popular Language Pairs for Voice Translation (SEO & Fast Access) */}
        <div className="border-t border-gray-800/80 pt-6 mt-2">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Popular Live Voice Translation Pairs
            </h3>
            <span className="text-[11px] text-gray-500">70+ Languages</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { slug: "english-to-spanish", label: "English ⇄ Spanish" },
              { slug: "hindi-to-english", label: "Hindi ⇄ English" },
              { slug: "english-to-french", label: "English ⇄ French" },
              { slug: "english-to-german", label: "English ⇄ German" },
              { slug: "english-to-japanese", label: "English ⇄ Japanese" },
              { slug: "english-to-arabic", label: "English ⇄ Arabic" },
              { slug: "english-to-portuguese", label: "English ⇄ Portuguese" },
              { slug: "english-to-russian", label: "English ⇄ Russian" },
              { slug: "english-to-chinese", label: "English ⇄ Chinese" },
              { slug: "hindi-to-bengali", label: "Hindi ⇄ Bengali" },
              { slug: "hindi-to-tamil", label: "Hindi ⇄ Tamil" },
              { slug: "hindi-to-telugu", label: "Hindi ⇄ Telugu" },
            ].map((p) => (
              <a
                key={p.slug}
                href={`/translate/${p.slug}`}
                className="text-xs bg-gray-900/60 hover:bg-gray-800 border border-gray-800 hover:border-indigo-500/40 text-gray-400 hover:text-indigo-300 px-3 py-1.5 rounded-lg transition"
              >
                {p.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-4 sm:gap-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-bold text-lg text-white">Your Profile</h2>
                <p className="text-xs text-gray-400">
                  Others in the room and lobby will see this name & avatar.
                </p>
              </div>
              <button
                onClick={() => setShowProfileModal(false)}
                className="text-gray-400 hover:text-white text-lg p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm text-gray-300">
                <span>Display Name</span>
                <input
                  type="text"
                  placeholder="e.g. Aditya, John, Sarah..."
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  maxLength={30}
                />
              </label>

              <div>
                <span className="text-sm text-gray-300 block mb-2">Choose Avatar</span>
                <div className="grid grid-cols-5 gap-2 bg-gray-950 p-3 rounded-xl border border-gray-800 max-h-36 overflow-y-auto">
                  {AVATAR_OPTIONS.map((av) => (
                    <button
                      key={av}
                      type="button"
                      onClick={() => setEditAvatar(av)}
                      className={`text-2xl p-2 rounded-lg transition ${
                        editAvatar === av
                          ? "bg-indigo-600 border border-indigo-400 scale-110"
                          : "hover:bg-gray-800"
                      }`}
                    >
                      {av}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 transition py-2.5 rounded-xl text-sm font-semibold text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!editName.trim()}
                onClick={handleSaveProfile}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 transition py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg disabled:opacity-50"
              >
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-4 sm:gap-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-bold text-lg text-white">Create a New Room</h2>
                <p className="text-xs text-gray-400">
                  Hosted by <span className="text-indigo-400 font-semibold">{profile.avatar} {profile.name}</span>
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-white text-lg p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm text-gray-300">
                <span>Room Topic / Title (Optional)</span>
                <input
                  type="text"
                  placeholder="e.g. Casual English Practice, Tech Talk..."
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  maxLength={50}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm text-gray-300">
                  <span>I speak</span>
                  <select
                    className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                    value={myLang}
                    onChange={(e) => setMyLang(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1.5 text-sm text-gray-300">
                  <span>Partner speaks</span>
                  <select
                    className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="bg-indigo-950/40 border border-indigo-900/60 rounded-xl p-3 text-xs text-indigo-300">
                ℹ️ <strong>Note:</strong> Maximum 2 participants allowed in the room to ensure real-time translation performance with Gemini Live API.
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 transition py-2.5 rounded-xl text-sm font-semibold text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isCreating}
                onClick={handleCreate}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 transition py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create & Enter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}