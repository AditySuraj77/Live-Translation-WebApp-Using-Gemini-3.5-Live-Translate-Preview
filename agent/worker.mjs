import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import { RoomServiceClient } from "livekit-server-sdk";

// ─────────────────────────────────────────────────────────────
// 0. Logging Buffer & Configuration
// ─────────────────────────────────────────────────────────────
const logBuffer = [];
function log(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > 400) logBuffer.shift();
}

const PORT = process.env.PORT || 10000;
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const EXACT_MODEL = "models/gemini-3.5-live-translate-preview";

// Collect Gemini keys for round-robin pool
const geminiKeys = [];
if (process.env.GEMINI_API_KEY) {
  geminiKeys.push(process.env.GEMINI_API_KEY.trim());
}

for (const [key, val] of Object.entries(process.env)) {
  if (
    val &&
    key !== "GEMINI_API_KEY" &&
    (key.toLowerCase().includes("gemini") || key.toLowerCase().startsWith("livetranslat"))
  ) {
    const trimmed = val.trim();
    if (trimmed && !geminiKeys.includes(trimmed)) {
      geminiKeys.push(trimmed);
    }
  }
}

let keyPointer = 0;
function getNextGeminiKey() {
  if (geminiKeys.length === 0) return { key: "", index: -1 };
  const idx = keyPointer % geminiKeys.length;
  const k = geminiKeys[idx];
  keyPointer++;
  return { key: k, index: idx };
}

log("===============================================================");
log("  LiveKit Cloud Direct Translation Agent Worker (Render.com)");
log("===============================================================");
log(`[Config] Target Model:   ${EXACT_MODEL}`);
log(`[Config] LiveKit URL:    ${LIVEKIT_URL || "NOT SET"}`);
log(`[Config] Gemini Key Pool: ${geminiKeys.length} active keys loaded`);
log(`[Config] HTTP Port:      ${PORT}`);

