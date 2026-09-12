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
  if (logBuffer.length > 300) logBuffer.shift();
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
  if (geminiKeys.length === 0) return "";
  const k = geminiKeys[keyPointer % geminiKeys.length];
  keyPointer++;
  return k;
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
          recentLogs: logBuffer.slice(-20),
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
    sourceLang,
    targetLang,
    audioChunksReceived: 0,
    audioChunksForwarded: 0,
  };
  room[peerKey] = peerState;

  // Audio queue for early chunks before Gemini finishes handshake
  const audioQueue = [];
  let isGeminiReady = false;

  const apiKey = getNextGeminiKey();
  if (!apiKey) {
    log(`[Agent Error] No Gemini API key available in pool for ${role}!`);
    ws.send(JSON.stringify({ type: "error", message: "No Gemini API key available on server" }));
    ws.close();
    return;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  try {
    log(`[Gemini] Connecting session for ${role} in ${roomId} (key ending ${apiKey.slice(-6)})...`);
    const session = await ai.live.connect({
      model: EXACT_MODEL,
      config: {
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
        contextWindowCompression: {
          slidingWindow: {},
        },
      },
      callbacks: {
        onopen: () => {
          log(`[Gemini Live Socket Open] ${role} in ${roomId}`);
        },
        onmessage: (msg) => {
          const rawMsg = msg;

          // 1. Output transcription (subtitles)
          const outputText =
            rawMsg.serverContent?.outputTranscription?.text ||
            rawMsg.serverContent?.output_transcription?.text;
          if (outputText) {
            log(`[Subtitle (${role})] ${outputText}`);
            const captionPayload = JSON.stringify({ type: "caption", text: outputText, from: role });
            if (ws.readyState === WebSocket.OPEN) ws.send(captionPayload);
            const currentRoom = rooms.get(roomId);
            const partner = currentRoom ? currentRoom[partnerKey] : null;
            if (partner && partner.ws.readyState === WebSocket.OPEN) {
              partner.ws.send(captionPayload);
            }
          }

          // 2. Translated Audio: FORWARD DIRECTLY TO THE OTHER PEER (ZERO U-TURN!)
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
                } else {
                  log(`[Forward Warn] Partner ${partnerKey} not available or socket closed!`);
                }
              }
              if (part.text) {
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
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "gemini_error", error: String(err?.message || err) }));
          }
        },
        onclose: (e) => {
          log(`[Gemini Closed (${role})] code: ${e.code}, reason: ${e.reason}`);
          isGeminiReady = false;
        },
      },
    });

    peerState.geminiSession = session;
    isGeminiReady = true;
    log(`[Gemini Ready] Fully connected for ${role} in ${roomId}. Flushing queued chunks (${audioQueue.length})...`);

    // Flush any chunks queued before session resolved
    while (audioQueue.length > 0) {
      const qChunk = audioQueue.shift();
      try {
        session.sendRealtimeInput({
          media: {
            data: qChunk,
            mimeType: "audio/pcm;rate=16000",
          },
        });
      } catch (qErr) {
        log(`[Queue Send Error] ${qErr.message}`);
      }
    }

    // Now notify client that the agent worker is 100% ready for incoming audio
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ready", model: EXACT_MODEL }));
    }
  } catch (gErr) {
    log(`[Gemini Connection Failed (${role})] ${gErr.message}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "gemini_error", error: gErr.message }));
    }
  }

  // Handle incoming audio from client
  ws.on("message", (data, isBinary) => {
    const isBin = isBinary || Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer;

    if (isBin) {
      peerState.audioChunksReceived++;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const base64 = buf.toString("base64");

      if (isGeminiReady && peerState.geminiSession) {
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
        // Queue if Gemini session is still connecting
        if (audioQueue.length < 200) {
          audioQueue.push(base64);
        }
      }
    } else {
      // JSON control message
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", time: Date.now() }));
        }
      } catch {}
    }
  });

  ws.on("close", () => {
    log(`[WebSocket Disconnected] ${role} in ${roomId} (chunks in: ${peerState.audioChunksReceived}, forwarded: ${peerState.audioChunksForwarded})`);
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
  log("[Worker Status] DIRECT CLOUD PIPELINE ACTIVE (Zero Double-Hop) 🚀\n");
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
