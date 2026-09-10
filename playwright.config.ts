import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90000,
  expect: {
    timeout: 25000,
  },
  fullyParallel: false,
  workers: 1, // Sequential testing so room state doesn't collide
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    permissions: ["microphone"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone"],
      },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