// ─────────────────────────────────────────────────────────────
// 1. LiveKit Room Service Client
// ─────────────────────────────────────────────────────────────
let roomService = null;
if (LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
  try {
    const wsUrl = LIVEKIT_URL.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    roomService = new RoomServiceClient(wsUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    log("[LiveKit] RoomServiceClient initialized successfully");
  } catch (err) {
    log("[LiveKit Error] Failed to initialize RoomServiceClient:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Active Rooms & Peer Connections State
// ─────────────────────────────────────────────────────────────
const rooms = new Map();

// ─────────────────────────────────────────────────────────────
// 3. HTTP Server (Health Checks & Real-Time Logs)
// ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          status: "online",
          service: "LiveKit Translation Agent Worker",
          model: EXACT_MODEL,
          uptimeSec: Math.floor(process.uptime()),
          livekitConnected: Boolean(roomService),
          configuredGeminiKeys: geminiKeys.length,
          activeRoomsCount: rooms.size,
          activeRoomIds: Array.from(rooms.keys()),
          recentLogs: logBuffer.slice(-25),
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
    return;
  }

  if (req.url === "/logs") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(logBuffer.join("\n"));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// ─────────────────────────────────────────────────────────────
// 4. WebSocket Server for Direct Low-Latency Media Streaming
// ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/live-stream" });

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = (url.searchParams.get("roomId") || "DEFAULT").toUpperCase();
  const role = url.searchParams.get("role") || "caller"; // "caller" | "callee"
  const sourceLang = url.searchParams.get("sourceLang") || "Hindi";
  const targetLang = url.searchParams.get("targetLang") || "English";
  const targetBcp47 = url.searchParams.get("bcp47") || "en";

  log(`[WebSocket Connected] room=${roomId}, role=${role}, ${sourceLang} -> ${targetLang} (${targetBcp47})`);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, { caller: null, callee: null });
  }
  const room = rooms.get(roomId);
  const peerKey = role === "caller" ? "caller" : "callee";
  const partnerKey = role === "caller" ? "callee" : "caller";

  // Pre-register peer immediately to prevent race conditions
  const peerState = {
    ws,
    geminiSession: null,
    role,
    roomId,
    sourceLang,
    targetLang,
    targetBcp47,
    partnerKey,
    audioChunksReceived: 0,
    audioChunksForwarded: 0,
    resumptionHandle: null,
    rolloverTimer: null,
    isRolloverInProgress: false,
    reconnectTimer: null,
    isDestroyed: false,
    audioQueue: [],
    isGeminiReady: false,
    activeKeyIndex: -1,
  };
  room[peerKey] = peerState;

  // Heartbeat ping interval to prevent proxy idle dropouts
  const heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "ping", time: Date.now() }));
      } catch {}
    }
  }, 20000);

  // ─────────────────────────────────────────────────────────────
  // 5. Seamless Gemini Session Lifecycle & Round-Robin Key Rollover
  // ─────────────────────────────────────────────────────────────
  async function connectGemini(isRollover = false) {
    if (peerState.isDestroyed || ws.readyState !== WebSocket.OPEN) return;

    const { key: apiKey, index: keyIdx } = getNextGeminiKey();
    if (!apiKey) {
      log(`[Agent Error] No Gemini API key available in pool for ${role}!`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "No Gemini API key available on server" }));
      }
      return;
    }

    peerState.activeKeyIndex = keyIdx;
    log(`[Gemini Pool] ${isRollover ? "Rollover" : "Connect"} for ${role} in ${roomId} using Key #${keyIdx + 1}/${geminiKeys.length} (ending in ${apiKey.slice(-6)})...`);

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const connectConfig = {
      responseModalities: ["AUDIO"],
      systemInstruction: {
        parts: [
          {
            text: `You are an expert real-time simultaneous speech interpreter (like Google Meet Live Translate). The speaker is speaking in ${sourceLang}. Do NOT wait for full sentence completion. Immediately begin translating clause-by-clause or phrase-by-phrase in real-time as words are spoken into natural, fluent ${targetLang}. Start streaming translated audio on the very first meaningful clause. Speak only the clean translated speech in ${targetLang}. Maintain natural prosody and flow. Do not add any conversational remarks, explanations, or introductory filler. Translate each phrase once.`,
          },
        ],
      },
      translationConfig: {
        targetLanguageCode: targetBcp47,
        echoTargetLanguage: false,
      },
      outputAudioTranscription: {},
    };

    let sessionInstance = null;

    try {
      sessionInstance = await ai.live.connect({
        model: EXACT_MODEL,
        config: connectConfig,
        callbacks: {
          onopen: () => {
            log(`[Gemini Live Socket Open] ${role} in ${roomId} (Key #${keyIdx + 1})`);
          },
          onmessage: (msg) => {
            const rawMsg = msg;

            // A. Check for Google's GoAway signal (sent ~60s before 10-minute maximum session cutoff)
            if (rawMsg.goAway || rawMsg.go_away) {
              log(`[Gemini GoAway (${role})] Server sent GoAway warning. Triggering seamless key rollover...`);
              triggerSeamlessRollover("goaway");
            }

            // C. Output transcription (subtitles) — deduplicated
            let captionEmitted = false;
            const outputText =
              rawMsg.serverContent?.outputTranscription?.text ||
              rawMsg.serverContent?.output_transcription?.text;
            if (outputText) {
              captionEmitted = true;
              const captionPayload = JSON.stringify({ type: "caption", text: outputText, from: role });
              if (ws.readyState === WebSocket.OPEN) ws.send(captionPayload);
              const currentRoom = rooms.get(roomId);
              const partner = currentRoom ? currentRoom[partnerKey] : null;
              if (partner && partner.ws.readyState === WebSocket.OPEN) {
                partner.ws.send(captionPayload);
              }
            }

            // D. Translated Audio: FORWARD DIRECTLY TO THE OTHER PEER (ZERO U-TURN!)
            const parts = msg.serverContent?.modelTurn?.parts;
            let audioEmitted = false;

            if (parts && Array.isArray(parts)) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const base64Audio = part.inlineData.data;
                  const mimeType = part.inlineData.mimeType || "audio/pcm;rate=24000";
                  const audioPayload = JSON.stringify({
                    type: "audio",
                    data: base64Audio,
                    mimeType,
                    from: role,
                  });

                  // DIRECT HOP: Send audio straight to the PARTNER's browser!
                  const currentRoom = rooms.get(roomId);
                  const partner = currentRoom ? currentRoom[partnerKey] : null;
                  if (partner && partner.ws.readyState === WebSocket.OPEN) {
                    partner.ws.send(audioPayload);
                    peerState.audioChunksForwarded++;
                    audioEmitted = true;
                  }
                }
                if (part.text && !captionEmitted) {
                  const textPayload = JSON.stringify({ type: "caption", text: part.text, from: role });
                  if (ws.readyState === WebSocket.OPEN) ws.send(textPayload);
                  const currentRoom = rooms.get(roomId);
                  const partner = currentRoom ? currentRoom[partnerKey] : null;
                  if (partner && partner.ws.readyState === WebSocket.OPEN) {
                    partner.ws.send(textPayload);
                  }
                }
              }
            }

            // E. Turn complete & interruption signals (resets subtitle accumulation cleanly)
            if (rawMsg.serverContent?.turnComplete) {
              const turnPayload = JSON.stringify({ type: "turn_complete", from: role });
              if (ws.readyState === WebSocket.OPEN) ws.send(turnPayload);
              const currentRoom = rooms.get(roomId);
              const partner = currentRoom ? currentRoom[partnerKey] : null;
              if (partner && partner.ws.readyState === WebSocket.OPEN) {
                partner.ws.send(turnPayload);
              }
            }

            if (rawMsg.serverContent?.interrupted) {
              const interruptedPayload = JSON.stringify({ type: "interrupted", from: role });
              if (ws.readyState === WebSocket.OPEN) ws.send(interruptedPayload);
              const currentRoom = rooms.get(roomId);
              const partner = currentRoom ? currentRoom[partnerKey] : null;
              if (partner && partner.ws.readyState === WebSocket.OPEN) {
                partner.ws.send(interruptedPayload);
              }
            }

            // Fallback data property
            if (!audioEmitted && msg.data) {
              const currentRoom = rooms.get(roomId);
              const partner = currentRoom ? currentRoom[partnerKey] : null;
              if (partner && partner.ws.readyState === WebSocket.OPEN) {
                partner.ws.send(
                  JSON.stringify({
                    type: "audio",
                    data: msg.data,
                    mimeType: "audio/pcm;rate=24000",
                    from: role,
                  })
                );
                peerState.audioChunksForwarded++;
              }
            }
          },
          onerror: (err) => {
            log(`[Gemini Error (${role})] ${err?.message || err}`);
          },
          onclose: (e) => {
            log(`[Gemini Closed (${role})] code: ${e.code}, reason: ${e.reason}`);
            // If the active session closed and we're not shutting down, auto-failover immediately
            if (!peerState.isDestroyed && ws.readyState === WebSocket.OPEN) {
              if (peerState.geminiSession === sessionInstance) {
                peerState.isGeminiReady = false;
                peerState.geminiSession = null;
                log(`[Gemini Auto-Failover (${role})] Active session terminated. Failing over to next key in pool...`);
                scheduleReconnect(600);
              }
            }
          },
        },
      });

      // Hot-swap: replace old session with new session
      const oldSession = peerState.geminiSession;
      peerState.geminiSession = sessionInstance;
      peerState.isGeminiReady = true;
      peerState.isRolloverInProgress = false;

      // Close the previous session cleanly after hot-swap
      if (oldSession && oldSession !== sessionInstance) {
        try {
          oldSession.close();
        } catch {}
      }

      log(`[Gemini Ready] Session active for ${role} in ${roomId} (Key #${keyIdx + 1}). Flushing queued chunks (${peerState.audioQueue.length})...`);

      // Flush any chunks queued during connection/rollover
      while (peerState.audioQueue.length > 0) {
        const qChunk = peerState.audioQueue.shift();
        try {
          sessionInstance.sendRealtimeInput({
            media: {
              data: qChunk,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } catch (qErr) {
          log(`[Queue Send Error] ${qErr.message}`);
        }
      }

      // Proactive 8-minute rollover timer (safely before Google's 10-minute hard cutoff)
      if (peerState.rolloverTimer) clearTimeout(peerState.rolloverTimer);
      peerState.rolloverTimer = setTimeout(() => {
        log(`[Gemini Proactive Rollover (${role})] 8-minute window reached. Pre-emptively rolling over to next key...`);
        triggerSeamlessRollover("proactive-8min");
      }, 8 * 60 * 1000); // 8 minutes

      // Notify client that Gemini Live is ready
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ready", model: EXACT_MODEL, isRollover }));
      }
    } catch (gErr) {
      log(`[Gemini Connect Failed (${role})] ${gErr.message}`);
      peerState.isRolloverInProgress = false;
      if (!peerState.isDestroyed && ws.readyState === WebSocket.OPEN) {
        scheduleReconnect(1500);
      }
    }
  }

  function triggerSeamlessRollover(reason = "timer") {
    if (peerState.isRolloverInProgress || peerState.isDestroyed) return;
    peerState.isRolloverInProgress = true;
    log(`[Rollover Triggered] ${role} in ${roomId} (reason: ${reason})`);
    // Connect next session in background while current session still handles audio
    connectGemini(true);
  }

  function scheduleReconnect(delayMs = 1000) {
    if (peerState.reconnectTimer) clearTimeout(peerState.reconnectTimer);
    if (peerState.isDestroyed) return;
    peerState.reconnectTimer = setTimeout(() => {
      connectGemini(false);
    }, delayMs);
  }

  // Initial connection
  connectGemini(false);

  // Handle incoming audio from client
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      peerState.audioChunksReceived++;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const base64 = buf.toString("base64");

      if (peerState.isGeminiReady && peerState.geminiSession) {
        try {
          peerState.geminiSession.sendRealtimeInput({
            media: {
              data: base64,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } catch (err) {
          log(`[Send Error (${role})] ${err.message}`);
        }
      } else {
        // Queue chunks during rollover/reconnect window
        if (peerState.audioQueue.length < 250) {
          peerState.audioQueue.push(base64);
        }
      }
    } else {
      // JSON control message
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", time: Date.now() }));
        } else if (msg.type === "pong") {
          // Client responded to our heartbeat
        }
      } catch {}
    }
  });

  ws.on("close", () => {
    log(`[WebSocket Disconnected] ${role} in ${roomId} (chunks in: ${peerState.audioChunksReceived}, forwarded: ${peerState.audioChunksForwarded})`);
    peerState.isDestroyed = true;
    clearInterval(heartbeatTimer);
    if (peerState.rolloverTimer) clearTimeout(peerState.rolloverTimer);
    if (peerState.reconnectTimer) clearTimeout(peerState.reconnectTimer);

    if (peerState.geminiSession) {
      try {
        peerState.geminiSession.close();
      } catch {}
      peerState.geminiSession = null;
    }
    room[peerKey] = null;
    if (!room.caller && !room.callee) {
      rooms.delete(roomId);
      log(`[Room Cleaned] Room ${roomId} removed`);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`[HTTP Server] Health listening on http://0.0.0.0:${PORT}`);
  log(`[WebSocket Server] Live stream listening on ws://0.0.0.0:${PORT}/live-stream`);
  log("[Worker Status] DIRECT CLOUD PIPELINE ACTIVE (Zero Double-Hop & Seamless Key Rollover) 🚀\n");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  log("[Worker] SIGTERM received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  log("[Worker] SIGINT received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});
