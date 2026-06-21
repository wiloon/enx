import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_COGNITO_DOMAIN:
        process.env.NEXT_PUBLIC_COGNITO_DOMAIN ||
        'https://enx-auth.auth.us-east-1.amazoncognito.com',
      NEXT_PUBLIC_COGNITO_CLIENT_ID:
        process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ||
        '1il7v7q7jn17150jq4lou6m7b0',
      NEXT_PUBLIC_COGNITO_REDIRECT_URI:
        process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ||
        'http://localhost:3000/auth/callback',
    },
  },
});
