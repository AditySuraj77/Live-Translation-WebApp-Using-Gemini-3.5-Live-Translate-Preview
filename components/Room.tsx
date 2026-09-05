"use client";

import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { findLanguage } from "@/lib/languages";
import { GeminiLiveSession } from "@/lib/gemini-live";
import { PeerManager, type ChatMessagePayload, type UserLocation } from "@/lib/webrtc";
import { pcmToAudioBuffer, createTranslatedMediaStream } from "@/lib/audio-utils";
import { getStoredUserProfile, type UserProfile } from "@/lib/user-profile";
import type { UserProfileInfo } from "@/lib/room-store";
import ChatSidebar from "@/components/ChatSidebar";

const ConnectionGlobeModal = lazy(() => import("@/components/ConnectionGlobeModal"));

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error" | "room_full";

interface RoomProps {
  roomId: string;
  myLangCode: string;
  targetLangCode: string;
  role: "caller" | "callee";
}

interface FriendlyError {
  title: string;
  description: string;
  type: "network" | "mic" | "full" | "general";
  canRetry: boolean;
}

function parseFriendlyError(raw: string): FriendlyError {
  const lower = raw.toLowerCase();
  if (
    lower.includes("fetch") ||
    lower.includes("token") ||
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  ) {
    return {
      title: "📶 Connection Problem",
      description: "Unable to reach the live translator. Please check your Wi-Fi or mobile data.",
      type: "network",
      canRetry: true,
    };
  }
  if (
    lower.includes("permission") ||
    lower.includes("notallowederror") ||
    lower.includes("microphone") ||
    lower.includes("getusermedia")
  ) {
    return {
      title: "🎙️ Microphone Access Required",
      description: "Please allow microphone permission in your browser settings to speak and translate.",
      type: "mic",
      canRetry: true,
    };
  }
  if (lower.includes("full") || lower.includes("room_full")) {
    return {
      title: "🔒 Room is Full (2/2)",
      description: "This room already has 2 participants chatting. Please choose or create another room.",
      type: "full",
      canRetry: false,
    };
  }
  return {
    title: "⚠️ Something went wrong",
    description: raw || "An unexpected issue occurred. Click below to retry.",
    type: "general",
    canRetry: true,
  };
}

