import { test, expect } from "@playwright/test";

test.describe("VoxLive Room & Lobby E2E Verification", () => {
  // Helper to create browser context with microphone permission
  const newAudioContext = (browser: any) =>
    browser.newContext({
      permissions: ["microphone"],
    });

  // 1. Verify Room Creation and 1/2 Waiting in Lobby
  test("Test 1: Host creates room -> Lobby shows 1/2 Waiting", async ({ browser, request }) => {
    const hostContext = await newAudioContext(browser);
    const hostPage = await hostContext.newPage();
    await hostPage.goto("/");

    // Open create room modal
    await hostPage.locator('button:has-text("Create Room")').click();
    await expect(hostPage.locator("text=Create a New Room")).toBeVisible();

    const testTitle = `Lobby Test ${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await hostPage.locator('input[placeholder*="Casual English Practice"]').fill(testTitle);

    // Listen for new tab/window when clicking Create & Enter
    const [roomPage] = await Promise.all([
      hostPage.waitForEvent("popup").catch(() => null),
      hostPage.locator('button:has-text("Create & Enter")').click(),
    ]);

    const activeHostPage = roomPage || hostPage;
    await activeHostPage.waitForURL(/\/room\//);
    const url = activeHostPage.url();
    const roomIdMatch = url.match(/\/room\/([A-Za-z0-9]+)/);
    expect(roomIdMatch).not.toBeNull();
    const roomId = roomIdMatch![1].toUpperCase();

    // Check Lobby in a separate visitor browser context
    const visitorContext = await newAudioContext(browser);
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto("/");

    // The room card should appear in the lobby with testTitle and "1/2 Waiting"
    const roomCard = visitorPage.locator(`text=${testTitle}`).first();
    await expect(roomCard).toBeVisible({ timeout: 10000 });
    await expect(visitorPage.locator("text=1/2 Waiting").first()).toBeVisible();

    // Cleanup host session
    await activeHostPage.close().catch(() => {});
    await hostContext.close().catch(() => {});
    await visitorContext.close().catch(() => {});
    await request.post("/api/signal/leave", {
      data: { roomId, role: "caller" },
    }).catch(() => {});
  });

  // Cool down between tests so Chromium instances release audio handles and LiveKit WebSockets
  test.afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  // 2. Verify Two-Party Connection & 2/2 Full
  test("Test 2: Host + Guest connect -> Status Connected (Live) and Lobby becomes 2/2 Full", async ({ browser, request }) => {
    const testRoomId = `TEST${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const testTitle = `Live Chat ${testRoomId}`;

    // Register room in lobby metadata
    await request.post("/api/rooms", {
      data: {
        id: testRoomId,
        name: testTitle,
        hostLang: "hi",
        targetLang: "en",
      },
    });

    // 1. Host joins first and waits for room UI to initialize
    const hostContext = await newAudioContext(browser);
    const hostPage = await hostContext.newPage();
    await hostPage.goto(`/room/${testRoomId}?myLang=hi&targetLang=en&role=caller`);
    await expect(hostPage.locator("text=Session Status")).toBeVisible({ timeout: 20000 });

    // 2. Guest joins second
    const guestContext = await newAudioContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(`/room/${testRoomId}?myLang=en&targetLang=hi&role=callee`);
    await expect(guestPage.locator("text=Session Status")).toBeVisible({ timeout: 20000 });

    // 3. Both reach Connected (Live) state
    await expect(hostPage.locator("text=Connected (Live)")).toBeVisible({ timeout: 50000 });
    await expect(guestPage.locator("text=Connected (Live)")).toBeVisible({ timeout: 50000 });

    // 4. Verify In-Room Controls (Mute, CC, Chat, 3D Globe)
    // 4a. Mute toggle
    await hostPage.locator('button:has-text("Mute")').click();
    await expect(hostPage.locator('button:has-text("Unmute")')).toBeVisible({ timeout: 5000 });
    await hostPage.locator('button:has-text("Unmute")').click();
    await expect(hostPage.locator('button:has-text("Mute")')).toBeVisible({ timeout: 5000 });

    // 4b. Closed Captions (CC) toggle
    await hostPage.locator('button:has-text("CC ON")').click();
    await expect(hostPage.locator('button:has-text("CC OFF")')).toBeVisible({ timeout: 5000 });
    await hostPage.locator('button:has-text("CC OFF")').click();
    await expect(hostPage.locator('button:has-text("CC ON")')).toBeVisible({ timeout: 5000 });

    // 4c. In-Room Chat Drawer
    await hostPage.locator('button:has-text("Chat")').click();
    await expect(hostPage.locator("text=Room Chat & Files")).toBeVisible({ timeout: 5000 });
    await hostPage.locator('input[placeholder="Type message..."]').fill("Hello from Host!");
    await hostPage.locator('button[title="Send message"]').click();
    await expect(hostPage.locator("text=Hello from Host!")).toBeVisible({ timeout: 5000 });
    await hostPage.locator('button[title="Close chat"]').click();

    // 4d. 3D Globe Radar Modal
    await hostPage.locator('button:has-text("Globe")').click();
    await expect(hostPage.locator("text=3D Global Connection Radar")).toBeVisible({ timeout: 8000 });
    await hostPage.locator('button[title="Close Map"]').click();
    await expect(hostPage.locator("text=3D Global Connection Radar")).not.toBeVisible({ timeout: 5000 });

    // 5. Verify Lobby reflects 2/2 Full
    const lobbyContext = await newAudioContext(browser);
    const lobbyPage = await lobbyContext.newPage();
    await lobbyPage.goto("/");

    await expect(lobbyPage.locator(`text=${testTitle}`)).toBeVisible({ timeout: 15000 });
    const badge = lobbyPage.locator("text=2/2 Full").first();
    await expect(badge).toBeVisible({ timeout: 15000 });

    // Clean up
    await hostContext.close().catch(() => {});
    await guestContext.close().catch(() => {});
    await lobbyContext.close().catch(() => {});
    await request.post("/api/signal/leave", {
      data: { roomId: testRoomId, role: "caller" },
    }).catch(() => {});
  });

  // 3. Verify 3rd Person Security Block (403 ROOM_FULL)
  test("Test 3: 3rd Participant is blocked with Room Full error (403)", async ({ browser, request }) => {
    const testRoomId = `CAP${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // Register room
    await request.post("/api/rooms", {
      data: {
        id: testRoomId,
        name: `Capacity Test ${testRoomId}`,
        hostLang: "hi",
        targetLang: "en",
      },
    });

    // 1. Host & Guest enter the room so occupants = 2 in Redis
    const hostContext = await newAudioContext(browser);
    const hostPage = await hostContext.newPage();
    await hostPage.goto(`/room/${testRoomId}?myLang=hi&targetLang=en&role=caller`);
    await expect(hostPage.locator("text=Session Status")).toBeVisible({ timeout: 20000 });

    const guestContext = await newAudioContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(`/room/${testRoomId}?myLang=en&targetLang=hi&role=callee`);
    await expect(guestPage.locator("text=Session Status")).toBeVisible({ timeout: 20000 });

    // 2. 3rd Person attempts to enter the same room
    const thirdContext = await newAudioContext(browser);
    const thirdPage = await thirdContext.newPage();
    await thirdPage.goto(`/room/${testRoomId}?myLang=es&targetLang=en&role=callee`);

    // 3. 3rd user must see "Room is Full (2/2)"
    await expect(
      thirdPage.getByRole("heading", { name: "Room is Full (2/2)" })
    ).toBeVisible({ timeout: 20000 });
    await expect(
      thirdPage.locator("text=This room already has 2 participants chatting")
    ).toBeVisible({ timeout: 10000 });

    // Clean up
    await hostContext.close().catch(() => {});
    await guestContext.close().catch(() => {});
    await thirdContext.close().catch(() => {});
    await request.post("/api/signal/leave", {
      data: { roomId: testRoomId, role: "caller" },
    }).catch(() => {});
  });

  // 4. Verify Disconnect, Graceful Demotion & Room Deletion
  test("Test 4: Guest leave -> 1/2 Waiting; Host leave -> Room completely deleted", async ({ browser, request }) => {
    const testRoomId = `DEL${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const testTitle = `Delete Test ${testRoomId}`;

    // Register room
    await request.post("/api/rooms", {
      data: {
        id: testRoomId,
        name: testTitle,
        hostLang: "hi",
        targetLang: "en",
      },
    });

    // Setup room with Host & Guest
    const hostContext = await newAudioContext(browser);
    const hostPage = await hostContext.newPage();
    await hostPage.goto(`/room/${testRoomId}?myLang=hi&targetLang=en&role=caller`);
    await expect(hostPage.locator('button:has-text("Leave")')).toBeVisible({ timeout: 20000 });

    const guestContext = await newAudioContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(`/room/${testRoomId}?myLang=en&targetLang=hi&role=callee`);
    await expect(guestPage.locator('button:has-text("Leave")')).toBeVisible({ timeout: 20000 });

    // Guest leaves by clicking Leave button
    await guestPage.locator('button:has-text("Leave")').click();
    await guestPage.waitForURL((url) => url.pathname === "/", { timeout: 15000 });

    // Verify Lobby drops back to 1/2 Waiting
    const lobbyContext = await newAudioContext(browser);
    const lobbyPage = await lobbyContext.newPage();
    await lobbyPage.goto("/");

    await expect(lobbyPage.locator(`text=${testTitle}`)).toBeVisible({ timeout: 15000 });
    await expect(lobbyPage.locator("text=1/2 Waiting").first()).toBeVisible({ timeout: 15000 });

    // Host leaves
    await hostPage.locator('button:has-text("Leave")').click();
    await hostPage.waitForURL((url) => url.pathname === "/", { timeout: 15000 });

    // Verify room is deleted from lobby
    await lobbyPage.reload();
    await expect(lobbyPage.locator(`text=${testTitle}`)).not.toBeVisible({ timeout: 15000 });

    // Clean up
    await hostContext.close().catch(() => {});
    await guestContext.close().catch(() => {});
    await lobbyContext.close().catch(() => {});
  });

  // 5. Verify 20-Room Concurrency Cap (HTTP 429 ROOM_CAP_REACHED)
  test("Test 5: 20-Room concurrency cap blocks 21st room with HTTP 429", async ({ request }) => {
    const createdRoomIds: string[] = [];

    try {
      // 1. Check current active room count
      const initialRes = await request.get("/api/rooms");
      const initialData = await initialRes.json();
      const currentActiveCount = initialData.rooms?.length || 0;

      // 2. Fill up to 20 rooms if not already full
      const neededRooms = Math.max(0, 20 - currentActiveCount);
      for (let i = 0; i < neededRooms; i++) {
        const tempId = `FLOOD${i}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const res = await request.post("/api/rooms", {
          data: {
            id: tempId,
            name: `Load Test Room ${i}`,
            hostLang: "hi",
            targetLang: "en",
          },
        });
        if (res.ok()) {
          createdRoomIds.push(tempId);
        }
      }

      // 3. Attempt 21st room creation (Must be blocked with 429)
      const blockedRes = await request.post("/api/rooms", {
        data: {
          id: "BLOCKED_ROOM_21",
          name: "Attempted 21st Room",
          hostLang: "hi",
          targetLang: "en",
        },
      });

      expect(blockedRes.status()).toBe(429);
      const blockedData = await blockedRes.json();
      expect(blockedData.code).toBe("ROOM_CAP_REACHED");
      expect(blockedData.error).toContain("All 20 call channels are currently active");
    } finally {
      // 4. Cleanup all created test rooms so Redis stays clean
      for (const id of createdRoomIds) {
        await request.post("/api/signal/leave", {
          data: { roomId: id, role: "caller" },
        }).catch(() => {});
      }
    }
  });
});
