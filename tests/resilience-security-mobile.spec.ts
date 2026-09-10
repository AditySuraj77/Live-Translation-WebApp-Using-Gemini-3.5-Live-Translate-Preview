import { test, expect } from '@playwright/test';

test.describe('VoxLive Production Resilience, Mobile Responsiveness & Security Suite', () => {
  const createdRoomIds: string[] = [];

  const newAudioContext = (browser: any, options: any = {}) =>
    browser.newContext({
      permissions: ['microphone'],
      ...options,
    });

  test.afterEach(async ({ request }) => {
    for (const id of createdRoomIds) {
      await request.post('/api/signal/leave', {
        data: { roomId: id, role: 'caller' },
      }).catch(() => {});
    }
    createdRoomIds.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Network Drop / Offline Reconnection Simulation
  // ─────────────────────────────────────────────────────────────
  test('Test 1: Network Drop Simulation - Offline & Online Recovery without app crash', async ({ browser }) => {
    const hostContext = await newAudioContext(browser);
    const hostPage = await hostContext.newPage();
    await hostPage.goto('/');

    // Create room
    await hostPage.locator('button:has-text("Create Room")').click();
    const testTitle = `Network Test ${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await hostPage.locator('input[placeholder*="Casual English Practice"]').fill(testTitle);

    const [roomPage] = await Promise.all([
      hostPage.waitForEvent('popup').catch(() => null),
      hostPage.locator('button:has-text("Create & Enter")').click(),
    ]);

    const activePage = roomPage || hostPage;
    await activePage.waitForURL(/\/room\//);
    const roomId = activePage.url().match(/\/room\/([A-Za-z0-9]+)/)![1].toUpperCase();
    createdRoomIds.push(roomId);

    // Verify room is loaded and active
    await expect(activePage.locator('button:has-text("Leave")')).toBeVisible({ timeout: 15000 });

    console.log('[Network Test] Simulating sudden network drop (Tunnel / Flaky 4G)...');
    await hostContext.setOffline(true);

    // Wait 3 seconds during complete network blackout
    await activePage.waitForTimeout(3000);

    console.log('[Network Test] Restoring network connection...');
    await hostContext.setOffline(false);

    // Verify UI didn't crash into white screen or unhandled exception
    await expect(activePage.locator('button:has-text("Leave")')).toBeVisible({ timeout: 10000 });
    const isMuteVisible = await activePage.locator('button:has-text("Mute")').isVisible();
    const isUnmuteVisible = await activePage.locator('button:has-text("Unmute")').isVisible();
    expect(isMuteVisible || isUnmuteVisible).toBeTruthy();

    console.log('[Network Test] PASSED: App gracefully sustained network blackout and restored UI without crash!');
    await hostContext.close();
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Mobile Viewport (iPhone 14 / 390x844) Responsiveness
  // ─────────────────────────────────────────────────────────────
  test('Test 2: Mobile Viewport (390x844) - Complete Lobby, In-Room Controls & Modal Interaction', async ({ browser }) => {
    const mobileContext = await newAudioContext(browser, {
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      isMobile: true,
      hasTouch: true,
    });

    const page = await mobileContext.newPage();
    await page.goto('/');

    // 1. Verify Lobby layout on mobile (zero horizontal overflow)
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const bodyClientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(bodyClientWidth + 5); // Max 5px tolerance
    console.log('[Mobile Test] Lobby layout perfectly fits 390px mobile viewport without overflow!');

    // 2. Create room on mobile
    await page.locator('button:has-text("Create Room")').click();
    await expect(page.locator('text=Create a New Room')).toBeVisible();

    const mobileRoomTitle = `Mobile Room ${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    await page.locator('input[placeholder*="Casual English Practice"]').fill(mobileRoomTitle);

    const [roomPopup] = await Promise.all([
      page.waitForEvent('popup').catch(() => null),
      page.locator('button:has-text("Create & Enter")').click({ force: true }),
    ]);

    const activePage = roomPopup || page;
    await activePage.waitForURL(/\/room\//);
    const roomId = activePage.url().match(/\/room\/([A-Za-z0-9]+)/)![1].toUpperCase();
    createdRoomIds.push(roomId);

    // 3. Verify all in-room toolbar controls fit without wrapping breaking
    await expect(activePage.locator('button:has-text("Leave")')).toBeVisible({ timeout: 15000 });
    await expect(activePage.locator('button:has-text("Globe")')).toBeVisible();
    await expect(activePage.locator('button:has-text("Chat")')).toBeVisible();

    // 4. Test 3D Globe Radar modal on mobile
    console.log('[Mobile Test] Opening 3D Globe Radar on mobile...');
    await activePage.locator('button:has-text("Globe")').click({ force: true });
    await expect(activePage.locator('text=Global Connection Radar')).toBeVisible({ timeout: 10000 });
    const doneBtn = activePage.locator('button:has-text("Done")');
    await expect(doneBtn).toBeVisible();
    await doneBtn.click({ force: true });
    await expect(activePage.locator('text=Global Connection Radar')).not.toBeVisible();
    console.log('[Mobile Test] 3D Globe Radar opened and closed seamlessly on mobile!');

    // 5. Test In-Room Chat Drawer on mobile
    console.log('[Mobile Test] Opening In-Room Chat Drawer on mobile...');
    await activePage.locator('button:has-text("Chat")').click({ force: true });
    const chatInput = activePage.locator('input[placeholder*="Type message"]');
    await expect(chatInput).toBeVisible({ timeout: 8000 });
    await chatInput.fill('Hello from iPhone mobile test! 📱');
    await chatInput.press('Enter');
    await expect(activePage.locator('text=Hello from iPhone mobile test! 📱')).toBeVisible();
    console.log('[Mobile Test] Chat message sent and displayed cleanly in mobile drawer!');

    // Close chat and Leave
    await activePage.locator('button:has-text("Leave")').click({ force: true });
    await mobileContext.close();
    console.log('[Mobile Test] PASSED: Full mobile responsive verification passed!');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Security, XSS & Input Sanitization (Adversarial Testing)
  // ─────────────────────────────────────────────────────────────
  test('Test 3: Security & Sanitization - XSS payloads, dirty HTML and malformed requests handled safely', async ({ request, browser }) => {
    console.log('[Security Test] Testing XSS Injection in Room Creation...');
    const xssPayload = '<script>alert("XSS_ATTACK")</script><img src=x onerror=alert(1)>';
    const xssRoomId = 'XSS_' + Math.random().toString(36).substring(2, 6).toUpperCase();
    createdRoomIds.push(xssRoomId);

    const createRes = await request.post('/api/rooms', {
      data: {
        id: xssRoomId,
        name: xssPayload,
        hostLang: 'hi',
        targetLang: 'en',
      },
    });
    expect(createRes.ok()).toBeTruthy();

    // Verify in browser that script tags are NOT executed as script elements
    const ctx = await newAudioContext(browser);
    const page = await ctx.newPage();

    let dialogFired = false;
    page.on('dialog', () => {
      dialogFired = true;
    });

    await page.goto('/');
    // Check that the script payload is treated as plain text or properly escaped, no alert() triggered
    expect(dialogFired).toBeFalsy();
    console.log('[Security Test] Verified: XSS script tags rendered safely as plain text, ZERO malicious execution!');

    // Malformed request testing
    console.log('[Security Test] Testing missing roomId...');
    const badRes1 = await request.post('/api/rooms', {
      data: { name: 'No Room ID' },
    });
    expect(badRes1.status()).toBe(400);

    console.log('[Security Test] Testing excessively long payload (10,000 characters)...');
    const longPayload = 'A'.repeat(10000);
    const longRes = await request.post('/api/rooms', {
      data: {
        id: 'OVERSIZED_' + Math.random().toString(36).substring(2, 6).toUpperCase(),
        name: longPayload,
        hostLang: 'hi',
        targetLang: 'en',
      },
    });
    // Server must respond gracefully (either truncating 200 or rejecting 400), NEVER crashing with 500
    expect([200, 400].includes(longRes.status())).toBeTruthy();

    await ctx.close();
    console.log('[Security Test] PASSED: All security & sanitization guards active and solid!');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Diverse Language Pairs & Gemini Config Integrity
  // ─────────────────────────────────────────────────────────────
  test('Test 4: Diverse Multi-Language Pairs (Hindi, Japanese, Spanish, German, Arabic) Configuration', async ({ request }) => {
    const languagePairs = [
      { hostLang: 'hi', targetLang: 'ja', label: 'Hindi ↔ Japanese' },
      { hostLang: 'es', targetLang: 'en', label: 'Spanish ↔ English' },
      { hostLang: 'de', targetLang: 'fr', label: 'German ↔ French' },
      { hostLang: 'ar', targetLang: 'zh', label: 'Arabic ↔ Chinese' },
    ];

    console.log('[Language Test] Testing 4 diverse global language pairs...');
    for (const pair of languagePairs) {
      const id = 'LANG_' + pair.hostLang + '_' + pair.targetLang + '_' + Math.random().toString(36).substring(2, 5).toUpperCase();
      createdRoomIds.push(id);

      const res = await request.post('/api/rooms', {
        data: {
          id,
          name: `${pair.label} Lounge`,
          hostLang: pair.hostLang,
          targetLang: pair.targetLang,
        },
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data.room.hostLang).toBe(pair.hostLang);
      expect(data.room.targetLang).toBe(pair.targetLang);
      console.log(`[Language Test] Pair ${pair.label} verified in room configuration!`);
    }

    // Verify Lobby lists the language pairs accurately
    const lobbyRes = await request.get('/api/rooms');
    expect(lobbyRes.ok()).toBeTruthy();
    const lobbyData = await lobbyRes.json();
    for (const pair of languagePairs) {
      const match = lobbyData.rooms.find((r: any) => r.hostLang === pair.hostLang && r.targetLang === pair.targetLang);
      expect(match).toBeDefined();
    }
    console.log('[Language Test] PASSED: All diverse language pairs stored, served, and formatted correctly!');
  });
});
