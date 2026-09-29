export interface UserProfileInfo {
  name: string;
  avatar: string;
  color?: string;
}

export interface RoomMetadata {
  id: string;
  name?: string;
  hostLang: string;
  targetLang: string;
  hostProfile?: UserProfileInfo;
  createdAt: number;
}

export interface RoomEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribers: Set<ReadableStreamDefaultController<any>>;
  metadata?: RoomMetadata;
  cleanupTimer?: NodeJS.Timeout;
}

declare global {
  // eslint-disable-next-line no-var
  var __liveRooms: Map<string, RoomEntry> | undefined;
}

if (!globalThis.__liveRooms) {
  globalThis.__liveRooms = new Map<string, RoomEntry>();
}

export const roomStore = globalThis.__liveRooms;

export function getOrCreateRoom(roomId: string, metadata?: Partial<RoomMetadata>): RoomEntry {
  if (!roomStore.has(roomId)) {
    roomStore.set(roomId, { subscribers: new Set() });
  }
  const entry = roomStore.get(roomId)!;
  if (metadata) {
    entry.metadata = {
      id: roomId,
      name: metadata.name || entry.metadata?.name || `Room ${roomId}`,
      hostLang: metadata.hostLang || entry.metadata?.hostLang || "hi",
      targetLang: metadata.targetLang || entry.metadata?.targetLang || "en",
      hostProfile: metadata.hostProfile || entry.metadata?.hostProfile,
      createdAt: entry.metadata?.createdAt || Date.now(),
    };
  }
  return entry;
}

// Auto-cleanup stale rooms every 5 minutes (in-memory GC)
const MAX_ROOM_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function cleanupStaleRooms() {
  const now = Date.now();
  for (const [id, entry] of Array.from(roomStore.entries())) {
    const age = now - (entry.metadata?.createdAt || 0);
    if (entry.subscribers.size === 0 && age > MAX_ROOM_AGE_MS) {
      roomStore.delete(id);
      console.log(`[RoomStore] GC: Removed stale room ${id} (age: ${Math.round(age / 60000)}min)`);
    }
  }
}

// Only run cleanup in server environment
if (typeof window === 'undefined') {
  setInterval(cleanupStaleRooms, CLEANUP_INTERVAL_MS);
}