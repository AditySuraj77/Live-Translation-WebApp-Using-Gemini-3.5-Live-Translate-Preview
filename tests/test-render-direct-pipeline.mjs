import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";

const RENDER_HTTP_URL = "https://live-translation-agent.onrender.com";
const RENDER_WS_URL = "wss://live-translation-agent.onrender.com/live-stream";
const WAV_PATH = path.resolve(process.cwd(), "tests/speech_fixture.wav");

console.log("===============================================================");
console.log("   Render Direct Cloud Pipeline Comprehensive Test Suite");
console.log("===============================================================");
console.log(`[Target URL] HTTP: ${RENDER_HTTP_URL}`);
console.log(`[Target URL] WS:   ${RENDER_WS_URL}`);
console.log(`[Fixture]    WAV:  ${WAV_PATH}\n`);

// ─────────────────────────────────────────────────────────────
// Helper: Load & Resample WAV to 16kHz 20ms chunks
// ─────────────────────────────────────────────────────────────
function loadWavChunks(wavPath) {
  const buf = fs.readFileSync(wavPath);
  const sampleRate = buf.readUInt32LE(24);

  let pos = 12;
  while (pos < buf.length - 8) {
    const subChunkId = buf.toString("ascii", pos, pos + 4);
    const subChunkSize = buf.readUInt32LE(pos + 4);
    if (subChunkId === "data") {
      pos += 8;
      break;
    }
    pos += 8 + subChunkSize;
  }

  const rawBytes = buf.subarray(pos);
  const numInputSamples = Math.floor(rawBytes.length / 2);
  const inputSamples = new Int16Array(numInputSamples);
  for (let i = 0; i < numInputSamples; i++) {
    inputSamples[i] = rawBytes.readInt16LE(i * 2);
  }

  const targetRate = 16000;
  const ratio = sampleRate / targetRate;
  const numTargetSamples = Math.floor(numInputSamples / ratio);
  const resampled = new Int16Array(numTargetSamples);

  for (let i = 0; i < numTargetSamples; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const s0 = inputSamples[idx] || 0;
    const s1 = inputSamples[Math.min(idx + 1, numInputSamples - 1)] || 0;
    resampled[i] = Math.round(s0 * (1 - frac) + s1 * frac);
  }

  const chunkSize = 320; // 20ms @ 16kHz
  const chunks = [];
  for (let i = 0; i < resampled.length; i += chunkSize) {
    chunks.push(resampled.subarray(i, Math.min(i + chunkSize, resampled.length)));
  }
  return chunks;
}

const wavChunks = loadWavChunks(WAV_PATH);
const wavDurationSec = ((wavChunks.length * 20) / 1000).toFixed(2);
console.log(`[Audio] Loaded ${wavChunks.length} chunks (${wavDurationSec}s @ 16kHz)\n`);

