import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  type RemoteTrack,
  type RemoteParticipant,
} from "livekit-client";
import type { UserProfileInfo } from "./room-store";
import type { ChatMessagePayload, UserLocation } from "./webrtc";

export type Role = "caller" | "callee";

export class LiveKitPeerManager {
  private room: Room;
  private roomId: string;
  private role: Role;
  private myProfile?: UserProfileInfo;
  private myLocation?: UserLocation;
  private translatedStream: MediaStream | null = null;

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
    myProfile?: UserProfileInfo
  ) {
    this.roomId = roomId.toUpperCase();
    this.role = role;
    this.myProfile = myProfile;

    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });

    this._setupListeners();
  }

  private _setupListeners(): void {
    // 1. Audio track received from remote partner
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      console.log(`[LiveKit (${this.role})] Remote track subscribed:`, track.kind);
      if (track.kind === Track.Kind.Audio) {
        const stream = new MediaStream([track.mediaStreamTrack]);
        this._onRemoteStream?.(stream);
      }
    });

    // 2. Data packets (Subtitles, Speaking indicator, Chat, Profile, Location)
    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const str = new TextDecoder().decode(payload);
        const data = JSON.parse(str);

        if (data.type === "caption" && data.text) {
          this._onCaption?.(data.text);
        } else if (data.type === "speaking") {
          this._onPeerSpeaking?.(Boolean(data.isSpeaking));
        } else if (data.type === "chat" && data.payload) {
          this._onChatMessage?.(data.payload);
        } else if (data.type === "location" && data.location) {
          this._onPeerLocation?.(data.location);
        } else if (data.type === "profile" && data.profile) {
          this._onPeerProfile?.(data.profile);
        }
      } catch (err) {
        console.warn("[LiveKit] Error parsing data packet:", err);
      }
    });

    // 3. Remote partner joined
    this.room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      console.log(`[LiveKit (${this.role})] Remote participant connected:`, participant.identity);
      this._onStatusChange?.("connected");

      // Send local profile and location immediately
      if (this.myProfile) {
        this._sendData({ type: "profile", profile: this.myProfile });
      }
      if (this.myLocation) {
        this._sendData({ type: "location", location: this.myLocation });
      }
    });

    // 4. Remote partner disconnected
    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      console.log(`[LiveKit (${this.role})] Remote participant disconnected:`, participant.identity);
      const leftRole = participant.identity.startsWith("caller") ? "caller" : "callee";
      this._onPeerLeft?.(leftRole);

      if (this.role === "caller") {
        this._onStatusChange?.("waiting_for_peer");
      } else {
        this._onStatusChange?.("disconnected");
      }
    });

    // 5. Connection state changes
    this.room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      console.log(`[LiveKit (${this.role})] Connection state changed:`, state);
      if (state === ConnectionState.Connected) {
        if (this.room.remoteParticipants.size > 0) {
          this._onStatusChange?.("connected");
        } else {
          this._onStatusChange?.("waiting_for_peer");
        }
      } else if (state === ConnectionState.Disconnected) {
        this._onStatusChange?.("disconnected");
      }
    });
  }

  private _sendData(data: unknown, reliable = true): void {
    if (this.room.state !== ConnectionState.Connected) return;
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      this.room.localParticipant.publishData(bytes, { reliable });
    } catch (err) {
      console.warn("[LiveKit] Failed to publish data packet:", err);
    }
  }

  async start(): Promise<void> {
    try {
      this._onStatusChange?.("connecting");
      const name = this.myProfile?.name || (this.role === "caller" ? "Host User" : "Guest User");
      const res = await fetch(
        `/api/livekit-token?roomId=${encodeURIComponent(this.roomId)}&role=${encodeURIComponent(
          this.role
        )}&name=${encodeURIComponent(name)}`
      );

      if (!res.ok) {
        throw new Error(`LiveKit token request failed with status ${res.status}`);
      }

      const { token, wsUrl } = await res.json();
      console.log(`[LiveKit (${this.role})] Connecting to LiveKit Cloud:`, wsUrl);

      await this.room.connect(wsUrl, token, { autoSubscribe: true });
      console.log(`[LiveKit (${this.role})] Successfully connected to room:`, this.roomId);

      // Publish outgoing translated audio track if stream is already loaded
      if (this.translatedStream) {
        await this._publishAudioTrack(this.translatedStream);
      }

      // If remote participants are already in the room, notify connected status
      if (this.room.remoteParticipants.size > 0) {
        this._onStatusChange?.("connected");
        if (this.myProfile) {
          this._sendData({ type: "profile", profile: this.myProfile });
        }
        if (this.myLocation) {
          this._sendData({ type: "location", location: this.myLocation });
        }
      } else {
        this._onStatusChange?.("waiting_for_peer");
      }
    } catch (err) {
      console.error("[LiveKit] Connection error:", err);
      this._onStatusChange?.("failed");
      throw err;
    }
  }

  private async _publishAudioTrack(stream: MediaStream): Promise<void> {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      await this.room.localParticipant.publishTrack(audioTrack, {
        name: "translated-audio",
        source: Track.Source.Microphone,
        dtx: true,
        red: true,
      });
      console.log(`[LiveKit (${this.role})] Published translated audio track!`);
    } catch (err) {
      console.error("[LiveKit] Failed to publish translated audio track:", err);
    }
  }

  addTranslatedTrack(stream: MediaStream): void {
    this.translatedStream = stream;
    if (this.room.state === ConnectionState.Connected) {
      this._publishAudioTrack(stream).catch(console.error);
    }
  }

  sendCaption(text: string): void {
    this._sendData({ type: "caption", text }, true);
  }

  sendSpeakingState(isSpeaking: boolean): void {
    this._sendData({ type: "speaking", isSpeaking }, false); // Lossy/unreliable for 0ms speed
  }

  sendChatMessage(payload: ChatMessagePayload): void {
    this._sendData({ type: "chat", payload }, true);
  }

  sendLocation(location: UserLocation): void {
    this.myLocation = location;
    this._sendData({ type: "location", location }, true);
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

  close(): void {
    try {
      this.room.disconnect();
    } catch {
      /* ignore */
    }
  }
}
