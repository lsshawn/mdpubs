/**
 * Live presence, comments and note updates across two browsers.
 *
 * Needs the live Worker running locally; skipped otherwise:
 *   npx wrangler dev -c live/wrangler.jsonc --port 8788 --var LIVE_SECRET:e2e-live-secret
 *   LIVE_E2E=1 pnpm test:e2e live
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@libsql/client';
import { DB_URL, NOTES, OWNER } from './fixtures.ts';

test.skip(!process.env.LIVE_E2E, 'Set LIVE_E2E=1 with the live Worker running.');

const ID = 'e2e-live';
const db = createClient({ url: DB_URL });

const contexts: BrowserContext[] = [];

async function openAs(browser: Browser, session?: string): Promise<Page> {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	contexts.push(context);
	if (session) {
		await context.addCookies([
			{ name: 'auth-session', value: session, domain: 'localhost', path: '/' }
		]);
	}
	const page = await context.newPage();
	await page.goto(`/${ID}`);
	await expect(page.locator('.mc-layer')).toBeAttached();
	return page;
}

// Close every tab a test opened, so it leaves the room before the next test.
test.afterEach(async () => {
	await Promise.all(contexts.splice(0).map((c) => c.close()));
});

test.beforeEach(async () => {
	await db.execute(`delete from note_comments`);
	await db.execute({
		sql: `update notes set content = ? where public_id = ?`,
		args: [NOTES[ID].content, ID]
	});
});

test('each reader sees the other, with names only where allowed', async ({ browser }) => {
	const owner = await openAs(browser, OWNER.session);
	const guest = await openAs(browser);

	// The guest sees the author by name; the author sees the guest.
	await expect(guest.locator('[data-tip^="owner is reading"]')).toBeVisible();
	await expect(owner.locator('[data-tip^="Guest is reading"]')).toBeVisible();

	// A second guest is "Someone" to the first guest, but named to the author.
	const guest2 = await openAs(browser);
	await expect(guest.locator('[data-tip^="Someone is reading"]')).toBeVisible();
	await expect(owner.locator('[data-tip^="Guest is reading"]')).toHaveCount(2);

	// Leaving takes them off everyone's list.
	await guest2.context().close();
	await expect(owner.locator('[data-tip^="Guest is reading"]')).toHaveCount(1);
});

test('a reader scrolling to a section shows up beside it in the contents', async ({ browser }) => {
	const owner = await openAs(browser, OWNER.session);
	const guest = await openAs(browser);
	await guest.getByRole('button', { name: 'Timeline' }).first().click();
	await expect(owner.locator('[data-tip="Guest is reading \\"Timeline\\""]')).toBeVisible({
		timeout: 10_000
	});
	await expect(owner.locator('[title="1 reading here"]')).toBeVisible();
});

test('a new comment appears for other readers without a reload', async ({ browser }) => {
	const owner = await openAs(browser, OWNER.session);
	const guest = await openAs(browser);
	await expect(guest.locator('[data-tip^="owner is reading"]')).toBeVisible();

	const res = await guest.request.post(`/api/notes/${ID}/comments`, {
		data: {
			body: 'Can we start a week earlier?',
			name: 'Maya Lin',
			email: 'maya@example.test',
			key: 'live-key-0123456789abcdef',
			anchor: {
				v: 1,
				kind: 'block',
				index: 1,
				tag: 'p',
				text: 'We will build the onboarding flow and the billing page in the first month. The team ships weekly and you see every build on a preview link before it goes live.'
			}
		}
	});
	expect(res.status(), await res.text()).toBe(201);
	await expect(owner.getByText('Can we start a week earlier?').first()).toBeVisible();
});

test('a saved change reaches readers, with a notice', async ({ browser }) => {
	const guest = await openAs(browser);
	const content = NOTES[ID].content.replace('ten weeks', 'eight weeks');
	expect(content).not.toBe(NOTES[ID].content);

	const res = await guest.request.put(`/api/notes/${ID}`, {
		headers: { Authorization: `Bearer ${OWNER.session}` },
		data: { content }
	});
	expect(res.status(), await res.text()).toBe(200);
	await expect(
		guest.getByRole('status').filter({ hasText: 'just updated this note' })
	).toBeVisible();
	await expect(guest.locator('article')).toContainText('eight weeks');
});

test('the editor shows as editing to readers', async ({ browser }) => {
	const guest = await openAs(browser);
	const context = await browser.newContext();
	contexts.push(context);
	await context.addCookies([
		{ name: 'auth-session', value: OWNER.session, domain: 'localhost', path: '/' }
	]);
	const editor = await context.newPage();
	await editor.goto(`/notes/${ID}/edit`);
	await expect(guest.locator('[data-tip="owner is editing"]')).toBeVisible();
	await expect(guest.locator('.live-editing')).toBeVisible();
});

test('a note without mdpubs-live opens no connection', async ({ browser }) => {
	const context = await browser.newContext();
	contexts.push(context);
	const page = await context.newPage();
	const sockets: string[] = [];
	page.on('websocket', (ws) => {
		if (ws.url().includes('/room/')) sockets.push(ws.url());
	});
	await page.goto('/e2e-public');
	await expect(page.locator('.mc-layer')).toBeAttached();
	await page.waitForTimeout(1500);
	expect(sockets).toEqual([]);
});

test('a click shows a bar and face beside that line for others', async ({ browser }) => {
	const owner = await openAs(browser, OWNER.session);
	const guest = await openAs(browser);
	await expect(owner.locator('.live-face')).toHaveCount(1);

	const para = guest.locator('article p', { hasText: 'Payment is due' });
	await para.click({ position: { x: 10, y: 5 } });
	await expect(owner.locator('.lm-bar')).toHaveCount(1);
	await expect(owner.locator('.lm-face')).toHaveAttribute('data-tip', 'Guest is here');

	// Level with the paragraph the guest clicked, in the owner's page.
	const bar = (await owner.locator('.lm-bar').boundingBox())!;
	const target = (await owner.locator('article p', { hasText: 'Payment is due' }).boundingBox())!;
	expect(Math.abs(bar.y - target.y)).toBeLessThan(4);
});

test('a selection tints the same words for others', async ({ browser }) => {
	const owner = await openAs(browser, OWNER.session);
	const guest = await openAs(browser);
	await expect(owner.locator('.live-face')).toHaveCount(1);

	// Drag across the start of a paragraph.
	const para = guest.locator('article p', { hasText: 'We will build' });
	const box = (await para.boundingBox())!;
	await guest.mouse.move(box.x + 2, box.y + 8);
	await guest.mouse.down();
	await guest.mouse.move(box.x + 160, box.y + 8, { steps: 5 });
	await guest.mouse.up();
	const selected = await guest.evaluate(() => window.getSelection()?.toString().trim());
	expect(selected?.length).toBeGreaterThan(5);

	await expect(owner.locator('.lm-tint').first()).toBeVisible();
	await expect(owner.locator('.lm-face')).toHaveAttribute('data-tip', 'Guest selected this');
	const tint = (await owner.locator('.lm-tint').first().boundingBox())!;
	const target = (await owner.locator('article p', { hasText: 'We will build' }).boundingBox())!;
	expect(Math.abs(tint.y - target.y)).toBeLessThan(6);
});