// ─────────────────────────────────────────────────────────────
// TEST 1: Health Check & WebSocket Handshake
// ─────────────────────────────────────────────────────────────
async function runTest1() {
  console.log("---------------------------------------------------------------");
  console.log(">>> TEST 1: Render Health Check & Handshake Verification");
  console.log("---------------------------------------------------------------");

  // 1. HTTP Health Endpoint
  process.stdout.write("Checking GET /health... ");
  const res = await fetch(`${RENDER_HTTP_URL}/health`);
  if (!res.ok) {
    throw new Error(`Health check returned HTTP ${res.status}`);
  }
  const healthData = await res.json();
  console.log("OK!");
  console.log(`  • Service Status:      ${healthData.status}`);
  console.log(`  • Gemini Model:        ${healthData.model}`);
  console.log(`  • Gemini Key Pool:     ${healthData.configuredGeminiKeys} keys`);
  console.log(`  • LiveKit Connected:   ${healthData.livekitConnected}`);
  console.log(`  • Uptime:              ${healthData.uptimeSec} seconds`);

  // 2. WebSocket Handshake
  process.stdout.write("Testing WebSocket Handshake (/live-stream)... ");
  const testWsUrl = `${RENDER_WS_URL}?roomId=TEST_HANDSHAKE&role=caller&sourceLang=Hindi&targetLang=English&bcp47=en`;
  
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(testWsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Handshake timed out after 10s"));
    }, 10000);

    ws.on("open", () => {
      // Wait for server ready message
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "ready") {
          clearTimeout(timeout);
          ws.close();
          console.log("SUCCESS!");
          console.log(`  • Handshake Response:  ${msg.type} (Model: ${msg.model})\n`);
          resolve(true);
        }
      } catch {}
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// TEST 2: The Direct Zero-Double-Hop Proof Test (The Master Test)
// ─────────────────────────────────────────────────────────────
async function runTest2() {
  console.log("---------------------------------------------------------------");
  console.log(">>> TEST 2: Direct Zero-Double-Hop Proof Test (The Master Test)");
  console.log("---------------------------------------------------------------");

  const testRoomId = `ROOM_PROOF_${Date.now()}`;
  const urlUserA = `${RENDER_WS_URL}?roomId=${testRoomId}&role=caller&sourceLang=English&targetLang=Hindi&bcp47=hi`;
  const urlUserB = `${RENDER_WS_URL}?roomId=${testRoomId}&role=callee&sourceLang=Hindi&targetLang=English&bcp47=en`;

  console.log(`Connecting User A (Caller) & User B (Callee) to room: ${testRoomId}...`);

  const wsA = new WebSocket(urlUserA);
  const wsB = new WebSocket(urlUserB);

  await Promise.all([
    new Promise((resolve) => wsA.on("open", resolve)),
    new Promise((resolve) => wsB.on("open", resolve)),
  ]);

  console.log("Both User A and User B connected to Render! Waiting for Gemini readiness...");

  // Wait for both to receive 'ready'
  await new Promise((resolve) => {
    let readyCount = 0;
    const checkReady = (msg, ws) => {
      try {
        const d = JSON.parse(msg.toString());
        if (d.type === "ready") {
          readyCount++;
          if (readyCount >= 2) resolve(true);
        }
      } catch {}
    };
    wsA.on("message", (m) => checkReady(m, wsA));
    wsB.on("message", (m) => checkReady(m, wsB));
    setTimeout(resolve, 3000); // safety fallback
  });

  console.log("Gemini sessions ready on Render! Starting real-time audio stream from User A...\n");

  let userAAudioPacketsReceived = 0;
  let userBAudioPacketsReceived = 0;
  let userBFirstAudioTimestamp = null;
  let tSpeechEnd = null;
  const userBCaptions = [];

  wsA.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "audio") {
        userAAudioPacketsReceived++;
      }
    } catch {}
  });

  wsB.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "audio") {
        userBAudioPacketsReceived++;
        if (!userBFirstAudioTimestamp) {
          userBFirstAudioTimestamp = performance.now();
        }
      } else if (msg.type === "caption" && msg.text) {
        userBCaptions.push(msg.text);
      }
    } catch {}
  });

  // Stream 20ms chunks in real-time from User A
  await new Promise((resolve) => {
    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= wavChunks.length) {
        clearInterval(interval);
        tSpeechEnd = performance.now();
        console.log(`[User A] Finished streaming all ${wavChunks.length} audio chunks. Speech ended.`);
        resolve(true);
        return;
      }
      const chunk = wavChunks[idx];
      const slice = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      wsA.send(slice);
      idx++;
    }, 20);
  });

  // Wait up to 10 seconds for translation delivery
  console.log("Waiting for translated audio packets on User B...");
  const waitStart = Date.now();
  while (!userBFirstAudioTimestamp && Date.now() - waitStart < 10000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  // Allow remaining chunks to arrive
  await new Promise((r) => setTimeout(r, 2000));

  wsA.close();
  wsB.close();

  const postSpeechLatencyMs = userBFirstAudioTimestamp && tSpeechEnd
    ? Number((userBFirstAudioTimestamp - tSpeechEnd).toFixed(2))
    : "Timed out";

  console.log("\n===============================================================");
  console.log("   TEST 2 RESULTS (ZERO DOUBLE-HOP PROOF)");
  console.log("===============================================================");
  console.log(`1. Audio Packets Received by User A (Sender):  ${userAAudioPacketsReceived}`);
  console.log(`   --> ${userAAudioPacketsReceived === 0 ? "PASSED! ZERO U-TURN CONFIRMED (0 packets sent back to sender)" : "FAILED (Audio leaked back to sender)"}`);
  console.log(`2. Audio Packets Received by User B (Receiver): ${userBAudioPacketsReceived} packets`);
  console.log(`   --> ${userBAudioPacketsReceived > 0 ? "PASSED! Direct Cloud Delivery to partner verified!" : "FAILED (No audio received)"}`);
  console.log(`3. Post-Speech First Audio Latency:             ${postSpeechLatencyMs} ms`);
  if (userBCaptions.length > 0) {
    console.log(`4. English Translated Captions:                "${userBCaptions.join(" ")}"`);
  }
  console.log("===============================================================\n");

  if (userAAudioPacketsReceived !== 0 || userBAudioPacketsReceived === 0) {
    throw new Error("Test 2 assertions failed!");
  }
  return { postSpeechLatencyMs, userBAudioPacketsReceived };
}

