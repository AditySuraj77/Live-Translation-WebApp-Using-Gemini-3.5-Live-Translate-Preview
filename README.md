# LiveTranslate MVP

Real-time 1-to-1 voice translation using Gemini Live API + WebRTC.

## Prerequisites

- Node.js 18+
- A Gemini API key with access to `gemini-3.5-live-translate-preview`
  - Get one at: https://aistudio.google.com/apikey

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your key:

```
GEMINI_API_KEY=your_gemini_api_key_here
```

## Start the Development Server

```bash
npm run dev
```

Open http://localhost:3000

## Testing Hindi ↔ English Translation

1. Open **two browser tabs** at http://localhost:3000

**Tab 1 (Caller — speaks Hindi):**
- Select "I speak: Hindi" and "They speak: English"
- Click **Create Room**
- Copy the 6-character Room ID shown on screen

**Tab 2 (Callee — speaks English):**
- Paste the Room ID
- Select "I speak: English" and "They speak: Hindi"
- Click **Join Room**

3. Allow microphone access in both tabs
4. Wait for status to show **Connected**
5. Speak in Hindi in Tab 1 → Tab 2 hears English translation
6. Speak in English in Tab 2 → Tab 1 hears Hindi translation

## Architecture

```
Browser A mic → AudioWorklet (16kHz PCM) → Gemini Live (translationConfig: targetLanguageCode: "en")
             → translated PCM → MediaStreamDestinationNode → WebRTC → Browser B speaker

Browser B mic → AudioWorklet (16kHz PCM) → Gemini Live (translationConfig: targetLanguageCode: "hi")
             → translated PCM → MediaStreamDestinationNode → WebRTC → Browser A speaker
```

- Signaling: SSE (GET /api/signal/stream) + HTTP POST (/api/signal)
- No audio goes through the server — WebRTC is peer-to-peer
- Gemini model: `gemini-3.5-live-translate-preview` (fallback: `gemini-2.5-flash-native-audio-preview-12-2025`)

## Known Limitations

- STUN only — may not work across different networks (no TURN server)
- In-memory signaling state resets on server restart
- Only English and Hindi supported (add more in `lib/languages.ts`)
- Preview model — subject to Google API quota limits
- Must be tested in Chromium-based browsers (AudioWorklet + WebRTC support)