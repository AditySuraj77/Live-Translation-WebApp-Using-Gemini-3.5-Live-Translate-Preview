/**
 * PeerManager — WebRTC peer connection with SSE-based signaling.
 */

import type { UserProfileInfo } from "./room-store";
import { getPusherClient } from "@/lib/pusher-client";
import type { Channel } from "pusher-js";

type Role = "caller" | "callee";

interface SignalEvent {
  type: "offer" | "answer" | "ice" | "profile" | "room_full" | "peer_left" | "peer_joined" | "promoted_to_host";
  payload: unknown;
  from: Role | "system";
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
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

export interface UserLocation {
  city: string;
  country: string;
  countryCode: string;
  flag: string;
  lat: number;
  lon: number;
}

export class PeerManager {
  private pc: RTCPeerConnection;
  private roomId: string;
  private role: Role;
  private myLang?: string;
  private targetLang?: string;
  private myProfile?: UserProfileInfo;
  private myLocation?: UserLocation;
  private iceServers: RTCIceServer[];
  private translatedStream: MediaStream | null = null;
  private sse: EventSource | null = null;
  private pusherChannel: Channel | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private _onRemoteStream?: (stream: MediaStream) => void;
  private _onStatusChange?: (status: string) => void;
  private _onPeerProfile?: (profile: UserProfileInfo) => void;
  private _onPeerLeft?: (role: string) => void;
  private _onCaption?: (text: string) => void;
  private _onChatMessage?: (msg: ChatMessagePayload) => void;
  private _onPeerSpeaking?: (isSpeaking: boolean) => void;
  private _onPeerLocation?: (location: UserLocation) => void;

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
    this.iceServers = iceServers && iceServers.length > 0 ? iceServers : STUN_SERVERS;
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

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

    this._setupPeerConnectionListeners();
  }

  private _setupPeerConnectionListeners(): void {
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

      // Auto-recover on network interruption or switch (e.g. Wi-Fi to 5G)
      if (this.pc.iceConnectionState === "failed") {
        console.warn(`[WebRTC (${this.role})] ICE connection failed. Initiating seamless ICE restart...`);
        if (typeof this.pc.restartIce === "function") {
          try {
            this.pc.restartIce();
            if (this.role === "caller") {
              this._createAndPostOffer().catch((err) =>
                console.warn("[WebRTC] ICE restart offer failed:", err)
              );
            }
          } catch (err) {
            console.warn("[WebRTC] restartIce error:", err);
          }
        }
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log(`[WebRTC (${this.role})] Connection state: ${this.pc.connectionState}`);
      this._onStatusChange?.(this.pc.connectionState);
    };
  }

