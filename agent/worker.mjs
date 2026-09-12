import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI } from "@google/genai";
import { RoomServiceClient } from "livekit-server-sdk";

// ─────────────────────────────────────────────────────────────
// 0. Configuration & Environment
// ─────────────────────────────────────────────────────────────
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

console.log("===============================================================");
console.log("  LiveKit Cloud Direct Translation Agent Worker (Render.com)");
console.log("===============================================================");
console.log(`[Config] Target Model:   ${EXACT_MODEL}`);
console.log(`[Config] LiveKit URL:    ${LIVEKIT_URL || "NOT SET"}`);
console.log(`[Config] Gemini Key Pool: ${geminiKeys.length} active keys loaded`);
console.log(`[Config] HTTP Port:      ${PORT}`);

// ─────────────────────────────────────────────────────────────
// 1. LiveKit Room Service Client (Optional Management)
// ─────────────────────────────────────────────────────────────
let roomService = null;
if (LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
  try {
    const wsUrl = LIVEKIT_URL.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    roomService = new RoomServiceClient(wsUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    console.log("[LiveKit] RoomServiceClient initialized successfully");
  } catch (err) {
    console.error("[LiveKit Error] Failed to initialize RoomServiceClient:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Active Rooms & Peer Connections State
// ─────────────────────────────────────────────────────────────
// rooms[roomId] = { caller: { ws, geminiSession, ... }, callee: { ws, geminiSession, ... } }
const rooms = new Map();

// ─────────────────────────────────────────────────────────────
// 3. HTTP Server (Health Checks & Status)
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
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
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

  console.log(`[WebSocket] Client connected: room=${roomId}, role=${role}, ${sourceLang} -> ${targetLang} (${targetBcp47})`);

  if (!rooms.has(roomId)) {
    rooms.set(roomId, { caller: null, callee: null });
  }
  const room = rooms.get(roomId);
  const peerKey = role === "caller" ? "caller" : "callee";
  const partnerKey = role === "caller" ? "callee" : "caller";

  // Gemini Live Session for this speaker
  let geminiSession = null;
  const apiKey = getNextGeminiKey();

  if (!apiKey) {
    console.error("[Agent Error] No Gemini API key available in pool!");
    ws.send(JSON.stringify({ type: "error", message: "No Gemini API key available on server" }));
    ws.close();
    return;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  try {
    console.log(`[Gemini] Initializing direct session for ${role} in room ${roomId}...`);
    geminiSession = await ai.live.connect({
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
      },
      callbacks: {
        onopen: () => {
          console.log(`[Gemini Live] Session open for ${role} in ${roomId}`);
          ws.send(JSON.stringify({ type: "ready", model: EXACT_MODEL }));
        },
        onmessage: (msg) => {
          const rawMsg = msg;

          // 1. Output transcription (subtitles)
          const outputText =
            rawMsg.serverContent?.outputTranscription?.text ||
            rawMsg.serverContent?.output_transcription?.text;
          if (outputText) {
            const captionPayload = JSON.stringify({ type: "caption", text: outputText, from: role });
            // Send to speaker (for self-captions) and to partner (for translated subtitles)
            if (ws.readyState === WebSocket.OPEN) ws.send(captionPayload);
            const partner = room[partnerKey];
            if (partner && partner.ws.readyState === WebSocket.OPEN) {
              partner.ws.send(captionPayload);
            }
          }

          // 2. Translated Audio: FORWARD DIRECTLY TO THE OTHER PEER (ZERO U-TURN!)
          const parts = msg.serverContent?.modelTurn?.parts;
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
                const partner = room[partnerKey];
                if (partner && partner.ws.readyState === WebSocket.OPEN) {
                  partner.ws.send(audioPayload);
                }
              }
              if (part.text) {
                const textPayload = JSON.stringify({ type: "caption", text: part.text, from: role });
                if (ws.readyState === WebSocket.OPEN) ws.send(textPayload);
                const partner = room[partnerKey];
                if (partner && partner.ws.readyState === WebSocket.OPEN) {
                  partner.ws.send(textPayload);
                }
              }
            }
          }
        },
        onerror: (err) => {
          console.error(`[Gemini Error (${role})]`, err);
        },
        onclose: (e) => {
          console.log(`[Gemini Closed (${role})] code:`, e.code, "reason:", e.reason);
        },
      },
    });
  } catch (gErr) {
    console.error(`[Gemini Connection Failed (${role})]`, gErr);
  }

  // Register peer in room
  room[peerKey] = {
    ws,
    geminiSession,
    role,
    sourceLang,
    targetLang,
  };

  // Handle incoming audio from client
  ws.on("message", (data, isBinary) => {
    if (!geminiSession) return;

    if (isBinary) {
      // Direct raw binary PCM chunk from user's microphone (Float32 or Int16)
      const base64 = Buffer.from(data).toString("base64");
      try {
        geminiSession.sendRealtimeInput({
          media: {
            data: base64,
            mimeType: "audio/pcm;rate=16000",
          },
        });
      } catch (err) {
        // Silently ignore transient frame drops
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
    console.log(`[WebSocket] Client disconnected: ${role} in room ${roomId}`);
    if (geminiSession) {
      try {
        geminiSession.close();
      } catch {}
      geminiSession = null;
    }
    room[peerKey] = null;
    if (!room.caller && !room.callee) {
      rooms.delete(roomId);
      console.log(`[Room Cleaned] Room ${roomId} is now empty and removed.`);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[HTTP Server] Health check listening on http://0.0.0.0:${PORT}`);
  console.log(`[WebSocket Server] Live stream listening on ws://0.0.0.0:${PORT}/live-stream`);
  console.log("[Worker Status] DIRECT CLOUD PIPELINE ACTIVE (Zero Double-Hop) 🚀\n");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Worker] SIGTERM received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[Worker] SIGINT received. Shutting down gracefully...");
  server.close(() => process.exit(0));
});
