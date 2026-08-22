/**
 * AudioWorklet processor: captures mic Float32 audio,
 * applies anti-aliasing low-pass filter,
 * downsamples to 16kHz using boundary-safe linear interpolation,
 * converts to Int16 PCM, and posts 100ms chunks (1600 samples) to main thread.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetSampleRate = 16000;
    this._chunkSize = 1600; // 100ms at 16kHz
    this._resampleRatio = sampleRate / this._targetSampleRate;
    this._sourceIndex = 0;
    this._lastSample = 0;

    // Biquad low-pass filter (Cutoff 7200Hz) for anti-aliasing when downsampling
    if (sampleRate > this._targetSampleRate) {
      const fc = 7200;
      const omega = (2 * Math.PI * fc) / sampleRate;
      const cosw = Math.cos(omega);
      const sinw = Math.sin(omega);
      const alpha = sinw / (2 * Math.SQRT1_2);
      const a0 = 1 + alpha;
      this._b0 = ((1 - cosw) / 2) / a0;
      this._b1 = (1 - cosw) / a0;
      this._b2 = ((1 - cosw) / 2) / a0;
      this._a1 = (-2 * cosw) / a0;
      this._a2 = (1 - alpha) / a0;
      this._x1 = 0;
      this._x2 = 0;
      this._y1 = 0;
      this._y2 = 0;
      this._filterEnabled = true;
    } else {
      this._filterEnabled = false;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0]; // Float32Array
    const len = samples.length;
    if (len === 0) return true;

    // 1. Anti-aliasing low-pass filter
    let filtered = samples;
    if (this._filterEnabled) {
      filtered = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const x0 = samples[i];
        const y0 =
          this._b0 * x0 +
          this._b1 * this._x1 +
          this._b2 * this._x2 -
          this._a1 * this._y1 -
          this._a2 * this._y2;
        this._x2 = this._x1;
        this._x1 = x0;
        this._y2 = this._y1;
        this._y1 = y0;
        filtered[i] = y0;
      }
    }

    // 2. Continuous linear interpolation resampling across quantum boundaries
    while (this._sourceIndex < len) {
      const idx = Math.floor(this._sourceIndex);
      const frac = this._sourceIndex - idx;
      const s0 = idx < 0 ? this._lastSample : filtered[idx];
      const s1 = idx + 1 < len ? filtered[idx + 1] : filtered[len - 1];
      const sample = s0 * (1 - frac) + s1 * frac;
      this._buffer.push(sample);
      this._sourceIndex += this._resampleRatio;
    }
    this._sourceIndex -= len;
    this._lastSample = filtered[len - 1];

    // 3. Dispatch chunks of 1600 Int16 samples (100ms @ 16kHz)
    while (this._buffer.length >= this._chunkSize) {
      const chunk = this._buffer.splice(0, this._chunkSize);
      
      // Calculate RMS energy for UI speaking indicator (speech activity detection)
      let sumSq = 0;
      for (let i = 0; i < chunk.length; i++) {
        sumSq += chunk[i] * chunk[i];
      }
      const rms = Math.sqrt(sumSq / chunk.length);
      const isSpeech = rms >= 0.006;

      // Convert Float32 directly to Int16 PCM without hard-cutting samples to zeros
      // This allows Gemini Live native VAD to follow continuous Hindi/English speech natural pauses
      const int16 = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ type: "audio", buffer: int16.buffer, isSpeech }, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);