"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { findLanguage } from "@/lib/languages";
import { GeminiLiveSession } from "@/lib/gemini-live";
import { PeerManager, type ChatMessagePayload } from "@/lib/webrtc";
import { pcmToAudioBuffer, createTranslatedMediaStream } from "@/lib/audio-utils";
import { getStoredUserProfile, type UserProfile } from "@/lib/user-profile";
import type { UserProfileInfo } from "@/lib/room-store";
import ChatSidebar from "@/components/ChatSidebar";

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error" | "room_full";

interface RoomProps {
  roomId: string;
  myLangCode: string;
  targetLangCode: string;
  role: "caller" | "callee";
}

export default function Room({ roomId, myLangCode, targetLangCode, role }: RoomProps) {
  const myLang = findLanguage(myLangCode);
  const targetLang = findLanguage(targetLangCode);

  const [myProfile, setMyProfile] = useState<UserProfile>({
    name: "You",
    avatar: "🎙️",
    color: "indigo",
  });
  const [peerProfile, setPeerProfile] = useState<UserProfileInfo | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [webrtcState, setWebrtcState] = useState<string>("initializing");
  const [geminiConnected, setGeminiConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [peerTranscript, setPeerTranscript] = useState<string>("");
  const [showCaptions, setShowCaptions] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessagePayload[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const myTranscriptTimerRef = useRef<NodeJS.Timeout | null>(null);
  const peerTranscriptTimerRef = useRef<NodeJS.Timeout | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const geminiRef = useRef<GeminiLiveSession | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const enqueueRef = useRef<((buf: AudioBuffer) => void) | null>(null);
  const flushRef = useRef<(() => void) | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const receivingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load user profile on mount
  useEffect(() => {
    const p = getStoredUserProfile();
    setMyProfile(p);
  }, []);

  const cleanup = useCallback(() => {
    geminiRef.current?.disconnect();
    peerRef.current?.close();
    workletNodeRef.current?.disconnect();
    micSourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        setStatus("connecting");
        const currentProfile = getStoredUserProfile();

        // 1. Fetch ephemeral auth token from server
        const tokenRes = await fetch("/api/gemini-token");
        if (!tokenRes.ok) throw new Error("Could not fetch Gemini authentication token from server");
        const { token } = await tokenRes.json();

        if (cancelled) return;

        // 2. Mic permission with echo cancellation and AGC disabled
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
            sampleRate: 16000,
          },
          video: false,
        });
        micStreamRef.current = micStream;
        if (cancelled) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }

        // 3. AudioContext + AudioWorklet (Native 16kHz for Zero Resampling Latency)
        const ctx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        await ctx.audioWorklet.addModule("/audio-processor.worklet.js");

        const micSource = ctx.createMediaStreamSource(micStream);
        micSourceRef.current = micSource;

        const workletNode = new AudioWorkletNode(ctx, "audio-processor");
        workletNodeRef.current = workletNode;
        micSource.connect(workletNode);

        // 4. Translated audio output stream (fed by Gemini) -> WebRTC track
        const { stream: translatedStream, enqueue, flush } = createTranslatedMediaStream(ctx);
        enqueueRef.current = enqueue;
        flushRef.current = flush;

        // 5. Gemini Live session
        const gemini = new GeminiLiveSession(token);
        geminiRef.current = gemini;

        gemini.onAudioOutput((pcm, sampleRate) => {
          if (!audioCtxRef.current) return;
          setIsReceivingAudio(true);
          if (receivingTimeoutRef.current) clearTimeout(receivingTimeoutRef.current);
          receivingTimeoutRef.current = setTimeout(() => setIsReceivingAudio(false), 1200);

          const audioBuf = pcmToAudioBuffer(audioCtxRef.current, pcm, sampleRate);
          enqueueRef.current?.(audioBuf);
        });

        gemini.onTranscript((text) => {
          setLastTranscript((prev) => (prev ? `${prev} ${text}` : text).slice(-300));
          // Send translated subtitle to peer over WebRTC DataChannel (P2P, <5ms)
          peerRef.current?.sendCaption(text);

          if (myTranscriptTimerRef.current) clearTimeout(myTranscriptTimerRef.current);
          myTranscriptTimerRef.current = setTimeout(() => {
            setLastTranscript("");
          }, 6000);
        });

        gemini.onInterrupted(() => {
          console.log("[Room] Gemini Live Interrupted - Flushing audio queue");
          flushRef.current?.();
          setIsReceivingAudio(false);
        });

        gemini.onError((err) => {
          console.warn("[Room] Gemini Live warning:", err);
        });

        try {
          await gemini.connect(targetLang.bcp47, myLang.label, targetLang.label);
          setGeminiConnected(true);
        } catch (gErr) {
          console.warn("[Room] Gemini connection initial issue:", gErr);
        }

        if (cancelled) {
          gemini.disconnect();
          return;
        }

        // 6. Route mic worklet chunks -> Gemini Live API
        let speakTimer: NodeJS.Timeout | null = null;
        workletNode.port.onmessage = (evt) => {
          if (evt.data?.type === "audio" && !mutedRef.current) {
            if (evt.data.isSpeech) {
              setIsSpeaking(true);
              if (speakTimer) clearTimeout(speakTimer);
              speakTimer = setTimeout(() => setIsSpeaking(false), 300);
            }

            gemini.sendAudioChunk(evt.data.buffer);
          }
        };

        // 7. WebRTC Setup: Load dynamic TURN & STUN ICE servers
        let iceServers: RTCIceServer[] | undefined;
        try {
          const turnRes = await fetch("/api/turn-credentials");
          if (turnRes.ok) {
            const turnData = await turnRes.json();
            if (turnData.iceServers && Array.isArray(turnData.iceServers)) {
              iceServers = turnData.iceServers;
            }
          }
        } catch (turnErr) {
          console.warn("[Room] Could not load TURN credentials, fallback to default STUN:", turnErr);
        }

        const peer = new PeerManager(
          roomId,
          role,
          myLangCode,
          targetLangCode,
          {
            name: currentProfile.name,
            avatar: currentProfile.avatar,
            color: currentProfile.color,
          },
          iceServers
        );
        peerRef.current = peer;

        // Add the translated stream as our outgoing track to the other peer
        peer.addTranslatedTrack(translatedStream);

        peer.onRemoteStream((remoteStream) => {
          console.log("[Room] Received remote stream:", remoteStream.getAudioTracks());
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current
              .play()
              .then(() => console.log("[Room] Remote audio playback active!"))
              .catch((e) => console.warn("[Room] Autoplay blocked, click anywhere on screen to enable:", e));
          }
        });

        peer.onPeerProfile((prof) => {
          console.log("[Room] Peer profile updated:", prof);
          setPeerProfile(prof);
        });

        // Receive real-time subtitles from peer over DataChannel
        peer.onCaption((captionText) => {
          console.log("[Room] Peer caption received over DataChannel:", captionText);
          setPeerTranscript((prev) => (prev ? `${prev} ${captionText}` : captionText).slice(-300));
          if (peerTranscriptTimerRef.current) clearTimeout(peerTranscriptTimerRef.current);
          peerTranscriptTimerRef.current = setTimeout(() => {
            setPeerTranscript("");
          }, 6000);
        });

        // Receive real-time P2P chat messages and files over DataChannel
        peer.onChatMessage((chatMsg) => {
          console.log("[Room] Peer chat message received over DataChannel:", chatMsg);
          setChatMessages((prev) => [...prev, chatMsg]);
          setIsChatOpen((open) => {
            if (!open) {
              setUnreadCount((c) => c + 1);
            }
            return open;
          });
        });

        peer.onStatusChange((s) => {
          setWebrtcState(s);
          if (s === "room_full") {
            setStatus("room_full");
            setError("This room is already full (maximum 2 participants allowed).");
          } else if (s === "connected" || s === "completed") {
            setStatus("connected");
          } else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        });

        await peer.start();

      } catch (err) {
        if (!cancelled) {
          console.error("[Room] Setup error:", err);
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure AudioContext is resumed on user click anywhere
  const handleUserGesture = () => {
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    if (remoteAudioRef.current && remoteAudioRef.current.paused && remoteAudioRef.current.srcObject) {
      remoteAudioRef.current.play().catch(console.warn);
    }
  };

  const handleSendChatMessage = useCallback((text?: string, file?: ChatMessagePayload["file"]) => {
    const payload: ChatMessagePayload = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      sender: myProfile.name,
      senderAvatar: myProfile.avatar,
      senderColor: myProfile.color,
      text,
      file,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, payload]);
    peerRef.current?.sendChatMessage(payload);
  }, [myProfile]);

  function toggleMute() {
    handleUserGesture();
    const newMuted = !muted;
    setMuted(newMuted);
    mutedRef.current = newMuted;

    if (newMuted) {
      setIsSpeaking(false);
    }

    // Physically pause/resume mic stream at hardware/browser level
    if (micStreamRef.current) {
      micStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !newMuted;
      });
    }
  }

  function handleLeave() {
    try {
      fetch("/api/signal/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore */
    }
    cleanup();
    window.location.href = "/";
  }

  const statusColor: Record<ConnectionStatus, string> = {
    idle: "text-gray-400",
    connecting: "text-yellow-400",
    connected: "text-emerald-400",
    disconnected: "text-red-400",
    error: "text-red-500",
    room_full: "text-amber-500",
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    idle: "Idle",
    connecting: "Connecting… (Waiting for peer)",
    connected: "Connected (Live)",
    disconnected: "Disconnected",
    error: "Error",
    room_full: "Room Full",
  };

  return (
    <main
      onClick={handleUserGesture}
      className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-4 sm:p-6 gap-6 select-none cursor-pointer"
    >
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <a
          href="/"
          onClick={(e) => {
            e.stopPropagation();
            handleLeave();
          }}
          className="text-xs text-gray-400 hover:text-white mb-2 flex items-center gap-1.5 transition px-3 py-1 bg-gray-900 border border-gray-800 rounded-full"
        >
          <span>←</span> Back to Active Rooms Lobby
        </a>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">🎙️ LiveTranslate</h1>
        <p className="text-gray-400 text-xs sm:text-sm mt-1">
          Room: <span className="font-mono text-indigo-400 font-bold tracking-widest">{roomId}</span>
        </p>
      </div>

      {status === "room_full" ? (
        <div className="bg-gray-900 border border-amber-800/60 rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 text-center items-center shadow-xl">
          <div className="w-14 h-14 rounded-full bg-amber-950/80 border border-amber-700/50 flex items-center justify-center text-2xl">
            🔒
          </div>
          <h2 className="text-xl font-bold text-amber-300">Room is Full (2/2)</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            This room already has 2 participants chatting. For the best real-time translation experience, each room is strictly limited to 2 people.
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.location.href = "/";
            }}
            className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 transition py-2.5 rounded-xl font-semibold text-white shadow-lg cursor-pointer"
          >
            ← Choose Another Room in Lobby
          </button>
        </div>
      ) : (
        <>
          {/* Main card */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg flex flex-col gap-5 shadow-2xl">
            {/* Connection Status Bar */}
            <div className="flex justify-between items-center pb-3 border-b border-gray-800">
              <span className="text-xs text-gray-400 font-medium">Session Status</span>
              <span className={`text-xs font-semibold flex items-center gap-2 ${statusColor[status]}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-yellow-400"}`} />
                {statusLabel[status]}
              </span>
            </div>

            {/* Two Participants Profile Cards (Left = You, Right = Partner) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* You */}
              <div className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/60 flex flex-col justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-950 border border-indigo-700/60 flex items-center justify-center text-2xl shrink-0 shadow">
                    {myProfile.avatar}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block">You</span>
                    <p className="font-semibold text-white text-sm truncate max-w-[130px]">{myProfile.name}</p>
                  </div>
                </div>

                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-xs">
                  <span className="text-gray-400 text-[11px] block">You Speak:</span>
                  <span className="font-semibold text-indigo-300">{myLang.label}</span>
                </div>
              </div>

              {/* Partner */}
              <div className="bg-gray-800/60 p-4 rounded-xl border border-gray-700/60 flex flex-col justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-950 border border-emerald-700/60 flex items-center justify-center text-2xl shrink-0 shadow">
                    {peerProfile ? peerProfile.avatar : "👤"}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider block">Partner</span>
                    <p className="font-semibold text-white text-sm truncate max-w-[130px]">
                      {peerProfile ? peerProfile.name : "Waiting for partner..."}
                    </p>
                  </div>
                </div>

                <div className="bg-gray-900/80 p-2.5 rounded-lg border border-gray-800 text-xs">
                  <span className="text-gray-400 text-[11px] block">Partner Hears / Speaks:</span>
                  <span className="font-semibold text-emerald-300">{targetLang.label}</span>
                </div>
              </div>
            </div>

            {/* Live Audio Activity Indicators */}
            <div className="flex flex-col gap-2 pt-1 border-t border-gray-800/80">
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-400">Your Mic Input:</span>
                <span className={muted ? "text-red-400 font-medium" : isSpeaking ? "text-emerald-400 font-bold animate-pulse" : "text-gray-500"}>
                  {muted ? "Muted" : isSpeaking ? "🎤 Transmitting audio..." : "Listening..."}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-400">Gemini Live Translator:</span>
                <span className={geminiConnected ? (isReceivingAudio ? "text-indigo-400 font-bold animate-pulse" : "text-emerald-400 font-medium") : "text-yellow-400"}>
                  {!geminiConnected ? "Connecting to AI..." : isReceivingAudio ? "🔊 Translating & Streaming..." : "Ready"}
                </span>
              </div>

              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-400">WebRTC Peer:</span>
                <span className="font-mono text-gray-400">{webrtcState}</span>
              </div>
            </div>
          </div>

          {/* Pure YouTube / Google Meet Style Fixed Floating Subtitles (100% Zero DOM Layout Shift) */}
          <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-full max-w-2xl px-4 flex flex-col items-center gap-1.5 text-center">
            {showCaptions && peerTranscript && (
              <div className="transition-opacity duration-200">
                <span className="inline-block bg-black/80 backdrop-blur-sm text-white px-3.5 py-1.5 rounded-lg text-sm sm:text-base font-medium shadow-2xl leading-snug">
                  <span className="text-emerald-400 font-bold mr-1.5">{peerProfile ? peerProfile.name : "Partner"}:</span>
                  {peerTranscript}
                </span>
              </div>
            )}

            {showCaptions && lastTranscript && (
              <div className="transition-opacity duration-200">
                <span className="inline-block bg-black/80 backdrop-blur-sm text-white px-3.5 py-1.5 rounded-lg text-sm sm:text-base font-medium shadow-2xl leading-snug">
                  <span className="text-indigo-400 font-bold mr-1.5">You:</span>
                  {lastTranscript}
                </span>
              </div>
            )}
          </div>

          {/* Share room ID box for caller */}
          {role === "caller" && status !== "connected" && (
            <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-2xl p-4 w-full max-w-lg text-center">
              <p className="text-xs text-indigo-300 mb-1">Room is listed in the Lobby. You can also share the ID directly:</p>
              <p className="text-2xl font-mono font-bold tracking-widest text-indigo-400 select-all">{roomId}</p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 w-full max-w-lg text-sm text-red-300">
              ⚠️ {error}
            </div>
          )}

          {/* Controls Toolbar */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className={`px-5 py-3 rounded-xl font-semibold transition shadow-md cursor-pointer ${
                muted
                  ? "bg-gray-700 hover:bg-gray-600 text-white"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              {muted ? "🔇 Unmute Mic" : "🎤 Mute Mic"}
            </button>

            {/* Google Meet / YouTube style CC Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCaptions(!showCaptions);
              }}
              className={`px-4 py-3 rounded-xl font-semibold transition shadow-md cursor-pointer flex items-center gap-1.5 ${
                showCaptions
                  ? "bg-gray-800 hover:bg-gray-700 text-indigo-300 border border-indigo-500/40"
                  : "bg-gray-900 hover:bg-gray-800 text-gray-500 border border-gray-800"
              }`}
              title="Toggle Live Subtitles (CC)"
            >
              <span className="text-xs font-bold px-1 py-0.5 rounded bg-black/50 border border-current">CC</span>
              <span className="text-xs">{showCaptions ? "Captions ON" : "Captions OFF"}</span>
            </button>

            {/* In-Room P2P Chat Toggle Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsChatOpen(!isChatOpen);
                if (!isChatOpen) setUnreadCount(0);
              }}
              className={`px-4 py-3 rounded-xl font-semibold transition shadow-md cursor-pointer flex items-center gap-2 relative ${
                isChatOpen
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
              }`}
              title="Toggle Room Chat & Media"
            >
              <span>💬</span>
              <span className="text-xs">{isChatOpen ? "Chat Open" : "Chat"}</span>
              {!isChatOpen && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow animate-bounce">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLeave();
              }}
              className="px-5 py-3 rounded-xl font-semibold bg-red-700 hover:bg-red-600 transition text-white shadow-md cursor-pointer"
            >
              Leave Room
            </button>
          </div>
        </>
      )}

      {/* P2P In-Room Chat & File Sharing Drawer */}
      <ChatSidebar
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendChatMessage}
        currentUserName={myProfile.name}
      />

      {/* Audio element for receiving translated speech from remote peer */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudioRef} autoPlay playsInline />
    </main>
  );
}