  private _setupDataChannel(dc: RTCDataChannel): void {
    dc.onopen = () => {
      console.log(`[WebRTC (${this.role})] DataChannel open`);
      if (this.myLocation) {
        this.sendLocation(this.myLocation);
      }
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "caption" && msg.text) {
          this._onCaption?.(msg.text);
        } else if (msg.type === "chat" && msg.payload) {
          this._onChatMessage?.(msg.payload);
        } else if (msg.type === "speaking") {
          this._onPeerSpeaking?.(Boolean(msg.isSpeaking));
        } else if (msg.type === "location" && msg.location) {
          this._onPeerLocation?.(msg.location);
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

  /** Send real-time speech activity state over WebRTC DataChannel (0ms, instant visual turn-taking) */
  sendSpeakingState(isSpeaking: boolean): void {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        this.dataChannel.send(JSON.stringify({ type: "speaking", isSpeaking }));
      } catch (err) {
        console.warn("[WebRTC] Failed to send speaking state:", err);
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

  /** Send user geographic location over WebRTC DataChannel */
  sendLocation(location: UserLocation): void {
    this.myLocation = location;
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      try {
        this.dataChannel.send(JSON.stringify({ type: "location", location }));
      } catch (err) {
        console.warn("[WebRTC] Failed to send location over DataChannel:", err);
      }
    }
  }

  /** Add the Gemini-translated audio stream as the outgoing track */
  addTranslatedTrack(stream: MediaStream): void {
    this.translatedStream = stream;
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

  onPeerLeft(cb: (role: string) => void): void {
    this._onPeerLeft = cb;
  }

  onCaption(cb: (text: string) => void): void {
    this._onCaption = cb;
  }

  onChatMessage(cb: (msg: ChatMessagePayload) => void): void {
    this._onChatMessage = cb;
  }

  onPeerSpeaking(cb: (isSpeaking: boolean) => void): void {
    this._onPeerSpeaking = cb;
  }

  onPeerLocation(cb: (location: UserLocation) => void): void {
    this._onPeerLocation = cb;
  }

  /** Reset RTCPeerConnection and send fresh offer when previous guest leaves and new guest arrives */
  async resetAndCreateOfferForNewGuest(): Promise<void> {
    console.log(`[WebRTC (${this.role})] Re-initializing PeerConnection for incoming guest...`);
    try {
      this.pc.close();
    } catch {
      /* ignore */
    }

    this.pendingCandidates = [];
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this._setupPeerConnectionListeners();

    if (this.role === "caller") {
      this.dataChannel = this.pc.createDataChannel("live-captions", { ordered: true });
      this._setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }

    if (this.translatedStream) {
      for (const track of this.translatedStream.getAudioTracks()) {
        this.pc.addTrack(track, this.translatedStream);
      }
    }

    if (this.role === "caller") {
      await this._createAndPostOffer();
    }

    if (this.myProfile) {
      await this._postSignal("profile", this.myProfile);
    }
  }

  /** Start signaling — connects via Pusher real-time WebSocket with SSE fallback */
  async start(): Promise<void> {
    this._connectSignaling();

    // Broadcast our profile to any active or joining peer
    if (this.myProfile) {
      this._postSignal("profile", this.myProfile);
    }

    if (this.role === "caller") {
      await this._createAndPostOffer();
    }
  }

  private _connectSignaling(): void {
    const pusher = getPusherClient();
    if (pusher) {
      const channelName = `presence-room-${this.roomId.toUpperCase()}`;
      console.log(`[WebRTC (${this.role})] Subscribing to Pusher channel: ${channelName}`);

      const channel = pusher.subscribe(channelName);
      this.pusherChannel = channel;

      channel.bind("signal", async (signal: SignalEvent) => {
        await this._handleSignal(signal);
      });

      channel.bind("pusher:subscription_succeeded", async (members: any) => {
        console.log(`[WebRTC (${this.role})] Pusher subscription succeeded for ${channelName}. Members count:`, members?.count);
        if (this.role === "caller" && members?.count > 1) {
          console.log(`[WebRTC (${this.role})] Peer already in room upon subscription. Posting offer & profile...`);
          if (this.myProfile) {
            this._postSignal("profile", this.myProfile);
          }
          await this._createAndPostOffer();
        }
        if (this.role === "callee") {
          console.log(`[WebRTC (${this.role})] Callee joined channel. Announcing presence to caller...`);
          if (this.myProfile) {
            this._postSignal("profile", this.myProfile);
          }
          this._postSignal("peer_joined", { role: "callee" });
        }
      });

      // When guest joins the room, host immediately sends fresh offer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel.bind("pusher:member_added", async (member: any) => {
        console.log(`[WebRTC (${this.role})] Pusher member added:`, member);
        if (this.role === "caller") {
          console.log(`[WebRTC (${this.role})] Guest arrived in room! Sending profile and offer...`);
          if (this.myProfile) {
            this._postSignal("profile", this.myProfile);
          }
          await this._createAndPostOffer();
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel.bind("pusher:subscription_error", (err: any) => {
        console.warn(`[WebRTC (${this.role})] Pusher subscription error:`, err);
        if (err?.status === 403) {
          this._onStatusChange?.("room_full");
        } else {
          // Fallback to SSE if Pusher connection encounters an error
          this._openSSE();
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel.bind("pusher:member_removed", (member: any) => {
        console.log(`[WebRTC (${this.role})] Pusher member removed:`, member);
        const leftRole = this.role === "caller" ? "callee" : "caller";
        this._onPeerLeft?.(leftRole);
        if (this.role === "caller") {
          this._onStatusChange?.("waiting_for_peer");
          this.resetAndCreateOfferForNewGuest().catch(console.warn);
        }
      });
    } else {
      console.log(`[WebRTC (${this.role})] Pusher not available, using SSE stream`);
      this._openSSE();
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

    if (signal.type === "peer_left") {
      console.log(`[WebRTC (${this.role})] Peer left room:`, signal.payload);
      this._onPeerLeft?.(signal.from || "callee");
      if (this.role === "caller") {
        this._onStatusChange?.("waiting_for_peer");
        this.resetAndCreateOfferForNewGuest().catch(console.warn);
      }
      return;
    }

    if (signal.type === "peer_joined") {
      console.log(`[WebRTC (${this.role})] Peer joined signal received:`, signal.payload);
      if (this.role === "caller") {
        console.log("[WebRTC (caller)] Re-sending offer to freshly joined peer");
        if (this.myProfile) {
          this._postSignal("profile", this.myProfile);
        }
        await this._createAndPostOffer();
      }
      return;
    }

    if (signal.type === "profile" && signal.payload) {
      console.log(`[WebRTC (${this.role})] Received peer profile:`, signal.payload);
      this._onPeerProfile?.(signal.payload as UserProfileInfo);
      if (this.role === "caller") {
        if (
          this.pc.connectionState === "disconnected" ||
          this.pc.connectionState === "failed" ||
          this.pc.iceConnectionState === "disconnected" ||
          this.pc.iceConnectionState === "failed"
        ) {
          console.log("[WebRTC (caller)] Re-negotiating fresh offer for incoming guest profile");
          this.resetAndCreateOfferForNewGuest().catch(console.warn);
        } else if (this.pc.signalingState === "stable" && this.pc.connectionState !== "connected") {
          this._createAndPostOffer().catch(console.warn);
        }
      }
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
    if (this.pusherChannel) {
      const pusher = getPusherClient();
      pusher?.unsubscribe(`presence-room-${this.roomId.toUpperCase()}`);
      this.pusherChannel = null;
    }
    this.sse?.close();
    this.pc.close();
  }
}