/**
 * GeminiLiveSession — isolated Gemini Live API client.
 */

import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Modality,
  type Session,
} from "@google/genai";

const PRIMARY_MODEL = "models/gemini-3.5-live-translate-preview";
const FALLBACK_MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";

function buildPrimaryConfig(targetBcp47: string): LiveConnectConfig {
  return {
    responseModalities: ["AUDIO" as Modality],
    translationConfig: {
      targetLanguageCode: targetBcp47,
      echoTargetLanguage: false,
    },
  };
}

function buildFallbackConfig(
  sourceLangLabel: string,
  targetLangLabel: string
): LiveConnectConfig {
  return {
    responseModalities: ["AUDIO" as Modality],
    systemInstruction: {
      parts: [
        {
          text: `You are a real-time speech interpreter. The user speaks in ${sourceLangLabel}. Translate everything immediately into ${targetLangLabel} and speak only the translated words clearly. Do not output anything else.`,
        },
      ],
    },
  };
}

export class GeminiLiveSession {
  private _session: Session | null = null;
  private _ai: GoogleGenAI;
  private _onAudioOutput?: (pcm: ArrayBuffer, sampleRate: number) => void;
  private _onTranscript?: (text: string) => void;
  private _onError?: (err: string) => void;
  private _connected = false;

  constructor(authToken: string) {
    this._ai = new GoogleGenAI({
      apiKey: authToken,
      httpOptions: { apiVersion: "v1alpha" },
    });
  }

  async connect(
    targetBcp47: string,
    sourceLangLabel: string,
    targetLangLabel: string
  ): Promise<void> {
    try {
      console.log("[Gemini] Connecting with primary model:", PRIMARY_MODEL, "target:", targetBcp47);
      await this._connectWithModel(PRIMARY_MODEL, buildPrimaryConfig(targetBcp47));
      console.log("[Gemini] Connected with primary model:", PRIMARY_MODEL);
      this._connected = true;
    } catch (primaryErr) {
      console.warn("[Gemini] Primary model failed, trying fallback:", primaryErr);
      try {
        await this._connectWithModel(
          FALLBACK_MODEL,
          buildFallbackConfig(sourceLangLabel, targetLangLabel)
        );
        console.log("[Gemini] Connected with fallback model:", FALLBACK_MODEL);
        this._connected = true;
      } catch (fallbackErr) {
        console.error("[Gemini] Fallback model also failed:", fallbackErr);
        throw fallbackErr;
      }
    }
  }

  private async _connectWithModel(
    model: string,
    config: LiveConnectConfig
  ): Promise<void> {
    const session = await this._ai.live.connect({
      model,
      config,
      callbacks: {
        onopen: () => {
          console.log(`[Gemini Live WebSocket] Open for: ${model}`);
        },
        onmessage: (msg: LiveServerMessage) => {
          this._handleMessage(msg);
        },
        onerror: (e: ErrorEvent) => {
          console.error("[Gemini Live WebSocket] Error:", e);
          this._onError?.(e.message || "Gemini Live error");
        },
        onclose: (e: CloseEvent) => {
          console.log("[Gemini Live WebSocket] Closed code:", e.code, "reason:", e.reason);
        },
      },
    });

    this._session = session;
  }

  private _handleMessage(msg: LiveServerMessage): void {
    // 1. Check for audio in model turn parts
    const parts = msg.serverContent?.modelTurn?.parts;
    if (parts && Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          const pcmBytes = base64ToArrayBuffer(part.inlineData.data);
          const mimeType = part.inlineData.mimeType || "";
          const rateMatch = mimeType.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
          console.log(`[Gemini Live] Received audio chunk: ${pcmBytes.byteLength} bytes @ ${sampleRate}Hz`);
          this._onAudioOutput?.(pcmBytes, sampleRate);
        }
        if (part.text) {
          console.log("[Gemini Live] Model text:", part.text);
          this._onTranscript?.(part.text);
        }
      }
    }

    // 2. Convenience getter fallback
    if ((!parts || parts.length === 0) && msg.data) {
      const pcmBytes = base64ToArrayBuffer(msg.data);
      console.log(`[Gemini Live] Received msg.data audio chunk: ${pcmBytes.byteLength} bytes`);
      this._onAudioOutput?.(pcmBytes, 24000);
    }
  }

  sendAudioChunk(int16Buffer: ArrayBuffer): void {
    if (!this._session) return;
    try {
      const base64 = arrayBufferToBase64(int16Buffer);
      // 'media' parameter correctly maps to 'mediaChunks' in Google Live API
      this._session.sendRealtimeInput({
        media: {
          data: base64,
          mimeType: "audio/pcm;rate=16000",
        },
      });
    } catch (err) {
      console.warn("[Gemini] Failed to send audio chunk:", err);
    }
  }

  onAudioOutput(cb: (pcm: ArrayBuffer, sampleRate: number) => void): void {
    this._onAudioOutput = cb;
  }

  onTranscript(cb: (text: string) => void): void {
    this._onTranscript = cb;
  }

  onError(cb: (err: string) => void): void {
    this._onError = cb;
  }

  disconnect(): void {
    this._connected = false;
    try {
      this._session?.close();
    } catch {
      /* ignore */
    }
    this._session = null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}