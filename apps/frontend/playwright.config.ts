import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    // Shared E2E account + route sweep are sensitive to parallel load locally.
    workers: 1,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            testIgnore: /mobile-responsive\.spec\.ts/,
        },
        {
            name: 'mobile-iphone',
            use: { ...devices['iPhone 13'] },
            testMatch: /mobile-responsive\.spec\.ts/,
        },
        {
            name: 'mobile-pixel',
            use: { ...devices['Pixel 5'] },
            testMatch: /mobile-responsive\.spec\.ts/,
        },
        {
            name: 'mobile-ipad',
            use: { ...devices['iPad (gen 7)'] },
            testMatch: /mobile-responsive\.spec\.ts/,
        },
    ],
    webServer: process.env.CI && !process.env.PLAYWRIGHT_BASE_URL ? {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
        },
    } : undefined,
});
