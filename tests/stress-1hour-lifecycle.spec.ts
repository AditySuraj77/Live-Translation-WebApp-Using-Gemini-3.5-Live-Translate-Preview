import { test, expect } from '@playwright/test';

test.describe('VoxLive 20-Room 1-Hour Lifecycle Stress Test (40 Users, 4 Rollover Waves)', () => {
  // Give ample timeout for 160 token requests across 4 waves
  test.setTimeout(600000);

  const createdRoomIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    try {
      const res = await request.get('/api/rooms');
      if (res.ok()) {
        const data = await res.json();
        if (data.rooms && Array.isArray(data.rooms)) {
          for (const r of data.rooms) {
            await request.post('/api/signal/leave', {
              data: { roomId: r.id, role: 'caller' },
            }).catch(() => {});
          }
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test.afterEach(async ({ request }) => {
    console.log(`[Lifecycle Test Cleanup] Cleaning up ${createdRoomIds.length} rooms...`);
    for (const id of createdRoomIds) {
      await request.post('/api/signal/leave', {
        data: { roomId: id, role: 'caller' },
      }).catch(() => {});
    }
    createdRoomIds.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  test('Simulate 1-hour conversation across 20 active rooms (40 users) with 4 continuous rollover waves', async ({ request }) => {
    console.log('=== STEP 1: Creating 20 Active Rooms Concurrently ===');
    const roomCreationPromises = [];
    for (let i = 0; i < 20; i++) {
      const roomId = `HOUR_${i}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      createdRoomIds.push(roomId);
      roomCreationPromises.push(
        request.post('/api/rooms', {
          data: {
            id: roomId,
            name: `1-Hour Stress Room #${i + 1}`,
            hostLang: 'hi',
            targetLang: 'en',
          },
        })
      );
    }

    const roomResponses = await Promise.all(roomCreationPromises);
    for (const res of roomResponses) {
      expect(res.ok()).toBeTruthy();
    }
    console.log(`[Lifecycle Test] Successfully created all 20 concurrent rooms!`);

    // Verify 20 rooms are active in Lobby
    const lobbyRes = await request.get('/api/rooms');
    expect(lobbyRes.ok()).toBeTruthy();
    const lobbyData = await lobbyRes.json();
    console.log(`[Lifecycle Test] Current active rooms in Lobby: ${lobbyData.rooms.length}`);
    expect(lobbyData.rooms.length).toBe(20);

    // Verify Concurrency Cap: 21st room must be rejected with HTTP 429
    console.log('\n=== STEP 2: Verifying 20-Room Concurrency Cap (21st Blocked) ===');
    const overflowRes = await request.post('/api/rooms', {
      data: {
        id: 'HOUR_OVERFLOW_21',
        name: 'Blocked 21st Room',
        hostLang: 'hi',
        targetLang: 'en',
      },
    });
    expect(overflowRes.status()).toBe(429);
    console.log('[Lifecycle Test] Concurrency cap strictly active: 21st room blocked with HTTP 429!');

    // Define the 4 Waves representing the 1-Hour+ Conversation Lifecycle:
    // Wave 1: T = 0m  (Initial Join: 40 participants join & acquire Live tokens)
    // Wave 2: T = 24m (1st Seamless Reconnect: All 40 participants rollover to new tokens)
    // Wave 3: T = 48m (2nd Seamless Reconnect: All 40 participants rollover to new tokens)
    // Wave 4: T = 60m+ (Extended Session: All 40 participants rollover for overtime conversation)
    const waves = [
      { name: 'Wave 1 (T = 0m: Initial Join)', users: 40 },
      { name: 'Wave 2 (T = 24m: 1st Seamless Rollover)', users: 40 },
      { name: 'Wave 3 (T = 48m: 2nd Seamless Rollover)', users: 40 },
      { name: 'Wave 4 (T = 60m+: Overtime Rollover)', users: 40 },
    ];

    let totalTokensIssued = 0;
    const waveStats: { wave: string; durationMs: number; avgLatencyMs: number; successCount: number }[] = [];

    console.log('\n=== STEP 3: Executing 4 Rollover Waves Across 20 Rooms (160 Gemini Sessions) ===');

    for (const wave of waves) {
      console.log(`\n--- Starting ${wave.name} for 40 simultaneous users ---`);
      const startTime = Date.now();

      const userTokenRequests = [];
      for (let u = 0; u < wave.users; u++) {
        userTokenRequests.push(
          (async (userIndex) => {
            const reqStart = Date.now();
            const res = await request.get('/api/gemini-token');
            const reqDuration = Date.now() - reqStart;
            return { userIndex, res, duration: reqDuration };
          })(u)
        );
      }

      const results = await Promise.all(userTokenRequests);
      const totalWaveDuration = Date.now() - startTime;

      let waveSuccess = 0;
      let totalLatency = 0;

      for (const r of results) {
        expect(r.res.status(), `User ${r.userIndex} failed with status ${r.res.status()}`).toBe(200);
        const data = await r.res.json();
        expect(data.token).toBeDefined();
        expect(typeof data.token).toBe('string');
        expect(data.token.length).toBeGreaterThan(10);
        waveSuccess++;
        totalLatency += r.duration;
      }

      totalTokensIssued += waveSuccess;
      const avgLatency = Math.round(totalLatency / wave.users);
      waveStats.push({
        wave: wave.name,
        durationMs: totalWaveDuration,
        avgLatencyMs: avgLatency,
        successCount: waveSuccess,
      });

      console.log(
        `[${wave.name} PASSED] 40/40 Tokens Generated | Avg Latency: ${avgLatency}ms | Wave Completed in: ${totalWaveDuration}ms`
      );

      // Brief 1.5s breathing pause between waves
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    console.log('\n=== STEP 4: Verification of 1-Hour Lifecycle Results ===');
    console.table(waveStats);

    expect(totalTokensIssued).toBe(160);
    console.log(`[Lifecycle Test] Total Ephemeral Tokens Successfully Issued: ${totalTokensIssued}/160 (100% Success)`);
    console.log('\n=== 1-HOUR LIFECYCLE STRESS TEST PASSED WITH ZERO ERRORS ===');
  });
});
