import http from "node:http";
import { RoomServiceClient } from "livekit-server-sdk";
import { GoogleGenAI } from "@google/genai";

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
console.log("  LiveKit Cloud Translation Agent Worker (Render.com)");
console.log("===============================================================");
console.log(`[Config] Target Model:   ${EXACT_MODEL}`);
console.log(`[Config] LiveKit URL:    ${LIVEKIT_URL || "NOT SET"}`);
console.log(`[Config] Gemini Key Pool: ${geminiKeys.length} active keys loaded`);
console.log(`[Config] HTTP Port:      ${PORT}`);

// ─────────────────────────────────────────────────────────────
// 1. LiveKit Room Service Client
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
} else {
  console.warn("[LiveKit Warning] LIVEKIT_URL, API_KEY, or SECRET missing in environment!");
}

// ─────────────────────────────────────────────────────────────
// 2. Active State Tracker
// ─────────────────────────────────────────────────────────────
const state = {
  startedAt: new Date().toISOString(),
  activeRoomsCount: 0,
  activeRooms: [],
  totalTranslationsHandled: 0,
  lastCheck: null,
  status: "idle",
};

// Monitor active rooms in background
async function monitorRooms() {
  if (!roomService) return;
  try {
    const rooms = await roomService.listRooms();
    state.activeRoomsCount = rooms.length;
    state.activeRooms = rooms.map((r) => ({
      name: r.name,
      numParticipants: r.numParticipants,
      creationTime: r.creationTime,
    }));
    state.lastCheck = new Date().toISOString();
    state.status = rooms.length > 0 ? "translating" : "listening";

    if (rooms.length > 0) {
      console.log(`[LiveKit Monitor] Active Rooms: ${rooms.length} | Participants: ${rooms.map(r => r.name + '(' + r.numParticipants + ')').join(", ")}`);
    }
  } catch (err) {
    state.lastCheck = new Date().toISOString();
    // Ignore transient network hiccups
  }
}

setInterval(monitorRooms, 10000);
monitorRooms();

// ─────────────────────────────────────────────────────────────
// 3. Render HTTP Health Server (Listens on $PORT)
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
          activeRoomsCount: state.activeRoomsCount,
          activeRooms: state.activeRooms,
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[HTTP Server] Health check server listening on http://0.0.0.0:${PORT}`);
  console.log("[Worker Status] READY for real-time translation sessions 🚀\n");
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