export default function Room({ roomId, myLangCode, targetLangCode, role }: RoomProps) {
  const myLang = findLanguage(myLangCode);
  const targetLang = findLanguage(targetLangCode);

  const [myProfile, setMyProfile] = useState<UserProfile>({
    name: "Me",
    avatar: "👤",
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
  const [isPeerSpeaking, setIsPeerSpeaking] = useState(false);
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [peerTranscript, setPeerTranscript] = useState<string>("");
  const [showCaptions, setShowCaptions] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isGlobeOpen, setIsGlobeOpen] = useState(false);
  const [myLocation, setMyLocation] = useState<UserLocation | null>(null);
  const myLocationRef = useRef<UserLocation | null>(null);
  const [peerLocation, setPeerLocation] = useState<UserLocation | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessagePayload[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const hasLeftRef = useRef(false);
  const [callDuration, setCallDuration] = useState(0);

  // Active call duration timer — runs only while both participants are connected
  useEffect(() => {
    if (status !== "connected") {
      setCallDuration(0);
      return;
    }
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

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
  const freshTokenRef = useRef<string | null>(null);
  const tokenRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isReconnectingGeminiRef = useRef(false);

  // Load user profile & fetch user geolocation on mount & auto-retry on internet reconnect
  useEffect(() => {
    const p = getStoredUserProfile();
    setMyProfile(p);

    async function fetchLocation() {
      try {
        const cacheKey = `voxlive_loc_${role}`;
        const cached = typeof window !== "undefined" ? sessionStorage.getItem(cacheKey) : null;
        if (cached) {
          const parsed = JSON.parse(cached);
          setMyLocation(parsed);
          myLocationRef.current = parsed;
          peerRef.current?.sendLocation(parsed);
          return;
        }

        const res = await fetch(`/api/location${role === "callee" ? "?sim=peer" : ""}`);
        if (res.ok) {
          const data: UserLocation = await res.json();
          setMyLocation(data);
          myLocationRef.current = data;
          sessionStorage.setItem(cacheKey, JSON.stringify(data));
          peerRef.current?.sendLocation(data);
        }
      } catch (err) {
        console.warn("[Room] Could not load user geolocation:", err);
      }
    }
    fetchLocation();

    const onOnline = () => {
      console.log("[Room] Internet reconnected! Auto-retrying session...");
      setError(null);
      setStatus("connecting");
      setRetryCount((c) => c + 1);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [role]);

  const cleanup = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
    freshTokenRef.current = null;
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

        // 5. Gemini Live session & Seamless Resumption Handlers
        const attachGeminiEvents = (session: GeminiLiveSession) => {
          session.onAudioOutput((pcm, sampleRate) => {
            if (!audioCtxRef.current) return;
            setIsReceivingAudio(true);
            if (receivingTimeoutRef.current) clearTimeout(receivingTimeoutRef.current);
            receivingTimeoutRef.current = setTimeout(() => setIsReceivingAudio(false), 1200);

            const audioBuf = pcmToAudioBuffer(audioCtxRef.current, pcm, sampleRate);
            enqueueRef.current?.(audioBuf);
          });

          session.onTranscript((text) => {
            setLastTranscript((prev) => (prev ? `${prev} ${text}` : text).slice(-300));
            // Send translated subtitle to peer over WebRTC DataChannel (P2P, <5ms)
            peerRef.current?.sendCaption(text);

            if (myTranscriptTimerRef.current) clearTimeout(myTranscriptTimerRef.current);
            myTranscriptTimerRef.current = setTimeout(() => {
              setLastTranscript("");
            }, 6000);
          });

          session.onInterrupted(() => {
            console.log("[Room] Gemini Live Interrupted - Flushing audio queue");
            flushRef.current?.();
            setIsReceivingAudio(false);
          });

          session.onError((err) => {
            console.warn("[Room] Gemini Live warning:", err);
          });

          session.onNeedReconnect(() => {
            triggerSeamlessReconnect();
          });
        };

        const triggerSeamlessReconnect = async () => {
          if (isReconnectingGeminiRef.current || hasLeftRef.current || cancelled) return;
          isReconnectingGeminiRef.current = true;
          console.log("[Room] Seamless background reconnection for Gemini Live triggered...");

          try {
            let nextToken = freshTokenRef.current;
            if (!nextToken) {
              const res = await fetch("/api/gemini-token");
              if (res.ok) {
                const data = await res.json();
                nextToken = data.token;
              }
            }
            freshTokenRef.current = null; // consume token

            if (!nextToken) {
              throw new Error("Could not acquire fresh token for reconnection");
            }

            const prevHandle = geminiRef.current?.getResumptionHandle();
            const newGemini = new GeminiLiveSession(nextToken, prevHandle || undefined);
            attachGeminiEvents(newGemini);

            await newGemini.connect(targetLang.bcp47, myLang.label, targetLang.label);

            const oldGemini = geminiRef.current;
            geminiRef.current = newGemini;
            setGeminiConnected(true);
            oldGemini?.disconnect();
            console.log("[Room] Seamless Gemini Live session resumption successful!");
          } catch (reconnErr) {
            console.warn("[Room] Gemini Live reconnection attempt failed, will retry in 3s:", reconnErr);
            setTimeout(() => {
              isReconnectingGeminiRef.current = false;
              triggerSeamlessReconnect();
            }, 3000);
            return;
          } finally {
            isReconnectingGeminiRef.current = false;
          }
        };

        // Background silent token rollover: every 24 minutes, pre-fetch fresh token into RAM
        const scheduleRollover = () => {
          if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current);
          tokenRefreshTimerRef.current = setTimeout(async () => {
            try {
              console.log("[Room] Pre-fetching fresh Gemini auth token in background (24m rollover)...");
              const res = await fetch("/api/gemini-token");
              if (res.ok) {
                const data = await res.json();
                if (data.token) {
                  freshTokenRef.current = data.token;
                  console.log("[Room] Fresh Gemini token cached in background RAM.");
                }
              }
            } catch (err) {
              console.warn("[Room] Background token rollover pre-fetch failed:", err);
            }
            scheduleRollover();
          }, 24 * 60 * 1000);
        };
        scheduleRollover();

        const gemini = new GeminiLiveSession(token);
        geminiRef.current = gemini;
        attachGeminiEvents(gemini);

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

        // 6. Route mic worklet chunks -> Gemini Live API & broadcast instant speech state
        let speakTimer: NodeJS.Timeout | null = null;
        let lastBroadcastedSpeech = false;

        workletNode.port.onmessage = (evt) => {
          if (evt.data?.type === "audio" && !mutedRef.current) {
            if (evt.data.isSpeech) {
              setIsSpeaking(true);
              if (!lastBroadcastedSpeech) {
                lastBroadcastedSpeech = true;
                peerRef.current?.sendSpeakingState(true);
              }
              if (speakTimer) clearTimeout(speakTimer);
              speakTimer = setTimeout(() => {
                setIsSpeaking(false);
                lastBroadcastedSpeech = false;
                peerRef.current?.sendSpeakingState(false);
              }, 350);
            }

            geminiRef.current?.sendAudioChunk(evt.data.buffer);
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

        // Receive real-time speech activity state from peer over DataChannel (0ms visual turn-taking)
        peer.onPeerSpeaking((speaking) => {
          console.log("[Room] Peer speaking state received over DataChannel:", speaking);
          setIsPeerSpeaking(speaking);
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

        // Receive real-time geographical location from peer
        peer.onPeerLocation((loc) => {
          console.log("[Room] Peer location received over DataChannel:", loc);
          setPeerLocation(loc);
        });

        // If local location is already known, dispatch it to peer
        if (myLocationRef.current) {
          peer.sendLocation(myLocationRef.current);
        }

        peer.onPeerLeft((leftRole) => {
          console.log(`[Room] Peer (${leftRole}) left the room.`);
          setPeerProfile(null);
          setPeerLocation(null);
          setIsPeerSpeaking(false);
          if (role === "callee") {
            // Host left — room session is ended
            setStatus("disconnected");
            setWebrtcState("host_left");
            setError("The host has ended this conversation.");
          } else {
            // Guest left — Host waits for another partner
            setStatus("connecting");
            setWebrtcState("waiting_for_peer");
          }
        });

        peer.onStatusChange((s) => {
          setWebrtcState(s);
          if (s === "room_full") {
            setStatus("room_full");
            setError("This room is already full (maximum 2 participants allowed).");
          } else if (s === "connected" || s === "completed") {
            setStatus("connected");
          } else if (s === "waiting_for_peer") {
            setStatus("connecting");
            setPeerProfile(null);
            setIsPeerSpeaking(false);
          } else if (s === "disconnected" || s === "failed" || s === "closed") {
            if (role === "caller") {
              setPeerProfile(null);
              setIsPeerSpeaking(false);
              setStatus("connecting");
            } else {
              setStatus("disconnected");
            }
          }
        });

        await peer.start();

      } catch (err) {
        if (!cancelled) {
          console.error("[Room] Setup error:", err);
          const rawMsg = err instanceof Error ? err.message : String(err);
          setError(rawMsg);
          setStatus("error");

          // If network error occurred, auto-retry in 4 seconds
          const isNet = rawMsg.toLowerCase().includes("fetch") || rawMsg.toLowerCase().includes("token") || (typeof navigator !== "undefined" && !navigator.onLine);
          if (isNet) {
            setTimeout(() => {
              if (!cancelled) {
                console.log("[Room] Auto-retrying connection in background...");
                setError(null);
                setStatus("connecting");
                setRetryCount((c) => c + 1);
              }
            }, 4000);
          }
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

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

  // 8. Presence and lifecycle are now handled by Pusher Presence channels and webhooks.
  // We keep only the beforeunload beacon for instant graceful leave notification.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (hasLeftRef.current) return;
      // Show native confirmation prompt on reload/tab close
      e.preventDefault();
      e.returnValue = "";

      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/signal/leave",
            new Blob([JSON.stringify({ roomId, role })], { type: "application/json" })
          );
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [roomId, role]);

  function handleLeave() {
    if (hasLeftRef.current) return;
    hasLeftRef.current = true;

    try {
      fetch("/api/signal/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, role }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore */
    }
    cleanup();
    window.location.href = "/";
  }

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}:${String(remM).padStart(2, "0")}:${ss}`;
    }
    return `${mm}:${ss}`;
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
    error: "Connection Problem",
    room_full: "Room Full",
  };

  return (
    <main
      onClick={handleUserGesture}
      className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-start sm:justify-center p-3 sm:p-6 py-5 sm:py-8 gap-4 sm:gap-6 select-none cursor-pointer w-full overflow-y-auto"
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
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.jpg"
            alt="VoxLive Logo"
            className="w-8 h-8 rounded-lg border border-indigo-500/40 object-cover shadow-[0_0_12px_rgba(99,102,241,0.3)]"
          />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-emerald-300 bg-clip-text text-transparent">
            VoxLive
          </h1>
        </div>
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
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-6 w-full max-w-lg sm:max-w-xl md:max-w-2xl flex flex-col gap-4 sm:gap-5 shadow-2xl">
            {/* Connection Status Bar */}
            <div className="flex flex-wrap sm:flex-nowrap justify-between items-center gap-2 pb-3 border-b border-gray-800">
              <span className="text-xs text-gray-400 font-medium">Session Status</span>
              <div className="flex items-center gap-2.5">
                {status === "connected" && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-semibold flex items-center gap-1.5 shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {formatDuration(callDuration)}
                  </span>
                )}
                <span className={`text-xs font-semibold flex items-center gap-2 ${statusColor[status]}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-yellow-400"}`} />
                  {statusLabel[status]}
                </span>
              </div>
            </div>

            {/* Two Participants Profile Cards (Left = You, Right = Partner) with Google Meet Style Active Speaker Rings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* You */}
              <div
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 shadow-inner transition-all duration-200 ${
                  !muted && isSpeaking
                    ? "bg-indigo-950/70 border-indigo-500 ring-2 ring-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.35)]"
                    : "bg-gray-800/60 border-gray-700/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl bg-indigo-950 border flex items-center justify-center text-2xl shrink-0 shadow transition-all ${
                        !muted && isSpeaking ? "border-indigo-400 ring-2 ring-indigo-400/50 scale-105" : "border-indigo-700/60"
                      }`}
                    >
                      {myProfile.avatar}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block">You</span>
                      <p className="font-semibold text-white text-sm truncate">{myProfile.name}</p>
                    </div>
                  </div>

                  {/* Visualizer wave bars */}
                  {!muted && isSpeaking && (
                    <div className="flex items-end gap-0.5 h-4 px-1.5 py-0.5 bg-indigo-900/60 rounded border border-indigo-500/40 shrink-0">
                      <span className="w-1 bg-indigo-400 rounded-full h-full animate-[pulse_0.4s_infinite]" />
                      <span className="w-1 bg-indigo-300 rounded-full h-2/3 animate-[pulse_0.6s_infinite]" />
                      <span className="w-1 bg-indigo-400 rounded-full h-full animate-[pulse_0.5s_infinite]" />
                    </div>
                  )}
                </div>

                <div className="bg-gray-900/90 p-3 rounded-xl border border-gray-800 text-xs flex justify-between items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-gray-400 text-[10px] block font-medium">You Speak:</span>
                    <span className="font-semibold text-indigo-300 text-xs sm:text-sm block truncate" title={myLang.label}>
                      {myLang.label}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                    muted
                      ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : isSpeaking
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse"
                      : "bg-gray-800 text-gray-400 border border-gray-700/60"
                  }`}>
                    {muted ? "🔇 Muted" : isSpeaking ? "🎙️ Speaking" : "👂 Listening"}
                  </span>
                </div>
              </div>

              {/* Partner */}
              <div
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 shadow-inner transition-all duration-200 ${
                  isPeerSpeaking
                    ? "bg-emerald-950/70 border-emerald-500 ring-2 ring-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.45)]"
                    : "bg-gray-800/60 border-gray-700/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl bg-emerald-950 border flex items-center justify-center text-2xl shrink-0 shadow transition-all ${
                        isPeerSpeaking ? "border-emerald-400 ring-2 ring-emerald-400/60 scale-105" : "border-emerald-700/60"
                      }`}
                    >
                      {peerProfile ? peerProfile.avatar : "👤"}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider block">Partner</span>
                      <p className="font-semibold text-white text-sm truncate">
                        {peerProfile ? peerProfile.name : "Waiting for partner..."}
                      </p>
                    </div>
                  </div>

                  {/* Partner Voice Equalizer Animation */}
                  {isPeerSpeaking && (
                    <div className="flex items-end gap-0.5 h-4 px-1.5 py-0.5 bg-emerald-900/60 rounded border border-emerald-500/40 shrink-0">
                      <span className="w-1 bg-emerald-400 rounded-full h-full animate-[pulse_0.4s_infinite]" />
                      <span className="w-1 bg-emerald-300 rounded-full h-3/4 animate-[pulse_0.55s_infinite]" />
                      <span className="w-1 bg-emerald-400 rounded-full h-full animate-[pulse_0.45s_infinite]" />
                    </div>
                  )}
                </div>

                <div className="bg-gray-900/90 p-3 rounded-xl border border-gray-800 text-xs flex justify-between items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-gray-400 text-[10px] block font-medium">Partner Hears/Speaks:</span>
                    <span className="font-semibold text-emerald-300 text-xs sm:text-sm block truncate" title={targetLang.label}>
                      {targetLang.label}
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 transition-all ${
                    isPeerSpeaking
                      ? "bg-emerald-500/25 text-emerald-300 border border-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.3)]"
                      : "bg-gray-800/80 text-gray-400 border border-gray-700/60"
                  }`}>
                    {isPeerSpeaking ? "🟢 Speaking" : "👂 Listening"}
                  </span>
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
          <div className="fixed bottom-36 sm:bottom-28 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-full max-w-lg px-3 sm:px-4 flex flex-col items-center gap-1.5 text-center">
            {showCaptions && peerTranscript && (
              <div className="transition-opacity duration-200">
                <span className="inline-block bg-black/85 backdrop-blur-sm text-white px-3.5 py-1.5 rounded-lg text-xs sm:text-base font-medium shadow-2xl leading-snug">
                  <span className="text-emerald-400 font-bold mr-1.5">{peerProfile ? peerProfile.name : "Partner"}:</span>
                  {peerTranscript}
                </span>
              </div>
            )}

            {showCaptions && lastTranscript && (
              <div className="transition-opacity duration-200">
                <span className="inline-block bg-black/85 backdrop-blur-sm text-white px-3.5 py-1.5 rounded-lg text-xs sm:text-base font-medium shadow-2xl leading-snug">
                  <span className="text-indigo-400 font-bold mr-1.5">You:</span>
                  {lastTranscript}
                </span>
              </div>
            )}
          </div>

          {/* Share room ID box for caller */}
          {role === "caller" && status !== "connected" && (
            <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-2xl p-4 w-full max-w-lg sm:max-w-xl md:max-w-2xl text-center">
              <p className="text-xs text-indigo-300 mb-1">Room is listed in the Lobby. You can also share the ID directly:</p>
              <p className="text-2xl font-mono font-bold tracking-widest text-indigo-400 select-all">{roomId}</p>
            </div>
          )}

          {error && (() => {
            const friendly = parseFriendlyError(error);
            return (
              <div className="bg-red-950/40 border border-red-800/80 rounded-2xl p-4 w-full max-w-lg sm:max-w-xl md:max-w-2xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
                <div className="flex items-start gap-3">
                  <span className="text-2xl shrink-0">
                    {friendly.type === "network" ? "📶" : friendly.type === "mic" ? "🎙️" : friendly.type === "full" ? "🔒" : "⚠️"}
                  </span>
                  <div>
                    <p className="font-semibold text-white">{friendly.title}</p>
                    <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{friendly.description}</p>
                  </div>
                </div>
                {friendly.canRetry && (
                  <button
                    onClick={() => {
                      setError(null);
                      setStatus("connecting");
                      setRetryCount((c) => c + 1);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0 transition shadow cursor-pointer self-end sm:self-center flex items-center gap-1.5"
                  >
                    <span>🔄</span>
                    <span>Retry</span>
                  </button>
                )}
              </div>
            );
          })()}

          {/* Controls Toolbar */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 w-full max-w-lg sm:max-w-xl md:max-w-2xl px-1 sm:px-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleMute();
              }}
              className={`flex-1 sm:flex-none px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm transition shadow-md cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                muted
                  ? "bg-gray-700 hover:bg-gray-600 text-white"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              }`}
            >
              <span>{muted ? "🔇" : "🎤"}</span>
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>

            {/* Google Meet / YouTube style CC Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCaptions(!showCaptions);
              }}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm transition shadow-md cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                showCaptions
                  ? "bg-gray-800 hover:bg-gray-700 text-indigo-300 border border-indigo-500/40"
                  : "bg-gray-900 hover:bg-gray-800 text-gray-500 border border-gray-800"
              }`}
              title="Toggle Live Subtitles (CC)"
            >
              <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-black/50 border border-current leading-none">CC</span>
              <span>{showCaptions ? "CC ON" : "CC OFF"}</span>
            </button>

            {/* In-Room P2P Chat Toggle Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsChatOpen(!isChatOpen);
                if (!isChatOpen) setUnreadCount(0);
              }}
              className={`flex-1 sm:flex-none px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm transition shadow-md cursor-pointer flex items-center justify-center gap-1.5 relative whitespace-nowrap ${
                isChatOpen
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700"
              }`}
              title="Toggle Room Chat & Media"
            >
              <span>💬</span>
              <span>Chat</span>
              {!isChatOpen && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow animate-bounce">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* 3D Global Connection Radar Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsGlobeOpen(true);
              }}
              className="flex-1 sm:flex-none px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm bg-gray-800 hover:bg-gray-700 text-indigo-300 border border-indigo-500/40 transition shadow-md cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap"
              title="View 3D Connection Radar & Distance"
            >
              <span>🌍</span>
              <span>Globe</span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleLeave();
              }}
              className="flex-1 sm:flex-none px-3.5 sm:px-5 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm bg-red-700 hover:bg-red-600 transition text-white shadow-md cursor-pointer whitespace-nowrap"
            >
              Leave
            </button>
          </div>
        </>
      )}

      {/* 3D Global Connection Radar Modal (Loaded on-demand via React.lazy) */}
      {isGlobeOpen && (
        <Suspense fallback={null}>
          <ConnectionGlobeModal
            isOpen={isGlobeOpen}
            onClose={() => setIsGlobeOpen(false)}
            myLocation={myLocation}
            peerLocation={peerLocation}
            myName={myProfile.name}
            myAvatar={myProfile.avatar}
            peerName={peerProfile?.name || "Partner"}
            peerAvatar={peerProfile?.avatar || "👤"}
          />
        </Suspense>
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