/**
 * PeerManager — WebRTC peer connection with SSE-based signaling.
 */

import type { UserProfileInfo } from "./room-store";

type Role = "caller" | "callee";

interface SignalEvent {
  type: "offer" | "answer" | "ice" | "profile" | "room_full";
  payload: unknown;
  from: Role | "system";
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

export interface ChatMessagePayload {
  id: string;
  sender: string;
  senderAvatar: string;
  senderColor?: string;
  text?: string;
  file?: {
    name: string;
    size: number;
    type: string;
    dataUrl: string;
  };
  timestamp: number;
}

export class PeerManager {
  private pc: RTCPeerConnection;
  private roomId: string;
  private role: Role;
  private myLang?: string;
  private targetLang?: string;
  private myProfile?: UserProfileInfo;
  private sse: EventSource | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private _onRemoteStream?: (stream: MediaStream) => void;
  private _onStatusChange?: (status: string) => void;
  private _onPeerProfile?: (profile: UserProfileInfo) => void;
  private _onCaption?: (text: string) => void;
  private _onChatMessage?: (msg: ChatMessagePayload) => void;

  constructor(
    roomId: string,
    role: Role,
    myLang?: string,
    targetLang?: string,
    myProfile?: UserProfileInfo,
    iceServers?: RTCIceServer[]
  ) {
    this.roomId = roomId;
    this.role = role;
    this.myLang = myLang;
    this.targetLang = targetLang;
    this.myProfile = myProfile;
    this.pc = new RTCPeerConnection({ iceServers: iceServers && iceServers.length > 0 ? iceServers : STUN_SERVERS });

    if (this.role === "caller") {
      this.dataChannel = this.pc.createDataChannel("live-captions", { ordered: true });
      this._setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        console.log(`[WebRTC (${this.role})] DataChannel connected:`, event.channel.label);
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log(`[WebRTC (${this.role})] Local ICE candidate generated`);
        this._postSignal("ice", candidate.toJSON());
      }
    };