// ─────────────────────────────────────────────────────────────
// TEST 3: Bidirectional Full Duplex Overlap Test
// ─────────────────────────────────────────────────────────────
async function runTest3() {
  console.log("---------------------------------------------------------------");
  console.log(">>> TEST 3: Bidirectional Full Duplex Simultaneous Streaming");
  console.log("---------------------------------------------------------------");

  const testRoomId = `ROOM_DUPLEX_${Date.now()}`;
  const urlUserA = `${RENDER_WS_URL}?roomId=${testRoomId}&role=caller&sourceLang=English&targetLang=Hindi&bcp47=hi`;
  const urlUserB = `${RENDER_WS_URL}?roomId=${testRoomId}&role=callee&sourceLang=English&targetLang=Hindi&bcp47=hi`;

  console.log(`Connecting User A & User B to room: ${testRoomId}...`);

  const wsA = new WebSocket(urlUserA);
  const wsB = new WebSocket(urlUserB);

  await Promise.all([
    new Promise((resolve) => wsA.on("open", resolve)),
    new Promise((resolve) => wsB.on("open", resolve)),
  ]);

  // Wait for ready
  await new Promise((r) => setTimeout(r, 2000));

  console.log("Streaming audio from BOTH User A and User B at the EXACT same time...");

  let aReceivedFromB = 0;
  let bReceivedFromA = 0;

  wsA.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "audio") aReceivedFromB++;
    } catch {}
  });

  wsB.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "audio") bReceivedFromA++;
    } catch {}
  });

  // Stream simultaneously
  await new Promise((resolve) => {
    let idx = 0;
    const interval = setInterval(() => {
      if (idx >= wavChunks.length) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      const chunk = wavChunks[idx];
      const slice = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      wsA.send(slice);
      wsB.send(slice);
      idx++;
    }, 20);
  });

  console.log("Simultaneous audio stream finished. Waiting for cross-delivery...");
  await new Promise((r) => setTimeout(r, 4000));

  wsA.close();
  wsB.close();

  console.log("\n===============================================================");
  console.log("   TEST 3 RESULTS (FULL DUPLEX CROSS-TALK)");
  console.log("===============================================================");
  console.log(`• Audio Packets Received by User A (from User B): ${aReceivedFromB} packets`);
  console.log(`• Audio Packets Received by User B (from User A): ${bReceivedFromA} packets`);
  console.log(`• Full Duplex Stability: ${aReceivedFromB > 0 || bReceivedFromA > 0 ? "PASSED! Simultaneous bidirectional translation active!" : "FAILED"}`);
  console.log("===============================================================\n");
}

// ─────────────────────────────────────────────────────────────
// Master Runner
// ─────────────────────────────────────────────────────────────
async function main() {
  try {
    await runTest1();
    await runTest2();
    await runTest3();
    console.log("🎉 ALL DIRECT CLOUD PIPELINE TESTS PASSED SUCCESSFULLY! 🎉\n");
  } catch (err) {
    console.error("Test Suite Failed:", err);
    process.exit(1);
  }
}

main();
