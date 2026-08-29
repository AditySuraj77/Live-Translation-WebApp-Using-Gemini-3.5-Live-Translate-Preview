/**
 * Audio utilities for the translation pipeline.
 */

/**
 * Convert Float32Array → Int16Array (for Gemini PCM input).
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Decode raw Int16 PCM from Gemini → AudioBuffer for playback.
 */
export function pcmToAudioBuffer(
  ctx: AudioContext,
  int16Data: ArrayBuffer,
  sampleRate: number
): AudioBuffer {
  const int16 = new Int16Array(int16Data);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  const buffer = ctx.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);
  return buffer;
}

/**
 * Create a MediaStreamDestinationNode fed by a queue of AudioBuffers.
 * The .stream is added as the WebRTC outgoing track.
 */
export function createTranslatedMediaStream(ctx: AudioContext): {
  node: MediaStreamAudioDestinationNode;
  stream: MediaStream;
  enqueue: (buf: AudioBuffer) => void;
  flush: () => void;
} {
  const dest = ctx.createMediaStreamDestination();
  let nextPlayTime = 0;
  const JITTER_BUFFER_SEC = 0.04; // 40ms lean jitter buffer for Google Meet-like low latency
  const activeSources = new Set<AudioBufferSourceNode>();

  function enqueue(buf: AudioBuffer) {
    if (ctx.state === "suspended") {
      ctx.resume().catch((e) => console.warn("Could not resume AudioContext:", e));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);

    activeSources.add(src);
    src.onended = () => {
      activeSources.delete(src);
    };

    const now = ctx.currentTime;
    // If queue was empty or fell behind, start with minimal lead time (40ms)
    if (nextPlayTime <= now) {
      nextPlayTime = now + JITTER_BUFFER_SEC;
    }

    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
  }

  function flush() {
    for (const src of Array.from(activeSources)) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        /* ignore */
      }
    }
    activeSources.clear();
    nextPlayTime = ctx.currentTime;
  }

  return { node: dest, stream: dest.stream, enqueue, flush };
}