    this.pc.ontrack = (event) => {
      console.log(`[WebRTC (${this.role})] Remote track received!`, event.streams);
      if (event.streams?.[0]) {
        this._onRemoteStream?.(event.streams[0]);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC (${this.role})] ICE connection state: ${this.pc.iceConnectionState}`);
      this._onStatusChange?.(this.pc.iceConnectionState);
    };

    this.pc.onconnectionstatechange = () => {
      console.log(`[WebRTC (${this.role})] Connection state: ${this.pc.connectionState}`);
      this._onStatusChange?.(this.pc.connectionState);
    };
  }

  private _setupDataChannel(dc: RTCDataChannel): void {
    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "caption" && msg.text) {
          this._onCaption?.(msg.text);
        } else if (msg.type === "chat" && msg.payload) {
          this._onChatMessage?.(msg.payload);
        }
      } catch {
        if (typeof event.data === "string") {
          this._onCaption?.(event.data);
        }
      }
    };
  }

  /** Send real-time caption text over WebRTC DataChannel (Direct P2P, <5ms) */
  sendCaption(text: string): void {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        this.dataChannel.send(JSON.stringify({ type: "caption", text }));
      } catch (err) {
        console.warn("[WebRTC] Failed to send caption over DataChannel:", err);
      }
    }
  }

  /** Send P2P chat message or file attachment over WebRTC DataChannel */
  sendChatMessage(payload: ChatMessagePayload): void {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        this.dataChannel.send(JSON.stringify({ type: "chat", payload }));
      } catch (err) {
        console.warn("[WebRTC] Failed to send chat message over DataChannel:", err);
      }
    }
  }

  /** Add the Gemini-translated audio stream as the outgoing track */
  addTranslatedTrack(stream: MediaStream): void {
    const tracks = stream.getAudioTracks();
    console.log(`[WebRTC (${this.role})] Adding ${tracks.length} audio track(s)`);
    for (const track of tracks) {
      this.pc.addTrack(track, stream);
    }
  }

  onRemoteStream(cb: (stream: MediaStream) => void): void {
    this._onRemoteStream = cb;
  }

  onStatusChange(cb: (status: string) => void): void {
    this._onStatusChange = cb;
  }

  onPeerProfile(cb: (profile: UserProfileInfo) => void): void {
    this._onPeerProfile = cb;
  }

  onCaption(cb: (text: string) => void): void {
    this._onCaption = cb;
  }

  onChatMessage(cb: (msg: ChatMessagePayload) => void): void {
    this._onChatMessage = cb;
  }

  /** Start signaling — opens SSE and begins offer/answer exchange */
  async start(): Promise<void> {
    this._openSSE();

    // Broadcast our profile to any active or joining peer
    if (this.myProfile) {
      this._postSignal("profile", this.myProfile);
    }

    if (this.role === "caller") {
      await this._createAndPostOffer();
    }
  }

  private _openSSE(): void {
    let url = `/api/signal/stream?roomId=${encodeURIComponent(this.roomId)}`;
    if (this.myLang) url += `&myLang=${encodeURIComponent(this.myLang)}`;
    if (this.targetLang) url += `&targetLang=${encodeURIComponent(this.targetLang)}`;
    url += `&role=${encodeURIComponent(this.role)}`;

    console.log(`[WebRTC (${this.role})] Connecting SSE to ${url}`);
    this.sse = new EventSource(url);

    this.sse.onmessage = async (event) => {
      try {
        const signal = JSON.parse(event.data);
        if (signal.type === "room_full") {
          console.warn("[WebRTC] Room is full event received");
          this._onStatusChange?.("room_full");
          return;
        }
        await this._handleSignal(signal as SignalEvent);
      } catch (e) {
        console.error("[WebRTC] Error parsing SSE event:", e);
      }
    };

    this.sse.onerror = (err) => {
      console.warn("[WebRTC] SSE connection error:", err);
    };
  }

  private async _handleSignal(signal: SignalEvent): Promise<void> {
    // Ignore self messages
    if (signal.from === this.role) return;

    console.log(`[WebRTC (${this.role})] Received: ${signal.type} from ${signal.from}`);

    if (signal.type === "profile" && signal.payload) {
      console.log(`[WebRTC (${this.role})] Received peer profile:`, signal.payload);
      this._onPeerProfile?.(signal.payload as UserProfileInfo);
      return;
    }

    if (signal.type === "offer" && this.role === "callee") {
      try {
        await this.pc.setRemoteDescription(
          new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit)
        );
        console.log(`[WebRTC (callee)] Remote offer set. Creating answer...`);

        // Drain pending candidates
        for (const c of this.pendingCandidates) {
          await this.pc.addIceCandidate(new RTCIceCandidate(c));
        }
        this.pendingCandidates = [];

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        console.log(`[WebRTC (callee)] Local answer set. Posting answer...`);
        await this._postSignal("answer", answer);

        // Also reply with our profile if available
        if (this.myProfile) {
          await this._postSignal("profile", this.myProfile);
        }
      } catch (err) {
        console.error("[WebRTC (callee)] Failed to handle offer:", err);
      }
    }

    if (signal.type === "answer" && this.role === "caller") {
      try {
        if (this.pc.signalingState === "have-local-offer") {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit)
          );
          console.log(`[WebRTC (caller)] Remote answer set successfully.`);

          // Drain pending candidates
          for (const c of this.pendingCandidates) {
            await this.pc.addIceCandidate(new RTCIceCandidate(c));
          }
          this.pendingCandidates = [];

          // Also reply with our profile to ensure callee gets it
          if (this.myProfile) {
            await this._postSignal("profile", this.myProfile);
          }
        }
      } catch (err) {
        console.error("[WebRTC (caller)] Failed to set remote answer:", err);
      }
    }

    if (signal.type === "ice") {
      const candidateInit = signal.payload as RTCIceCandidateInit;
      try {
        if (this.pc.remoteDescription && this.pc.remoteDescription.type) {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } else {
          this.pendingCandidates.push(candidateInit);
        }
      } catch (e) {
        console.warn("[WebRTC] ICE candidate error:", e);
      }
    }
  }

  private async _createAndPostOffer(): Promise<void> {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this._postSignal("offer", offer);
    } catch (err) {
      console.error("[WebRTC (caller)] Error creating offer:", err);
    }
  }

  private async _postSignal(type: SignalEvent["type"], payload: unknown): Promise<void> {
    try {
      await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: this.roomId, type, payload, from: this.role }),
      });
    } catch (e) {
      console.error(`[WebRTC (${this.role})] Failed to POST signal ${type}:`, e);
    }
  }

  close(): void {
    this.sse?.close();
    this.pc.close();
  }
}