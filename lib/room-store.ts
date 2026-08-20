export interface SignalEvent {
  type: "offer" | "answer" | "ice";
  payload: unknown;
  from: "caller" | "callee";
}

export interface RoomEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribers: Set<ReadableStreamDefaultController<any>>;
  queue: SignalEvent[];
}

declare global {
  // eslint-disable-next-line no-var
  var __liveRooms: Map<string, RoomEntry> | undefined;
}

if (!globalThis.__liveRooms) {
  globalThis.__liveRooms = new Map<string, RoomEntry>();
}

export const roomStore = globalThis.__liveRooms;

export function getOrCreateRoom(roomId: string): RoomEntry {
  if (!roomStore.has(roomId)) {
    roomStore.set(roomId, { subscribers: new Set(), queue: [] });
  }
  return roomStore.get(roomId)!;
}

export function encodeSSE(event: SignalEvent | object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}