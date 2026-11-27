import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, DB_URL, PORT } from './e2e/fixtures.ts';

/**
 * End-to-end tests. They run the dev server against a throwaway SQLite file
 * built by e2e/setup-db.ts, so no real database is read or written. Other env
 * vars still come from .env.
 *
 *   pnpm test:e2e
 */
export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/global-setup.ts',
	// One database, shared by every spec: run them one at a time.
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: [['list']],
	outputDir: 'e2e/.tmp/results',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } }
		}
	],
	webServer: {
		command: `node e2e/setup-db.ts && pnpm exec vite dev --port ${PORT} --strictPort`,
		url: `${BASE_URL}/api/ping`,
		reuseExistingServer: false,
		timeout: 120_000,
		// live.spec.ts needs the live Worker running (wrangler dev -c live/wrangler.jsonc
		// --port 8788 --var LIVE_SECRET:e2e-live-secret) and LIVE_E2E=1; skipped otherwise.
		env: {
			DATABASE_URL: DB_URL,
			DATABASE_AUTH_TOKEN: '',
			LIVE_URL: process.env.LIVE_E2E ? 'ws://127.0.0.1:8788' : '',
			LIVE_SECRET: process.env.LIVE_E2E ? 'e2e-live-secret' : ''
		}
	}
});
