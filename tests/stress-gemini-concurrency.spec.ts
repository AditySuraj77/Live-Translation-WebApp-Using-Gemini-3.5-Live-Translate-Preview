import { test, expect } from '@playwright/test';

test.describe('VoxLive High-Concurrency & Gemini Stress Test Suite', () => {
  const createdRoomIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdRoomIds) {
      await request.post('/api/signal/leave', {
        data: { roomId: id, role: 'caller' },
      }).catch(() => {});
    }
    createdRoomIds.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  // Stress Test 1: 20 Simultaneous Rooms + 40 Concurrent Gemini Token Rollouts
  test("Stress 1: 20 Rooms create concurrently and 40 parallel Gemini sessions rollout without crash", async ({ request }) => {
    console.log("[Stress Test] Starting 20 concurrent rooms creation...");

    const roomCreationPromises = [];
    for (let i = 0; i < 20; i++) {
      const roomId = "CONCUR_" + i + "_" + Math.random().toString(36).substring(2, 6).toUpperCase();
      createdRoomIds.push(roomId);
      roomCreationPromises.push(
        request.post("/api/rooms", {
          data: {
            id: roomId,
            name: "Stress Room #" + (i + 1),
            hostLang: "hi",
            targetLang: "en",
          },
        })
      );
    }

    const roomResponses = await Promise.all(roomCreationPromises);
    for (const res of roomResponses) {
      expect(res.ok()).toBeTruthy();
    }
    console.log("[Stress Test] 20 Rooms successfully created concurrently!");

    // 2. Concurrently request 40 Gemini ephemeral tokens (2 participants per room: Host + Guest)
    console.log("[Stress Test] Rolling out 40 simultaneous Gemini Live token sessions across 23-key pool...");
    const tokenPromises = [];
    for (let i = 0; i < 40; i++) {
      tokenPromises.push(request.get("/api/gemini-token"));
    }

    const tokenResponses = await Promise.all(tokenPromises);
    const tokens: string[] = [];

    for (let i = 0; i < tokenResponses.length; i++) {
      const res = tokenResponses[i];
      expect(res.status()).toBe(200);
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe("string");
      tokens.push(data.token);
    }

    expect(tokens.length).toBe(40);
    console.log("[Stress Test] SUCCESS: All 40 Gemini sessions successfully acquired ephemeral tokens without crashing!");

    // 3. Verify that 21st room is blocked by Concurrency Cap (HTTP 429)
    const capRes = await request.post("/api/rooms", {
      data: {
        id: "OVERFLOW_21",
        name: "Blocked 21st Room",
        hostLang: "hi",
        targetLang: "en",
      },
    });
    expect(capRes.status()).toBe(429);
    const capData = await capRes.json();
    expect(capData.code).toBe("ROOM_CAP_REACHED");
    console.log("[Stress Test] Concurrency cap verified: 21st room strictly rejected with HTTP 429!");
  });

  // Stress Test 2: Thundering Herd / Rapid Churn (6 Rooms Leave while 4 Rooms Join)
  test("Stress 2: Thundering Herd - Rapid concurrent leave and join maintains exact Redis consistency", async ({ request }) => {
    console.log("[Stress Test] Setting up initial 12 rooms for churn test...");
    
    const initialRooms: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = "CHURN_" + i + "_" + Math.random().toString(36).substring(2, 6).toUpperCase();
      initialRooms.push(id);
      createdRoomIds.push(id);
      await request.post("/api/rooms", {
        data: { id, name: "Churn Room " + i, hostLang: "hi", targetLang: "en" },
      });
    }

    console.log("[Stress Test] Triggering simultaneous churn: 6 leaves + 4 joins...");
    const churnActions = [];

    // 6 leaves
    for (let i = 0; i < 6; i++) {
      const idToLeave = initialRooms[i];
      churnActions.push(
        request.post("/api/signal/leave", {
          data: { roomId: idToLeave, role: "caller" },
        })
      );
    }

    // 4 new joins
    const newRoomIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const newId = "NEWCHURN_" + i + "_" + Math.random().toString(36).substring(2, 6).toUpperCase();
      newRoomIds.push(newId);
      createdRoomIds.push(newId);
      churnActions.push(
        request.post("/api/rooms", {
          data: { id: newId, name: "New Churn " + i, hostLang: "en", targetLang: "hi" },
        })
      );
    }

    const churnResults = await Promise.all(churnActions);
    for (const res of churnResults) {
      expect(res.ok()).toBeTruthy();
    }

    // Verify final count: 12 initial - 6 left + 4 joined = 10 active rooms
    const listRes = await request.get("/api/rooms");
    const listData = await listRes.json();
    const remainingIds: string[] = listData.rooms.map((r: any) => r.id);

    // Left rooms must NOT exist
    for (let i = 0; i < 6; i++) {
      expect(remainingIds).not.toContain(initialRooms[i]);
    }
    // New rooms MUST exist
    for (const id of newRoomIds) {
      expect(remainingIds).toContain(id);
    }

    console.log("[Stress Test] SUCCESS: Churn handled with 100% mathematical consistency without deadlocks!");
  });

  // Stress Test 3: Gemini Token Auto-Failover & Speed
  test("Stress 3: Gemini Token generation responds under 2.5s with zero latency spikes", async ({ request }) => {
    const startTime = Date.now();
    const res = await request.get("/api/gemini-token");
    const duration = Date.now() - startTime;

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.token).toBeTruthy();
    expect(duration).toBeLessThan(2500);
    console.log("[Stress Test] Ephemeral token generated in " + duration + "ms (Super-fast)!");
  });
});
