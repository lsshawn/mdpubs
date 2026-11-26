/**
 * Warm the dev server before any test runs. The first page load makes Vite
 * compile the route and bundle its dependencies, which can take longer than a
 * test's timeout and ends in a full page reload.
 */
import { chromium } from '@playwright/test';
import { BASE_URL } from './fixtures.ts';

export default async function globalSetup() {
	const browser = await chromium.launch();
	const page = await browser.newPage();
	for (let i = 0; i < 2; i++) {
		await page.goto(`${BASE_URL}/e2e-public`, { timeout: 120_000 });
		await page.locator('.mc-layer').waitFor({ state: 'attached', timeout: 120_000 });
		await page.waitForTimeout(1500);
	}
	await browser.close();
}
