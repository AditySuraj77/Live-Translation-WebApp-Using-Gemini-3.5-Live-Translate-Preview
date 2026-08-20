"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { findLanguage } from "@/lib/languages";
import { GeminiLiveSession } from "@/lib/gemini-live";
import { PeerManager } from "@/lib/webrtc";
import { pcmToAudioBuffer, createTranslatedMediaStream } from "@/lib/audio-utils";

type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

interface RoomProps {
  roomId: string;
  myLangCode: string;
  targetLangCode: string;
  role: "caller" | "callee";
}

export default function Room({ roomId, myLangCode, targetLangCode, role }: RoomProps) {
  const myLang = findLanguage(myLangCode);
  const targetLang = findLanguage(targetLangCode);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [webrtcState, setWebrtcState] = useState<string>("initializing");
  const [geminiConnected, setGeminiConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isReceivingAudio, setIsReceivingAudio] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const geminiRef = useRef<GeminiLiveSession | null>(null);
  const peerRef = useRef<PeerManager | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const enqueueRef = useRef<((buf: AudioBuffer) => void) | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const receivingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

        // 1. Fetch ephemeral auth token from server
        const tokenRes = await fetch("/api/gemini-token");
        if (!tokenRes.ok) throw new Error("Could not fetch Gemini authentication token from server");
        const { token } = await tokenRes.json();

        if (cancelled) return;

        // 2. Mic permission
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        micStreamRef.current = micStream;
        if (cancelled) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }

        // 3. AudioContext + AudioWorklet
        const ctx = new AudioContext({ sampleRate: 48000 });
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
        const { stream: translatedStream, enqueue } = createTranslatedMediaStream(ctx);
        enqueueRef.current = enqueue;

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
          setLastTranscript((prev) => (prev ? `${prev} ${text}` : text).slice(-200));
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
          if (evt.data?.type === "audio" && !muted) {
            setIsSpeaking(true);
            if (speakTimer) clearTimeout(speakTimer);
            speakTimer = setTimeout(() => setIsSpeaking(false), 300);

            gemini.sendAudioChunk(evt.data.buffer);
          }
        };

        // 7. WebRTC Setup
        const peer = new PeerManager(roomId, role);
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

        peer.onStatusChange((s) => {
          setWebrtcState(s);
          if (s === "connected" || s === "completed") {
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

  function toggleMute() {
    handleUserGesture();
    const newMuted = !muted;
    setMuted(newMuted);
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = (evt) => {
        if (evt.data?.type === "audio" && !newMuted) {
          geminiRef.current?.sendAudioChunk(evt.data.buffer);
        }
      };
    }
  }

  function handleLeave() {
    cleanup();
    window.location.href = "/";
  }

  const statusColor: Record<ConnectionStatus, string> = {
    idle: "text-gray-400",
    connecting: "text-yellow-400",
    connected: "text-emerald-400",
    disconnected: "text-red-400",
    error: "text-red-500",
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    idle: "Idle",
    connecting: "Connecting… (Waiting for peer)",
    connected: "Connected (Live)",
    disconnected: "Disconnected",
    error: "Error",
  };

  return (
    <main
      onClick={handleUserGesture}
      className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 gap-6 select-none cursor-pointer"
    >
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">🎙️ LiveTranslate</h1>
        <p className="text-gray-400 text-sm mt-1">
          Room: <span className="font-mono text-indigo-400 font-bold tracking-widest">{roomId}</span>
        </p>
      </div>

      {/* Main card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 shadow-xl">
        <div className="flex justify-between items-center pb-2 border-b border-gray-800">
          <span className="text-sm text-gray-400">Connection</span>
          <span className={`text-sm font-semibold flex items-center gap-2 ${statusColor[status]}`}>
            <span className={`w-2.5 h-2.5 rounded-full ${status === "connected" ? "bg-emerald-400 animate-pulse" : "bg-yellow-400"}`} />
            {statusLabel[status]}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-800/60 p-3 rounded-xl border border-gray-800">
            <p className="text-xs text-gray-400">You Speak</p>
            <p className="font-semibold text-white mt-0.5">{myLang.label}</p>
          </div>
          <div className="bg-gray-800/60 p-3 rounded-xl border border-gray-800">
            <p className="text-xs text-gray-400">Other Peer Hears</p>
            <p className="font-semibold text-emerald-400 mt-0.5">{targetLang.label}</p>
          </div>
        </div>

        {/* Live Audio Activity Indicators */}
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-gray-400">Microphone Input:</span>
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

        {lastTranscript && (
          <div className="mt-2 bg-black/40 border border-gray-800 p-3 rounded-xl text-xs text-gray-300">
            <span className="text-gray-500 block mb-1">Live Translation Text:</span>
            {lastTranscript}
          </div>
        )}
      </div>

      {/* Share room ID box for caller */}
      {role === "caller" && status !== "connected" && (
        <div className="bg-indigo-950/40 border border-indigo-800/60 rounded-2xl p-4 w-full max-w-md text-center">
          <p className="text-xs text-indigo-300 mb-1">Share this Room ID with the other person to join:</p>
          <p className="text-3xl font-mono font-bold tracking-widest text-indigo-400 select-all">{roomId}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 w-full max-w-md text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          className={`px-6 py-3 rounded-xl font-semibold transition shadow-md ${
            muted
              ? "bg-gray-700 hover:bg-gray-600 text-white"
              : "bg-indigo-600 hover:bg-indigo-500 text-white"
          }`}
        >
          {muted ? "🔇 Unmute Mic" : "🎤 Mute Mic"}
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            handleLeave();
          }}
          className="px-6 py-3 rounded-xl font-semibold bg-red-700 hover:bg-red-600 transition text-white shadow-md"
        >
          Leave Room
        </button>
      </div>

      {/* Audio element for receiving translated speech from remote peer */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudioRef} autoPlay playsInline />
    </main>
  );
}