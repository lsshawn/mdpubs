/**
 * Margin comments, end to end: a real browser against the dev server and the
 * throwaway database from setup-db.ts.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createClient } from '@libsql/client';
import { DB_URL, MEMBER, NOTES, OWNER } from './fixtures.ts';

const db = createClient({ url: DB_URL });

type Row = Record<string, unknown>;

/** Short handle → the block's whole text, which is what an anchor stores. */
const BLOCKS: Record<string, { tag: string; text: string }> = {
	'We will build': {
		tag: 'p',
		text: 'We will build the onboarding flow and the billing page in the first month. The team ships weekly and you see every build on a preview link before it goes live.'
	},
	'Payment is due': {
		tag: 'p',
		text: 'Payment is due within fourteen days of each invoice being issued. Late invoices pause the work until they are settled.'
	},
	'Work starts on': {
		tag: 'p',
		text: 'Work starts on the first Monday after the deposit clears. We expect the whole project to take about ten weeks from start to handover.'
	},
	Design: { tag: 'tr', text: 'Design 40 $4,000' },
	Build: { tag: 'tr', text: 'Build 120 $12,000' },
	Handover: { tag: 'tr', text: 'Handover 10 $1,000' }
};

async function comments(publicId: string): Promise<Row[]> {
	const res = await db.execute({
		sql: `select c.* from note_comments c join notes n on n.id = c.note_id
		      where n.public_id = ? and c.deleted_at is null order by c.created_at, c.rowid`,
		args: [publicId]
	});
	return res.rows.map((r) => ({ ...r, anchor: r.anchor ? JSON.parse(r.anchor as string) : null }));
}

async function setContent(publicId: string, content: string) {
	await db.execute({
		sql: `update notes set content = ? where public_id = ?`,
		args: [content, publicId]
	});
}

async function clearComments() {
	await db.execute(`delete from note_comments`);
	await db.execute(`delete from note_versions`);
	await db.execute(`delete from note_comment_edits`);
}

/** Give a note a saved history: one version per content, oldest first. The last becomes the live text. */
async function setHistory(publicId: string, contents: string[]) {
	const start = Math.floor(Date.now() / 1000) - contents.length * 86400;
	for (let i = 0; i < contents.length; i++) {
		await db.execute({
			sql: `insert into note_versions (note_id, version, title, content, file_extension, created_at, user_id)
			      select id, ?, 'Proposal', ?, 'md', ?, user_id from notes where public_id = ?`,
			args: [i + 1, contents[i], start + i * 86400, publicId]
		});
	}
	await setContent(publicId, contents[contents.length - 1]);
}

/** Post a comment on one of BLOCKS straight through the API, as a guest. Returns its id. */
async function seedComment(
	request: APIRequestContext,
	publicId: string,
	block: keyof typeof BLOCKS,
	body: string,
	extra: Row = {}
): Promise<string> {
	const res = await request.post(`/api/notes/${publicId}/comments`, {
		data: {
			body,
			name: 'Maya Lin',
			email: 'maya@example.test',
			key: 'seed-key-0123456789abcdef',
			anchor: { v: 1, kind: 'block', index: 1, ...BLOCKS[block] },
			...extra
		}
	});
	expect(res.status(), await res.text()).toBe(201);
	return (await res.json()).id;
}

async function open(page: Page, publicId: string) {
	await page.goto(`/${publicId}`);
	await expect(page.locator('.mc-toggle-btn')).toBeVisible();
	// The layer only exists once the article has been measured in the browser.
	await expect(page.locator('.mc-layer')).toBeAttached();
}

async function loginAs(page: Page, user: { session: string }) {
	await page
		.context()
		.addCookies([{ name: 'auth-session', value: user.session, domain: 'localhost', path: '/' }]);
}

/** Click the empty space at the right end of a block, not its text. */
async function clickBeside(page: Page, block: Locator) {
	await block.scrollIntoViewIfNeeded();
	const box = (await block.boundingBox())!;
	const article = (await page.locator('article').boundingBox())!;
	await page.mouse.click(article.x + article.width - 3, box.y + box.height / 2);
}

function composer(page: Page) {
	return page.locator('.mc-column .mc-composer');
}

async function write(page: Page, text: string, name?: string, email?: string) {
	const c = composer(page);
	await expect(c).toBeVisible();
	if (name !== undefined) await c.getByPlaceholder('Your name').fill(name);
	if (email !== undefined) await c.locator('input[type="email"]').fill(email);
	await c.locator('textarea').fill(text);
	await c.getByRole('button', { name: 'Comment' }).click();
	await expect(note(page, text)).toBeVisible();
}

function note(page: Page, text: string) {
	return page.locator('.mc-note', { hasText: text });
}

/** Select `text` inside `block` the way a drag would, and wait for the Comment button. */
async function selectText(page: Page, block: Locator, text: string) {
	await block.scrollIntoViewIfNeeded();
	await block.evaluate((el, wanted) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
			const at = n.data.indexOf(wanted);
			if (at === -1) continue;
			const range = document.createRange();
			range.setStart(n, at);
			range.setEnd(n, at + wanted.length);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
			return;
		}
		throw new Error(`text not found: ${wanted}`);
	}, text);
}

const para = (page: Page, text: string) => page.locator('article p', { hasText: text });

// The dev server writes to the same SQLite file: wait for its lock, don't fail on it.
test.beforeAll(async () => {
	await db.execute('PRAGMA busy_timeout = 5000');
});

test.beforeEach(async () => {
	await clearComments();
	for (const [id, n] of Object.entries(NOTES)) await setContent(id, n.content);
});

test.describe('guests', () => {
	test('click a line, give a name once, and the comment stays after reload', async ({ page }) => {
		await open(page, 'e2e-public');
		await expect(page.locator('.mc-mark')).toHaveCount(0);

		await clickBeside(page, para(page, 'Payment is due'));
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		// No name yet: the button stays off.
		await composer(page).locator('textarea').fill('can we make this 30 days?');
		await expect(composer(page).getByRole('button', { name: 'Comment' })).toBeDisabled();
		await write(page, 'can we make this 30 days?', 'Maya Lin', 'maya@example.test');
		await expect(note(page, 'can we make this 30 days?')).toContainText('Maya Lin');
		await expect(composer(page)).toHaveCount(0);

		// Second comment: not asked again, and the name can be changed (shared computer).
		await clickBeside(page, para(page, 'Work starts on'));
		await expect(composer(page).getByPlaceholder('Your name')).toHaveCount(0);
		await expect(composer(page).locator('.mc-who')).toContainText('as Maya Lin');
		// The name itself is the way to change it.
		await composer(page).getByRole('button', { name: 'as Maya Lin' }).click();
		await write(page, 'when is the deposit due?', 'Sam Ortiz', '');
		await expect(note(page, 'when is the deposit due?')).toContainText('Sam Ortiz');

		await page.reload();
		await expect(note(page, 'can we make this 30 days?')).toBeVisible();
		await expect(note(page, 'when is the deposit due?')).toBeVisible();
		await expect(page.locator('.mc-mark')).toHaveCount(2);
		await expect(page.locator('.mc-toggle-btn')).toContainText('2');

		const rows = await comments('e2e-public');
		expect(rows.map((r) => [r.author_name, r.author_email, r.user_id])).toEqual([
			['Maya Lin', 'maya@example.test', null],
			['Sam Ortiz', null, null]
		]);
		expect((rows[0].anchor as Row).text).toContain('Payment is due within fourteen days');
	});

	test('select text to comment on just those words', async ({ page }) => {
		await open(page, 'e2e-public');
		await selectText(page, para(page, 'We will build'), 'onboarding flow and the billing page');
		// No button to press: the box and the bracket are there as soon as text is selected,
		// and the selection is still the reader's to copy.
		await expect(composer(page)).toBeVisible();
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		await expect(page.locator('.mc-highlight').first()).toBeVisible();
		expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
			'onboarding flow and the billing page'
		);
		expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
		await write(page, 'love this part', 'Maya Lin');

		const [row] = await comments('e2e-public');
		const anchor = row.anchor as Row;
		expect(anchor.kind).toBe('text');
		expect(anchor.quote).toBe('onboarding flow and the billing page');
		expect(anchor.prefix).toContain('We will build the');

		await page.reload();
		await expect(note(page, 'love this part')).toBeVisible();
		const highlight = (await page.locator('.mc-highlight').first().boundingBox())!;
		const p = (await para(page, 'We will build').boundingBox())!;
		expect(highlight.y).toBeGreaterThanOrEqual(p.y - 2);
		expect(highlight.y + highlight.height).toBeLessThanOrEqual(p.y + p.height + 2);
		expect(highlight.width).toBeGreaterThan(150);

		// The bracket stands beside the selected words' line, not the whole paragraph.
		const mark = (await page.locator('.mc-mark').boundingBox())!;
		expect(p.height).toBeGreaterThan(40);
		expect(mark.height).toBeLessThan(p.height - 12);
		expect(mark.y).toBeGreaterThanOrEqual(highlight.y - 10);
		expect(mark.y + mark.height).toBeLessThanOrEqual(highlight.y + highlight.height + 10);
	});

	test('a selection across two paragraphs brackets both', async ({ page }) => {
		await open(page, 'e2e-public');
		await page.evaluate(() => {
			const ps = Array.from(document.querySelectorAll('article p'));
			const a = ps.find((p) => p.textContent!.includes('We will build'))!;
			const b = ps.find((p) => p.textContent!.includes('Payment is due'))!;
			const range = document.createRange();
			range.setStart(a.firstChild!, a.textContent!.indexOf('before it goes live'));
			range.setEnd(b.firstChild!, 'Payment is due'.length);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
		});
		await write(page, 'these two belong together', 'Maya Lin');
		const mark = (await page.locator('.mc-mark').boundingBox())!;
		const a = (await para(page, 'We will build').boundingBox())!;
		const b = (await para(page, 'Payment is due').boundingBox())!;
		expect(mark.y).toBeLessThan(a.y + a.height);
		// From the last line of the first paragraph into the first line of the second.
		expect(mark.y).toBeGreaterThan(a.y);
		expect(mark.y + mark.height).toBeGreaterThan(b.y + 8);
	});

	test('links and the comment box itself do not start a comment', async ({ page }) => {
		await open(page, 'e2e-public');
		await page.route('https://example.test/**', (r) => r.abort());
		await page
			.locator('article a', { hasText: 'full terms' })
			.click({ noWaitAfter: true })
			.catch(() => {});
		await page.goto('/e2e-public');
		await expect(page.locator('.mc-layer')).toBeAttached();
		await expect(composer(page)).toHaveCount(0);

		// Clicking the same line again closes the empty composer.
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page)).toBeVisible();
		await composer(page).locator('textarea').click();
		await expect(composer(page)).toBeVisible();
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page)).toHaveCount(0);

		// Escape closes it too.
		await clickBeside(page, para(page, 'Payment is due'));
		await composer(page).locator('textarea').press('Escape');
		await expect(composer(page)).toHaveCount(0);
		await expect(page.locator('.mc-mark')).toHaveCount(0);
	});

	test('a half-written comment moves with the click instead of being lost', async ({ page }) => {
		await open(page, 'e2e-public');
		await clickBeside(page, para(page, 'Payment is due'));
		await composer(page).locator('textarea').fill('half written');
		await clickBeside(page, para(page, 'Work starts on'));
		await expect(composer(page).locator('textarea')).toHaveValue('half written');
	});

	test('reply to a thread and delete only your own comments', async ({ page, request }) => {
		await seedComment(request, 'e2e-public', 'Payment is due', 'someone else wrote this');
		await open(page, 'e2e-public');

		const theirs = note(page, 'someone else wrote this');
		await theirs.hover();
		await expect(theirs.getByRole('button', { name: /delete/ })).toHaveCount(0);
		await expect(theirs.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
		await theirs.getByRole('button', { name: 'Reply' }).click();
		const reply = theirs.locator('.mc-composer');
		await reply.getByPlaceholder('Your name').fill('Sam Ortiz');
		await reply.locator('textarea').fill('agreed');
		await reply.getByRole('button', { name: 'Comment' }).click();
		await expect(theirs).toContainText('agreed');

		const rows = await comments('e2e-public');
		expect(rows[1].parent_id).toBe(rows[0].id);
		expect(rows[1].anchor).toBeNull();

		// Still mine after a reload (matched by the key in this browser), so I can delete it.
		await page.reload();
		const again = note(page, 'someone else wrote this');
		await expect(again).toContainText('agreed');
		await again.hover();
		page.once('dialog', (d) => d.accept());
		await again.getByRole('button', { name: /delete/ }).click();
		await expect(again).not.toContainText('agreed');
		expect(await comments('e2e-public')).toHaveLength(1);
	});

	test('the toggle hides everything and is remembered', async ({ page, request }) => {
		await seedComment(request, 'e2e-public', 'Payment is due', 'visible until hidden');
		await open(page, 'e2e-public');
		await expect(note(page, 'visible until hidden')).toBeVisible();
		const wideArticle = (await page.locator('article').boundingBox())!;

		await page.locator('.mc-toggle-btn').click();
		await expect(page.locator('.mc-layer')).toHaveCount(0);
		await expect(page.locator('.mc-note')).toHaveCount(0);
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(page.locator('.mc-composer')).toHaveCount(0);
		// Nothing on the page moves: the text keeps its place and width.
		expect(await page.locator('article').boundingBox()).toEqual(wideArticle);

		await page.reload();
		await expect(page.locator('.mc-toggle-btn')).toBeVisible();
		await expect(page.locator('.mc-toggle-btn')).toHaveAttribute('aria-pressed', 'false');
		await expect(page.locator('.mc-note')).toHaveCount(0);

		await page.locator('.mc-toggle-btn').click();
		await expect(note(page, 'visible until hidden')).toBeVisible();
	});

	test('notes beside neighbouring lines never overlap', async ({ page, request }) => {
		const long = 'a long comment that wraps over several lines in the margin '.repeat(3);
		for (const row of ['Design', 'Build', 'Handover']) {
			await seedComment(request, 'e2e-public', row, `${long}${row}`);
		}
		await open(page, 'e2e-public');
		await expect(page.locator('.mc-mark')).toHaveCount(3);
		await expect(page.locator('.mc-note')).toHaveCount(3);
		await expect
			.poll(async () => {
				const boxes = await page.locator('.mc-note').evaluateAll((els) =>
					els
						.map((e) => e.getBoundingClientRect())
						.map((r) => [r.top, r.bottom])
						.sort((a, b) => a[0] - b[0])
				);
				return boxes.every((b, i) => i === 0 || b[0] >= boxes[i - 1][1]);
			})
			.toBe(true);
	});

	test('every note starts level with its bracket, however long the one above it is', async ({
		page,
		request
	}) => {
		const long = 'a long comment that wraps over several lines in the margin '.repeat(3);
		const root = await seedComment(request, 'e2e-public', 'We will build', `${long}one`);
		await seedComment(request, 'e2e-public', 'We will build', `${long}reply`, { parentId: root });
		await seedComment(request, 'e2e-public', 'Payment is due', 'short, on the next paragraph');
		await open(page, 'e2e-public');
		await expect(page.locator('.mc-note')).toHaveCount(2);
		await expect(async () => {
			const top = (await para(page, 'Payment is due').boundingBox())!.y;
			const second = (await note(page, 'short, on the next paragraph').boundingBox())!;
			expect(Math.abs(second.y - top)).toBeLessThan(14);
			const first = (await note(page, `${long}one`).boundingBox())!;
			expect(Math.abs(first.y - (await para(page, 'We will build').boundingBox())!.y)).toBeLessThan(
				14
			);
			// The long one is cut short to make room, not laid over its neighbour.
			expect(first.y + first.height).toBeLessThanOrEqual(second.y);
		}).toPass({ timeout: 5000 });

		// Under the pointer it shows whole, and nothing else moves.
		const cut = (await note(page, `${long}one`).boundingBox())!.height;
		const before = (await note(page, 'short, on the next paragraph').boundingBox())!.y;
		await note(page, `${long}one`).hover();
		await expect
			.poll(async () => (await note(page, `${long}one`).boundingBox())!.height)
			.toBeGreaterThan(cut + 20);
		expect((await note(page, 'short, on the next paragraph').boundingBox())!.y).toBe(before);
	});

	test('a click off the text puts the comment box and its bracket away, keeping what was typed', async ({
		page
	}) => {
		await open(page, 'e2e-public');
		await clickBeside(page, para(page, 'Payment is due'));
		await composer(page).locator('textarea').fill('half a thought');
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		// Inside the box itself: nothing closes.
		await composer(page).locator('textarea').click();
		await expect(composer(page)).toBeVisible();

		// The table of contents is outside the text and its margin.
		await page.mouse.click(8, 500);
		await expect(composer(page)).toHaveCount(0);
		await expect(page.locator('.mc-mark')).toHaveCount(0);

		// Back on a line, the words are still there.
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page).locator('textarea')).toHaveValue('half a thought');

		// The page's own title area, well away from any line, closes it too.
		const title = (await page.locator('h1').first().boundingBox())!;
		await page.mouse.click(title.x + title.width / 2, title.y + 4);
		await expect(composer(page)).toHaveCount(0);
	});

	test('a click in the empty margin above or below the comment box puts it away', async ({
		page
	}) => {
		await open(page, 'e2e-public');
		await clickBeside(page, para(page, 'Payment is due'));
		const box = (await composer(page).boundingBox())!;
		// Below the box, in the margin, level with other lines of the page.
		await page.mouse.click(box.x + box.width / 2, box.y + box.height + 120);
		await expect(composer(page)).toHaveCount(0);
		await expect(page.locator('.mc-mark')).toHaveCount(0);
		// With nothing open, the margin beside a line still starts a comment.
		const p = (await para(page, 'We will build').boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, p.y + p.height / 2);
		await expect(composer(page)).toBeVisible();
		// And above the box.
		const again = (await composer(page).boundingBox())!;
		await page.mouse.click(again.x + again.width / 2, again.y - 40);
		await expect(composer(page)).toHaveCount(0);
	});

	test('a click on highlighted words puts away a half-started comment and opens their thread', async ({
		page
	}) => {
		await open(page, 'e2e-public');
		await selectText(page, para(page, 'We will build'), 'onboarding flow');
		await write(page, 'on these words', 'Maya Lin');
		await page.evaluate(() => window.getSelection()!.removeAllRanges());
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page)).toBeVisible();
		// No ghost bracket follows the pointer: only real brackets are drawn.
		await page.mouse.move(600, 300);
		await expect(page.locator('.mc-hover')).toHaveCount(0);

		const h = (await page.locator('.mc-hl:not(.mc-plain) .mc-highlight').first().boundingBox())!;
		await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2);
		await expect(composer(page)).toHaveCount(0);
		await expect(page.locator('.mc-drawer')).toContainText('on these words');
	});
});

test.describe('long comments, long threads and colours', () => {
	const essay = 'This clause needs a second look because the wording is loose. '.repeat(20).trim();

	async function seedThread(request: APIRequestContext, replies: number) {
		const root = await seedComment(
			request,
			'e2e-public',
			'Payment is due',
			'first comment in a long thread'
		);
		for (let i = 1; i <= replies; i++) {
			await seedComment(request, 'e2e-public', 'Payment is due', `reply number ${i}`, {
				parentId: root,
				name: i % 2 ? 'Sam Ortiz' : 'Maya Lin',
				key: i % 2 ? 'sam-key-0123456789abcdef' : 'seed-key-0123456789abcdef'
			});
		}
		return root;
	}

	test('a long thread is cut short in the margin and opens whole in a side drawer', async ({
		page,
		request
	}) => {
		await seedThread(request, 9);
		await open(page, 'e2e-public');
		const n = note(page, 'first comment in a long thread');
		await expect(n.locator('.mc-entry')).toHaveCount(2); // the first comment and the last reply
		await expect(n).toContainText('8 earlier replies');
		await expect(n).toContainText('reply number 9');
		await expect(n).not.toContainText('reply number 8');

		await n.getByRole('button', { name: 'Open thread (10)' }).click();
		const drawer = page.locator('.mc-drawer');
		await expect(drawer.locator('.mc-entry')).toHaveCount(10);
		// The pane does not repeat the paragraph. The page is tinted and the paragraph left bright.
		await expect(drawer).not.toContainText('Payment is due within fourteen');
		// (Measured once the page has finished scrolling the paragraph into view.)
		await expect
			.poll(() =>
				page.evaluate(() => {
					const spot = document.querySelector('.mc-spot')!.getBoundingClientRect();
					const lit = Array.from(document.querySelectorAll('article p'))
						.find((p) => p.textContent!.includes('Payment is due'))!
						.getBoundingClientRect();
					return spot.top <= lit.top && spot.bottom >= lit.bottom && spot.height < lit.height + 40;
				})
			)
			.toBe(true);
		expect(
			await page.locator('.mc-spot').evaluate((el) => getComputedStyle(el).boxShadow)
		).not.toBe('none');
		// Laid out as a conversation: a coloured initial beside each comment, and plain text to read.
		await expect(drawer.locator('.mc-avatar')).toHaveCount(10);
		await expect(drawer.locator('.mc-avatar').first()).toHaveText('M');
		expect(
			await drawer
				.locator('.mc-hand')
				.first()
				.evaluate((el) => getComputedStyle(el).fontFamily)
		).not.toContain('Caveat');

		// Oldest first, and it opens at the end, where the conversation is.
		await expect(drawer.locator('.mc-hand')).toHaveText([
			'first comment in a long thread',
			...Array.from({ length: 9 }, (_, i) => `reply number ${i + 1}`)
		]);
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 1440, height: 500 });
		await n.getByRole('button', { name: 'Open thread (10)' }).click();
		const body = drawer.locator('.mc-drawer-body');
		expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
		await expect(drawer.getByText('reply number 9')).toBeInViewport();
		await expect(drawer.getByText('first comment in a long thread')).not.toBeInViewport();

		// Reply from the drawer.
		await drawer.getByPlaceholder('Your name').fill('Sam Ortiz');
		await drawer.locator('textarea').fill('reply from the drawer');
		await drawer.getByRole('button', { name: 'Comment' }).click();
		await expect(drawer.locator('.mc-entry')).toHaveCount(11);
		await expect(drawer.getByText('reply from the drawer')).toBeInViewport();
		await expect(n).toContainText('reply from the drawer');

		await page.keyboard.press('Escape');
		await expect(drawer).toHaveCount(0);
		await n.getByText('9 earlier replies').click();
		await expect(drawer).toBeVisible();
		await page.locator('.mc-drawer-backdrop').click({ position: { x: 20, y: 20 } });
		await expect(drawer).toHaveCount(0);
	});

	test('edit and delete show for the comment under the pointer only', async ({ page, request }) => {
		await seedThread(request, 2);
		await loginAs(page, OWNER);
		await open(page, 'e2e-public');
		const entries = note(page, 'first comment in a long thread').locator('.mc-entry');
		await expect(entries).toHaveCount(2);
		const shown = () =>
			entries.evaluateAll((els) =>
				els.map((el) => getComputedStyle(el.querySelector('.mc-act')!).opacity === '1')
			);
		await page.mouse.move(300, 500);
		await expect.poll(shown).toEqual([false, false]);
		await entries.nth(0).hover();
		await expect.poll(shown).toEqual([true, false]);
		await entries.nth(1).hover();
		await expect.poll(shown).toEqual([false, true]);
	});

	test('an unsent comment or reply comes back after closing, clicking away or reloading', async ({
		page,
		request
	}) => {
		await seedComment(request, 'e2e-public', 'Work starts on', 'reply to me');
		await open(page, 'e2e-public');

		// A new comment, abandoned with Escape.
		await clickBeside(page, para(page, 'Payment is due'));
		await composer(page).locator('textarea').fill('half a thought about payment');
		await page.keyboard.press('Escape');
		await expect(composer(page)).toHaveCount(0);
		await clickBeside(page, para(page, 'We will build'));
		await expect(composer(page).locator('textarea')).toHaveValue('half a thought about payment');
		await composer(page).getByRole('button', { name: 'Cancel' }).click();

		// A reply, closed by its own toggle.
		const n = note(page, 'reply to me');
		await n.hover();
		await n.getByRole('button', { name: 'Reply' }).click();
		await n.locator('textarea').fill('a reply I did not send');
		await n.getByRole('button', { name: 'Reply' }).click();
		await expect(n.locator('textarea')).toHaveCount(0);

		// Both survive a reload, each in its own place.
		await page.reload();
		const again = note(page, 'reply to me');
		await again.hover();
		await again.getByRole('button', { name: 'Reply' }).click();
		await expect(again.locator('textarea')).toHaveValue('a reply I did not send');
		await again.getByPlaceholder('Your name').fill('Sam Ortiz');
		await again.getByRole('button', { name: 'Comment' }).click();
		await expect(again).toContainText('a reply I did not send');

		// Once posted the draft is gone; the other one is still waiting.
		await again.hover();
		await again.getByRole('button', { name: 'Reply' }).click();
		await expect(again.locator('textarea')).toHaveValue('');
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page).locator('textarea')).toHaveValue('half a thought about payment');
	});

	test('the settings menu lists who commented, each beside their colour', async ({
		page,
		request
	}) => {
		await seedThread(request, 3);
		await open(page, 'e2e-public');
		await page.locator('.mc-toggle-btn').hover();
		const rows = page.locator('.mc-legend li');
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toContainText('Maya Lin');
		await expect(rows.nth(0)).toContainText('2');
		await expect(rows.nth(1)).toContainText('Sam Ortiz');
		const bullets = await page
			.locator('.mc-bullet')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
		expect(bullets[0]).not.toBe(bullets[1]);
		// The bullet is the same colour as the person's name on their comments.
		const name = await page
			.locator('.mc-note .mc-author', { hasText: 'Maya Lin' })
			.first()
			.evaluate((el) => getComputedStyle(el).color);
		expect(bullets[0]).toBe(name);
	});

	test('Read more opens the thread on that comment, in full', async ({ page, request }) => {
		const root = await seedComment(request, 'e2e-public', 'Payment is due', 'short opener');
		for (let i = 1; i <= 6; i++) {
			await seedComment(request, 'e2e-public', 'Payment is due', i === 2 ? essay : `filler ${i}`, {
				parentId: root
			});
		}
		const lastWords = essay.replace('This', 'Last, this');
		await seedComment(request, 'e2e-public', 'Payment is due', lastWords, { parentId: root });
		await seedComment(request, 'e2e-public', 'Work starts on', 'a short one');
		await open(page, 'e2e-public');
		await page.setViewportSize({ width: 1440, height: 600 });
		const n = note(page, 'short opener');
		// In the margin the long last reply is cut to a few lines.
		expect((await n.locator('.mc-hand').nth(1).boundingBox())!.height).toBeLessThan(90);
		await expect(note(page, 'a short one').getByRole('button', { name: 'Read more' })).toHaveCount(
			0
		);

		await n.getByRole('button', { name: 'Read more' }).click();
		const drawer = page.locator('.mc-drawer');
		const last = drawer.locator('.mc-turn').last();
		await expect(last.locator('.mc-hand')).toHaveText(lastWords);
		await expect(last.locator('.mc-hand')).not.toHaveClass(/mc-clamp/);
		await expect(last.getByRole('button', { name: 'Show less' })).toBeVisible();
		// Scrolled to that comment, not left at the top.
		await expect
			.poll(async () => {
				const b = (await drawer.locator('.mc-drawer-body').boundingBox())!;
				const r = (await last.boundingBox())!;
				return Math.abs(r.y - b.y);
			})
			.toBeLessThan(40);

		// The other long comment in the thread stays cut short until asked for.
		const other = drawer.locator('.mc-turn').nth(2);
		await expect(other.locator('.mc-hand')).toHaveClass(/mc-clamp/);
		await other.getByRole('button', { name: 'Read more' }).click();
		await expect(other.locator('.mc-hand')).not.toHaveClass(/mc-clamp/);
		await other.getByRole('button', { name: 'Show less' }).click();
		await expect(other.locator('.mc-hand')).toHaveClass(/mc-clamp/);
	});

	test('the writer can reword a comment; every earlier wording is kept', async ({
		page,
		request
	}) => {
		const theirs = await seedComment(request, 'e2e-public', 'Work starts on', 'not mine to edit');
		await open(page, 'e2e-public');
		await clickBeside(page, para(page, 'Payment is due'));
		await write(page, 'frist draft of my coment', 'Maya Lin');

		const mine = note(page, 'frist draft');
		await mine.hover();
		await mine.getByRole('button', { name: /edit/ }).click();
		// While it is being edited the note holds a text box, not the text.
		const box = page.getByLabel('Edit your comment');
		await expect(box).toHaveValue('frist draft of my coment');
		await box.fill('first draft of my comment');
		await page.locator('.mc-note').getByRole('button', { name: 'Save' }).click();
		const fixed = note(page, 'first draft of my comment');
		await expect(fixed).toBeVisible();
		await expect(fixed).toContainText('edited');

		// A second edit, saved from the keyboard. Escape leaves it alone.
		await fixed.hover();
		await fixed.getByRole('button', { name: '· edit', exact: true }).click();
		await page.getByLabel('Edit your comment').fill('thrown away');
		await page.keyboard.press('Escape');
		await expect(fixed).toContainText('first draft of my comment');
		await fixed.getByRole('button', { name: '· edit', exact: true }).click();
		await page.getByLabel('Edit your comment').fill('final wording');
		await page.keyboard.press('Control+Enter');
		const final = note(page, 'final wording');
		await expect(final).toBeVisible();

		// The audit trail: both earlier wordings, in the database and on request in the page.
		const log = await db.execute(
			`select body_before, body_after, edited_by_user_id from note_comment_edits order by id`
		);
		expect(log.rows.map((r) => [r.body_before, r.body_after])).toEqual([
			['frist draft of my coment', 'first draft of my comment'],
			['first draft of my comment', 'final wording']
		]);
		await final.getByRole('button', { name: '· edited' }).click();
		await expect(final.locator('.mc-was')).toHaveText([
			'first draft of my comment',
			'frist draft of my coment'
		]);

		// Still edited after a reload; someone else's comment offers no edit.
		await page.reload();
		await expect(note(page, 'final wording')).toContainText('edited');
		await note(page, 'not mine to edit').hover();
		await expect(note(page, 'not mine to edit').getByRole('button', { name: /edit/ })).toHaveCount(
			0
		);

		// Nobody else can reword it or read the earlier wording: not a stranger, not even the owner.
		const stranger = await request.patch(`/api/notes/e2e-public/comments/${theirs}`, {
			data: { body: 'hijacked' }
		});
		expect(stranger.status()).toBe(403);
		const owner = await request.patch(`/api/notes/e2e-public/comments/${theirs}`, {
			data: { body: 'hijacked' },
			headers: { authorization: `Bearer ${OWNER.session}` }
		});
		expect(owner.status()).toBe(403);
		const mineId = (await comments('e2e-public')).find((r) => r.body === 'final wording')!.id;
		expect((await request.get(`/api/notes/e2e-public/comments/${mineId}`)).status()).toBe(403);
		// The owner may read the trail (moderation), and guests only see that it was edited.
		const trail = await request.get(`/api/notes/e2e-public/comments/${mineId}`, {
			headers: { authorization: `Bearer ${OWNER.session}` }
		});
		expect((await trail.json()).edits).toHaveLength(2);
		const empty = await request.patch(`/api/notes/e2e-public/comments/${theirs}`, {
			data: { body: '   ' },
			headers: { 'x-comment-key': 'seed-key-0123456789abcdef' }
		});
		expect(empty.status()).toBe(400);
		expect((await comments('e2e-public')).map((r) => r.body).sort()).toEqual([
			'final wording',
			'not mine to edit'
		]);
	});

	test('each person gets their own colour, on their name, bracket and highlight', async ({
		page,
		request
	}) => {
		const quote = (text: string, q: string) => ({
			anchor: { v: 1, kind: 'text', index: 1, ...BLOCKS[text], quote: q, prefix: '', suffix: '' }
		});
		await seedComment(
			request,
			'e2e-public',
			'We will build',
			'maya one',
			quote('We will build', 'onboarding flow')
		);
		await seedComment(
			request,
			'e2e-public',
			'Work starts on',
			'maya two',
			quote('Work starts on', 'first Monday')
		);
		await seedComment(request, 'e2e-public', 'Payment is due', 'sam one', {
			...quote('Payment is due', 'fourteen days'),
			name: 'Sam Ortiz',
			key: 'sam-key-0123456789abcdef'
		});
		await open(page, 'e2e-public');
		await expect(page.locator('.mc-highlight')).toHaveCount(3);

		const colour = (text: string, selector: string, prop: string) =>
			note(page, text)
				.locator(selector)
				.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
		const mayaOne = await colour('maya one', '.mc-author', 'color');
		const mayaTwo = await colour('maya two', '.mc-author', 'color');
		const sam = await colour('sam one', '.mc-author', 'color');
		expect(mayaOne).toBe(mayaTwo);
		expect(sam).not.toBe(mayaOne);

		// Highlights and brackets carry the same hue as the name, and are drawn shapes, not boxes.
		const fills = await page
			.locator('.mc-highlight')
			.evaluateAll((els) =>
				els.map((el) => [
					getComputedStyle(el).fill,
					el.tagName,
					el.getAttribute('d')!.includes('Q')
				])
			);
		expect(new Set(fills.map((f) => f[0])).size).toBe(2);
		expect(fills.every((f) => f[1] === 'path' && f[2] === true)).toBe(true);
		const strokes = await page
			.locator('.mc-mark')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
		expect(new Set(strokes).size).toBe(2);
		expect(strokes).toContain(mayaOne);
		expect(strokes).toContain(sam);
	});
});

test.describe('opening a thread', () => {
	test('a click on any comment, or on its bracket, opens the pane on it', async ({
		page,
		request
	}) => {
		const root = await seedComment(request, 'e2e-public', 'Payment is due', 'the opener');
		for (let i = 1; i <= 12; i++) {
			await seedComment(request, 'e2e-public', 'Payment is due', `answer ${i}`, { parentId: root });
		}
		await seedComment(request, 'e2e-public', 'Work starts on', 'a lone comment');
		await open(page, 'e2e-public');
		await page.setViewportSize({ width: 1440, height: 520 });
		const drawer = page.locator('.mc-drawer');

		// The first comment of a long thread: the pane opens at the top, on it.
		await note(page, 'the opener').locator('.mc-hand').first().click();
		await expect(drawer.locator('.mc-turn')).toHaveCount(13);
		await expect(drawer.getByText('the opener')).toBeInViewport();
		await expect(drawer.getByText('answer 12')).not.toBeInViewport();
		await page.keyboard.press('Escape');

		// A comment with no replies opens too.
		await note(page, 'a lone comment').locator('.mc-hand').click();
		await expect(drawer.locator('.mc-turn')).toHaveCount(1);
		await page.keyboard.press('Escape');

		// Buttons inside a comment keep their own job.
		const lone = note(page, 'a lone comment');
		await lone.hover();
		await lone.getByRole('button', { name: 'Reply' }).click();
		await expect(drawer).toHaveCount(0);
		await expect(lone.locator('textarea')).toBeVisible();
		await page.keyboard.press('Escape');

		// The bracket opens the thread it stands for, at the newest comment.
		await para(page, 'Payment is due').scrollIntoViewIfNeeded();
		await page.locator('.mc-mark-hit').first().click();
		await expect(drawer.locator('.mc-turn')).toHaveCount(13);
		await expect(drawer.getByText('answer 12')).toBeInViewport();
		// It did not start a new comment on that line.
		await page.keyboard.press('Escape');
		await expect(composer(page)).toHaveCount(0);
	});

	test('the menu lists the latest comments, newest first; one click goes there and opens the thread', async ({
		page,
		request
	}) => {
		await seedComment(request, 'e2e-public', 'We will build', 'first, near the top');
		const root = await seedComment(request, 'e2e-public', 'Work starts on', 'second, far down');
		await seedComment(request, 'e2e-public', 'Work starts on', 'a reply, the newest', {
			parentId: root,
			name: 'Sam Ortiz',
			key: 'seed-key-sam-0123456789abcdef'
		});
		// Same-second seeds: spread them so the order is certain.
		const rows = await comments('e2e-public');
		for (let i = 0; i < rows.length; i++) {
			await db.execute({
				sql: `update note_comments set created_at = ? where id = ?`,
				args: [Math.floor(Date.now() / 1000) - (rows.length - i) * 60, rows[i].id as string]
			});
		}
		await open(page, 'e2e-public');
		await page.locator('.mc-toggle-btn').hover();
		const items = page.locator('.mc-latest-item');
		await expect(items).toHaveCount(3);
		await expect(items.nth(0)).toContainText('Sam Ortiz replied');
		await expect(items.nth(0)).toContainText('a reply, the newest');
		await expect(items.nth(2)).toContainText('first, near the top');

		await items.nth(0).click();
		const drawer = page.locator('.mc-drawer');
		await expect(drawer).toContainText('second, far down');
		await expect(drawer.locator('.mc-flash')).toContainText('a reply, the newest');
		await expect(page.locator('.mc-menu')).toHaveCount(0);
		await expect(para(page, 'Work starts on')).toBeInViewport();
	});

	test('the settings menu has an explicit switch for comments', async ({ page, request }) => {
		await seedComment(request, 'e2e-public', 'Payment is due', 'switch me off');
		await open(page, 'e2e-public');
		await page.locator('.mc-toggle-btn').hover();
		const sw = page.getByRole('switch', { name: 'Show comments' });
		await expect(sw).toHaveAttribute('aria-checked', 'true');
		await sw.click();
		await expect(sw).toHaveAttribute('aria-checked', 'false');
		await expect(page.locator('.mc-note')).toHaveCount(0);
		await sw.click();
		await expect(note(page, 'switch me off')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Comment settings' })).toHaveCount(0);
	});
});

test.describe('settings', () => {
	test('hovering the comments button offers writing style, size and colour; a click still toggles', async ({
		page,
		request
	}) => {
		await seedComment(request, 'e2e-public', 'Payment is due', 'style me');
		await open(page, 'e2e-public');
		const hand = note(page, 'style me').locator('.mc-hand');
		const style = () =>
			hand.evaluate(
				(el) =>
					[getComputedStyle(el).fontFamily, parseFloat(getComputedStyle(el).fontSize)] as const
			);
		const [font, size] = await style();
		expect(font).toContain('Caveat');

		await expect(page.locator('.mc-menu')).toHaveCount(0);
		await page.locator('.mc-toggle-btn').hover();
		const menu = page.locator('.mc-menu');
		await expect(menu).toBeVisible();
		await menu.getByRole('button', { name: 'Plain' }).click();
		await menu.getByRole('button', { name: 'Large' }).click();
		await menu.getByRole('button', { name: 'One ink' }).click();
		const [plainFont, plainSize] = await style();
		expect(plainFont).not.toContain('Caveat');
		expect(plainSize).toBe(16);
		expect(size).toBeGreaterThan(plainSize);
		await page.mouse.move(400, 400);
		await expect(menu).toHaveCount(0);

		// Remembered.
		await page.reload();
		await expect(note(page, 'style me')).toBeVisible();
		expect((await style())[0]).not.toContain('Caveat');

		// The button itself still hides and shows comments.
		await page.locator('.mc-toggle-btn').click();
		await expect(page.locator('.mc-note')).toHaveCount(0);
		await page.locator('.mc-toggle-btn').click();
		await expect(note(page, 'style me')).toBeVisible();
	});
});

test.describe('every kind of element', () => {
	const cases: {
		name: string;
		target: (p: Page) => Locator;
		tag: string;
		has: (a: Row) => boolean;
	}[] = [
		{
			name: 'heading',
			target: (p) => p.locator('article h2', { hasText: 'Timeline' }),
			tag: 'h2',
			has: (a) => a.text === 'Timeline'
		},
		{
			name: 'image',
			target: (p) => p.locator('article img'),
			tag: 'p',
			has: (a) => a.src === '/favicon.png' && a.text === ''
		},
		{
			name: 'video',
			target: (p) => p.locator('article video'),
			tag: 'p',
			has: (a) => a.src === '/missing-e2e-video.mp4'
		},
		{
			name: 'table row',
			target: (p) => p.locator('article tr', { hasText: 'Build' }),
			tag: 'tr',
			has: (a) => a.text === 'Build 120 $12,000'
		},
		{
			name: 'table header',
			target: (p) => p.locator('article thead tr'),
			tag: 'tr',
			has: (a) => a.text === 'Phase Hours Price'
		},
		{
			name: 'code block',
			target: (p) => p.locator('article pre'),
			tag: 'pre',
			has: (a) => String(a.text).startsWith('const total')
		},
		{
			name: 'quote',
			target: (p) => p.locator('article blockquote p'),
			tag: 'p',
			has: (a) => String(a.text).startsWith('Either party')
		},
		{
			name: 'nested list item',
			target: (p) => p.getByText('Billing page', { exact: true }),
			tag: 'li',
			has: (a) => a.text === 'Billing page'
		},
		{
			name: 'maths',
			target: (p) => p.locator('article .katex-display').first(),
			tag: '',
			has: (a) => String(a.text).length > 0
		}
	];

	for (const c of cases) {
		test(c.name, async ({ page }) => {
			await open(page, 'e2e-elements');
			const target = c.target(page);
			await clickBeside(page, target);
			await write(page, `about the ${c.name}`, 'Maya Lin');

			const [row] = await comments('e2e-elements');
			const anchor = row.anchor as Row;
			if (c.tag) expect(anchor.tag).toBe(c.tag);
			expect(c.has(anchor), JSON.stringify(anchor)).toBe(true);

			// The bracket stands beside the element it was made on.
			await page.reload();
			await expect(note(page, `about the ${c.name}`)).toBeVisible();
			// Measured again until it holds: a late image can still move the page.
			await expect(async () => {
				const mark = (await page.locator('.mc-mark').boundingBox())!;
				const box = (await c.target(page).boundingBox())!;
				expect(mark.y).toBeLessThanOrEqual(box.y + box.height / 2);
				expect(mark.y + mark.height).toBeGreaterThanOrEqual(box.y + box.height / 2);
			}).toPass({ timeout: 5000 });
		});
	}

	test('a list item with children is its own line, separate from them', async ({ page }) => {
		await open(page, 'e2e-elements');
		const item = page.locator('article li', { hasText: 'Build phase' }).first();
		const box = (await item.boundingBox())!;
		// Its first line, not the middle of the whole item (which is a child).
		await page.mouse.click(box.x + 200, box.y + 10);
		await write(page, 'about the parent item', 'Maya Lin');
		const [row] = await comments('e2e-elements');
		expect((row.anchor as Row).text).toBe('Build phase');
	});

	test('text inside a collapsed section', async ({ page }) => {
		await open(page, 'e2e-elements');
		await page.locator('article summary').click();
		await expect(composer(page)).toHaveCount(0); // the summary toggles, it does not comment
		await clickBeside(page, para(page, 'Prices exclude tax'));
		await write(page, 'which tax?', 'Maya Lin');

		// Collapsed again, the note stays beside the summary instead of vanishing.
		await page.reload();
		await expect(note(page, 'which tax?')).toBeVisible();
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		await expect(async () => {
			const mark = (await page.locator('.mc-mark').boundingBox())!;
			const summary = (await page.locator('article details').boundingBox())!;
			expect(Math.abs(mark.y - summary.y)).toBeLessThan(20);
		}).toPass({ timeout: 5000 });
	});

	test('clicking a video plays it; the space beside it comments', async ({ page }) => {
		await open(page, 'e2e-elements');
		await page.locator('article video').click();
		await expect(composer(page)).toHaveCount(0);
		await clickBeside(page, page.locator('article video'));
		await expect(composer(page)).toBeVisible();
	});
});

test.describe("pins on pictures and the author's own HTML", () => {
	const stat = (page: Page, text: string) => page.locator('article .stat', { hasText: text });
	/** Where the point of the only pin is, in page pixels. */
	const pinPoint = (page: Page) =>
		// Read from where the pin is placed: its drawn box tilts and drops in.
		page.locator('.mc-pin').evaluate((el: HTMLElement) => {
			const layer = el.closest('.mc-layer')!.getBoundingClientRect();
			return {
				x: layer.left + parseFloat(el.style.left) + 10,
				y: layer.top + parseFloat(el.style.top) + 30
			};
		});

	test('a click inside an HTML block sticks a pin at that point, and it stays there', async ({
		page
	}) => {
		await open(page, 'e2e-report');
		const box = (await stat(page, 'Customers').boundingBox())!;
		const at = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.3 };
		await page.mouse.click(at.x, at.y);
		await expect(page.locator('.mc-pin')).toHaveCount(1);
		// A pin, not a bracket.
		await expect(page.locator('.mc-mark')).toHaveCount(0);
		await write(page, 'is this net of churn?', 'Maya Lin');

		const [row] = await comments('e2e-report');
		const anchor = row.anchor as Row & { pin: { x: number; y: number } };
		expect(anchor.kind).toBe('block');
		expect(anchor.text).toBe('1,280 Customers');
		expect(anchor.pin.x).toBeCloseTo(0.75, 1);
		expect(anchor.pin.y).toBeCloseTo(0.3, 1);

		await page.reload();
		await expect(note(page, 'is this net of churn?')).toBeVisible();
		await expect(page.locator('.mc-mark')).toHaveCount(0);
		const again = (await stat(page, 'Customers').boundingBox())!;
		const point = await pinPoint(page);
		expect(Math.abs(point.x - (again.x + again.width * 0.75))).toBeLessThan(3);
		expect(Math.abs(point.y - (again.y + again.height * 0.3))).toBeLessThan(3);

		// The pin opens its thread.
		await page.locator('.mc-pin').click();
		await expect(page.locator('.mc-drawer')).toContainText('is this net of churn?');
		await expect(page.locator('.mc-spot')).toBeVisible();
	});

	test('the gap between two boxes takes a pin too, and so does a picture', async ({ page }) => {
		await open(page, 'e2e-report');
		const a = (await stat(page, 'Revenue').boundingBox())!;
		const b = (await stat(page, 'Customers').boundingBox())!;
		const gap = { x: (a.x + a.width + b.x) / 2, y: a.y + a.height / 2 };
		await page.mouse.click(gap.x, gap.y);
		await expect(page.locator('.mc-pin')).toHaveCount(1);
		const point = await pinPoint(page);
		expect(Math.abs(point.x - gap.x)).toBeLessThan(3);
		expect(Math.abs(point.y - gap.y)).toBeLessThan(3);
		await write(page, 'between the two', 'Maya Lin');

		const img = page.locator('article img');
		await img.scrollIntoViewIfNeeded();
		const box = (await img.boundingBox())!;
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await write(page, 'on the chart');
		await expect(page.locator('.mc-pin')).toHaveCount(2);

		const rows = await comments('e2e-report');
		const first = rows[0].anchor as Row & { pin: { x: number } };
		const second = rows[1].anchor as Row & { pin: { x: number; y: number } };
		expect(first.pin.x < 0 || first.pin.x > 1).toBe(true);
		expect(second.src).toBe('/favicon.png');
		expect(second.pin.x).toBeCloseTo(0.5, 1);
		expect(second.pin.y).toBeCloseTo(0.5, 1);
	});

	test('ordinary text beside the HTML still gets a bracket, and a pin moves with its box', async ({
		page
	}) => {
		await open(page, 'e2e-report');
		await clickBeside(page, para(page, 'The board approved'));
		await write(page, 'a plain line', 'Maya Lin');
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		await expect(page.locator('.mc-pin')).toHaveCount(0);

		const box = (await stat(page, 'Renewals').boundingBox())!;
		await page.mouse.click(box.x + 20, box.y + 12);
		await write(page, 'pinned on renewals');

		// The author adds a paragraph above: the pin is still 20px into the same box.
		await setContent(
			'e2e-report',
			NOTES['e2e-report'].content.replace(
				'## Annual report',
				'## Annual report\n\nA new opening paragraph, added after the comments were made.'
			)
		);
		await page.reload();
		await expect(note(page, 'pinned on renewals')).toBeVisible();
		const moved = (await stat(page, 'Renewals').boundingBox())!;
		const point = await pinPoint(page);
		expect(moved.y).toBeGreaterThan(box.y + 10);
		expect(Math.abs(point.x - (moved.x + 20))).toBeLessThan(3);
		expect(Math.abs(point.y - (moved.y + 12))).toBeLessThan(3);
	});

	test('a pin far outside its block is pulled back by the server', async ({ request }) => {
		const res = await request.post('/api/notes/e2e-report/comments', {
			data: {
				body: 'way off',
				name: 'Maya Lin',
				anchor: {
					v: 1,
					kind: 'block',
					tag: 'div',
					index: 3,
					text: '97% Renewals',
					pin: { x: 9999, y: 0.5 }
				}
			}
		});
		expect(res.status()).toBe(201);
		const [row] = await comments('e2e-report');
		expect((row.anchor as Row).pin).toEqual({ x: 5, y: 0.5 });
	});

	test.describe('on a phone', () => {
		test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

		test('a tap pins the spot and offers to comment on it', async ({ page }) => {
			await open(page, 'e2e-report');
			await stat(page, 'Customers').tap();
			await expect(page.locator('.mc-pin')).toHaveCount(1);
			const pill = page.locator('.mc-pill-fixed');
			await expect(pill).toHaveText('Comment on this spot');
			await pill.tap();
			const sheet = page.locator('.mc-sheet');
			await sheet.getByPlaceholder('Your name').fill('Sam Ortiz');
			await sheet.locator('textarea').fill('pinned from a phone');
			await sheet.getByRole('button', { name: 'Comment' }).tap();
			await expect(sheet).toHaveCount(0);
			await expect(page.locator('.mc-pin')).toHaveCount(1);
			expect(((await comments('e2e-report'))[0].anchor as Row).pin).toBeTruthy();

			// Tapping the pin opens what was said there.
			await page.locator('.mc-pin').tap();
			await expect(page.locator('.mc-sheet')).toContainText('pinned from a phone');
		});
	});
});

test.describe('the document changes after people commented', () => {
	const original = NOTES['e2e-edit'].content;
	const edit = (from: string, to: string, content = original) => {
		expect(content).toContain(from);
		return content.replace(from, to);
	};

	async function commentOn(page: Page, block: Locator, text: string) {
		await clickBeside(page, block);
		const c = composer(page);
		await expect(c).toBeVisible();
		if (await c.getByPlaceholder('Your name').count())
			await c.getByPlaceholder('Your name').fill('Maya Lin');
		await c.locator('textarea').fill(text);
		await c.getByRole('button', { name: 'Comment' }).click();
		await expect(note(page, text)).toBeVisible();
	}

	/** The block whose vertical middle the note's bracket covers. */
	async function expectBeside(page: Page, text: string, block: Locator) {
		const n = note(page, text);
		await expect(n).toBeVisible();
		const marks = await page
			.locator('.mc-mark')
			.evaluateAll((els) =>
				els.map((e) => e.getBoundingClientRect()).map((r) => [r.top, r.bottom])
			);
		const middle = await block.evaluate((el) => {
			const r = el.getBoundingClientRect();
			return (r.top + r.bottom) / 2;
		});
		expect(
			marks.some(([top, bottom]) => top <= middle && middle <= bottom),
			`no bracket beside the block for "${text}"`
		).toBe(true);
	}

	test('comments follow their text through moves, rewrites and swaps', async ({ page }) => {
		await open(page, 'e2e-edit');
		await commentOn(page, para(page, 'Payment is due'), 'on the payment terms');
		await commentOn(page, page.locator('article tr', { hasText: 'Build' }), 'on the build row');
		await commentOn(page, page.locator('article pre'), 'on the code');
		await commentOn(page, page.locator('article img'), 'on the image');
		await selectText(page, para(page, 'We will build'), 'onboarding flow and the billing page');
		await write(page, 'on the quoted words');

		let md = original;
		// New text above everything.
		md = edit(
			'## Scope of work\n',
			'A note before we start.\n\nThis is the second draft.\n\n## Scope of work\n',
			md
		);
		// The quoted words are edited.
		md = edit(
			'We will build the onboarding flow and the billing page in the first month.',
			'In month one we will design and build the onboarding flow plus the billing page.',
			md
		);
		// The commented paragraph is reworded.
		md = edit(
			'Payment is due within fourteen days of each invoice being issued.',
			'Payment is due within thirty days of every invoice.',
			md
		);
		// The image file is swapped.
		md = edit('(/favicon.png)', '(/apple-touch-icon.png)', md);
		// The commented row changes and gets a new row above it.
		md = edit(
			'| Build | 120 | $12,000 |',
			'| Research | 10 | $1,000 |\n| Build | 140 | $14,000 |',
			md
		);
		// The code block moves to the end.
		const code =
			'```js\nconst total = phases.reduce((sum, p) => sum + p.price, 0);\nconsole.log(total);\n```\n';
		md = edit(code, '', md).trimEnd() + '\n\n' + code;
		await setContent('e2e-edit', md);

		await page.reload();
		await expect(page.locator('.mc-note')).toHaveCount(5);
		await expect(page.locator('.mc-note-flag')).toHaveCount(0);
		await expect(page.locator('.mc-mark')).toHaveCount(5);
		await expectBeside(
			page,
			'on the payment terms',
			para(page, 'Payment is due within thirty days')
		);
		await expectBeside(page, 'on the build row', page.locator('article tr', { hasText: 'Build' }));
		await expectBeside(page, 'on the code', page.locator('article pre'));
		await expectBeside(page, 'on the image', page.locator('article img'));
		await expectBeside(page, 'on the quoted words', para(page, 'In month one'));

		// The highlight sits on what is left of the quote.
		const highlighted = await page.evaluate(() => {
			const h = document.querySelector('.mc-highlight')!.getBoundingClientRect();
			const range = document.caretRangeFromPoint(h.left + 6, h.top + h.height / 2)!;
			return range.startContainer.textContent!.slice(range.startOffset, range.startOffset + 12);
		});
		expect('onboarding flow plus the billing page').toContain(highlighted.trim().slice(0, 8));
	});

	test('deleted text keeps its comment, flagged, and never jumps to a lookalike', async ({
		page
	}) => {
		await open(page, 'e2e-edit');
		await commentOn(
			page,
			page.getByText('Onboarding flow', { exact: true }),
			'on the removed item'
		);
		await commentOn(page, para(page, 'Payment is due'), 'on the removed paragraph');

		let md = edit('  - Onboarding flow\n', '');
		md = edit(
			'Payment is due within fourteen days of each invoice being issued. Late invoices pause the work until they are settled.\n\n',
			'',
			md
		);
		await setContent('e2e-edit', md);
		await page.reload();

		await expect(page.locator('.mc-note')).toHaveCount(2);
		await expect(page.locator('.mc-mark')).toHaveCount(0);
		await expect(page.locator('.mc-dot')).toHaveCount(2);
		await expect(note(page, 'on the removed item')).toContainText(
			'The text this was on was removed'
		);
		await expect(note(page, 'on the removed item')).toContainText('Onboarding flow');
		await expect(note(page, 'on the removed paragraph')).toContainText(
			'Payment is due within fourteen'
		);

		// The text comes back: so does the bracket.
		await setContent('e2e-edit', original);
		await page.reload();
		await expect(page.locator('.mc-mark')).toHaveCount(2);
		await expect(page.locator('.mc-note-flag')).toHaveCount(0);
	});

	test('a whole section deleted: its comments are kept and flagged, none moves to another section', async ({
		page
	}) => {
		await open(page, 'e2e-edit');
		await commentOn(
			page,
			page.locator('article h2', { hasText: 'Timeline' }),
			'on the timeline heading'
		);
		await commentOn(page, para(page, 'Work starts on'), 'on the timeline paragraph');
		await selectText(page, para(page, 'Work starts on'), 'about ten weeks');
		await write(page, 'on three words of it');
		await commentOn(page, para(page, 'Payment is due'), 'in another section');

		const cut = original.indexOf('## Timeline');
		expect(cut).toBeGreaterThan(0);
		await setContent('e2e-edit', original.slice(0, cut).replace('- [Timeline](#timeline)\n', ''));
		await page.reload();

		await expect(page.locator('article')).not.toContainText('Work starts on');
		await expect(page.locator('.mc-note')).toHaveCount(4);
		await expect(page.locator('.mc-note-flag')).toHaveCount(3);
		await expect(page.locator('.mc-highlight')).toHaveCount(0);
		for (const text of [
			'on the timeline heading',
			'on the timeline paragraph',
			'on three words of it'
		]) {
			await expect(note(page, text)).toContainText('The text this was on was removed');
		}
		await expect(note(page, 'on three words of it')).toContainText('about ten weeks');
		// The comment in the surviving section is untouched, and it is the only bracket left.
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		await expectBeside(page, 'in another section', para(page, 'Payment is due'));
		await expect(note(page, 'in another section').locator('.mc-note-flag')).toHaveCount(0);
		// A detached thread still opens, replies and all; with nothing to light up the page is just tinted.
		await expect(page.locator('.mc-toggle-btn')).toContainText('4');
	});

	test('a paragraph rewritten from scratch keeps its comments where it stands', async ({
		page
	}) => {
		await open(page, 'e2e-edit');
		await commentOn(page, para(page, 'Payment is due'), 'on the whole paragraph');
		await selectText(page, para(page, 'Payment is due'), 'fourteen days');
		await write(page, 'on two words');

		// Not one word in common with what was there; the paragraphs either side are unchanged.
		const rewritten = 'Send money by bank transfer before month end, otherwise delivery stops.';
		await setContent(
			'e2e-edit',
			edit(
				'Payment is due within fourteen days of each invoice being issued. Late invoices pause the work until they are settled.',
				rewritten
			)
		);
		await page.reload();
		await expect(page.locator('.mc-note')).toHaveCount(2);
		await expectBeside(page, 'on the whole paragraph', para(page, 'Send money by bank transfer'));
		await expect(note(page, 'on the whole paragraph').locator('.mc-note-flag')).toHaveCount(0);
		// The quoted words are gone: the comment stays on the paragraph and says what it was on.
		await expect(note(page, 'on two words')).toContainText('Was on: “fourteen days”');
		await expect(page.locator('.mc-highlight')).toHaveCount(0);
		await expect(page.locator('.mc-dot')).toHaveCount(0);
	});

	test('a section rewritten wholesale, neighbours and all, detaches rather than guesses', async ({
		page
	}) => {
		await open(page, 'e2e-edit');
		await commentOn(page, para(page, 'Payment is due'), 'lost in the rewrite');
		await commentOn(page, para(page, 'Work starts on'), 'far away and untouched');

		const start = original.indexOf('## Scope of work');
		const end = original.indexOf('## Timeline');
		const rewritten =
			original.slice(0, start) +
			'## Scope of work\n\nEverything here was thrown out and written again.\n\nNone of the old sentences survive in any form.\n\n' +
			original.slice(end);
		await setContent('e2e-edit', rewritten);
		await page.reload();
		await expect(note(page, 'lost in the rewrite')).toContainText(
			'The text this was on was removed'
		);
		await expect(note(page, 'lost in the rewrite')).toContainText('Payment is due within fourteen');
		await expectBeside(page, 'far away and untouched', para(page, 'Work starts on'));
		await expect(page.locator('.mc-mark')).toHaveCount(1);
	});

	test("the owner's visit saves where an edited comment is now, so a second edit still finds it", async ({
		page,
		browser
	}) => {
		await open(page, 'e2e-edit');
		await commentOn(page, para(page, 'Payment is due'), 'two edits later');

		const first = edit(
			'Payment is due within fourteen days of each invoice being issued. Late invoices pause the work until they are settled.',
			'Payment is due within fourteen days of the invoice date. Late invoices stop the work.'
		);
		await setContent('e2e-edit', first);

		const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		const ownerPage = await ownerContext.newPage();
		await loginAs(ownerPage, OWNER);
		await open(ownerPage, 'e2e-edit');
		await expect(note(ownerPage, 'two edits later')).toBeVisible();
		await expect
			.poll(async () => ((await comments('e2e-edit'))[0].anchor as Row).text)
			.toContain('Late invoices stop the work');
		await ownerContext.close();

		// Far enough from the original that only the refreshed anchor can match it.
		const second = first.replace(
			'Payment is due within fourteen days of the invoice date. Late invoices stop the work.',
			'Invoices are settled within fourteen days of the invoice date. Late ones stop the work.'
		);
		await setContent('e2e-edit', second);
		await page.reload();
		await expect(page.locator('.mc-note-flag')).toHaveCount(0);
		await expectBeside(page, 'two edits later', para(page, 'Invoices are settled'));
	});
});

test.describe('the owner', () => {
	test('resolves, reopens and deletes; sees guest emails; comments under their own name', async ({
		page,
		request
	}) => {
		const id = await seedComment(request, 'e2e-owner', 'Payment is due', 'please fix this');
		await seedComment(request, 'e2e-owner', 'Work starts on', 'and this');
		await loginAs(page, OWNER);
		await open(page, 'e2e-owner');

		const n = note(page, 'please fix this');
		await n.hover();
		await expect(n.locator('a[href="mailto:maya@example.test"]')).toBeVisible();

		await n.getByRole('button', { name: 'Resolve' }).click();
		await expect(n).toHaveCount(0);
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		await expect(page.locator('.mc-toggle-btn')).toContainText('1');
		await expect
			.poll(async () => (await comments('e2e-owner'))[0].resolved_by_user_id)
			.toBe(OWNER.id);

		// Hidden by default after a reload too; shown on request, faded, and can be reopened.
		await page.reload();
		await expect(note(page, 'and this')).toBeVisible();
		await expect(note(page, 'please fix this')).toHaveCount(0);
		await page.locator('.mc-toggle-btn').hover();
		await page.getByRole('button', { name: 'Show 1 resolved' }).click();
		await page.mouse.move(400, 400);
		const resolved = note(page, 'please fix this');
		await expect(resolved).toHaveClass(/mc-resolved/);
		await resolved.hover();
		await expect(resolved.getByRole('button', { name: 'Reply' })).toHaveCount(0);
		await resolved.getByRole('button', { name: 'Reopen' }).click();
		await expect(resolved).not.toHaveClass(/mc-resolved/);
		await expect.poll(async () => (await comments('e2e-owner'))[0].resolved_at).toBeNull();

		// No name or email asked of a signed-in user.
		await clickBeside(page, para(page, 'We will build'));
		await expect(composer(page).locator('input:not(.mc-trap)')).toHaveCount(0);
		await expect(composer(page).locator('.mc-who')).toContainText('as Dana Owner');
		await write(page, 'noted, will change');
		await expect(note(page, 'noted, will change')).toContainText('Dana Owner');
		await expect(note(page, 'noted, will change')).not.toContainText('(author)');

		// Deleting someone else's thread.
		await resolved.hover();
		page.once('dialog', (d) => d.accept());
		await resolved
			.getByRole('button', { name: /delete/ })
			.first()
			.click();
		await expect(note(page, 'please fix this')).toHaveCount(0);
		const left = await comments('e2e-owner');
		expect(left.map((r) => r.id)).not.toContain(id);
	});

	test('guests get neither emails nor moderation from the API', async ({ request }) => {
		const id = await seedComment(request, 'e2e-owner', 'Payment is due', 'private email please');
		const state = await (await request.get('/api/notes/e2e-owner/comments')).json();
		expect(state.canModerate).toBe(false);
		expect(JSON.stringify(state)).not.toContain('maya@example.test');
		expect(JSON.stringify(state)).not.toMatch(/ipAddress|authorKeyHash|ip_address/);

		const resolve = await request.patch(`/api/notes/e2e-owner/comments/${id}`, {
			data: { resolved: true }
		});
		expect(resolve.status()).toBe(403);
		const move = await request.patch(`/api/notes/e2e-owner/comments/${id}`, {
			data: { anchor: { v: 1, kind: 'block', tag: 'p', index: 0, text: 'hijacked' } }
		});
		expect(move.status()).toBe(403);
		const del = await request.delete(`/api/notes/e2e-owner/comments/${id}`);
		expect(del.status()).toBe(403);
		const wrongKey = await request.delete(`/api/notes/e2e-owner/comments/${id}`, {
			headers: { 'x-comment-key': 'not-the-right-key-000000' }
		});
		expect(wrongKey.status()).toBe(403);
		// Another signed-in user who does not own the note is no moderator either.
		const member = await request.patch(`/api/notes/e2e-owner/comments/${id}`, {
			data: { resolved: true },
			headers: { authorization: `Bearer ${MEMBER.session}` }
		});
		expect(member.status()).toBe(403);
		expect(await comments('e2e-owner')).toHaveLength(1);

		const rightKey = await request.delete(`/api/notes/e2e-owner/comments/${id}`, {
			headers: { 'x-comment-key': 'seed-key-0123456789abcdef' }
		});
		expect(rightKey.status()).toBe(200);
	});
});

test.describe('frontmatter', () => {
	test('mdpubs-comments: true lets guests read but only signed-in users write', async ({
		page,
		request
	}) => {
		const res = await request.post('/api/notes/e2e-users/comments', {
			data: {
				body: 'x',
				name: 'Guest',
				anchor: { v: 1, kind: 'block', tag: 'p', index: 1, text: 'x' }
			}
		});
		expect(res.status()).toBe(401);

		const posted = await request.post('/api/notes/e2e-users/comments', {
			headers: { authorization: `Bearer ${MEMBER.session}` },
			data: {
				body: 'from a member',
				anchor: { v: 1, kind: 'block', index: 2, ...BLOCKS['Payment is due'] }
			}
		});
		expect(posted.status()).toBe(201);

		await open(page, 'e2e-users');
		await expect(note(page, 'from a member')).toContainText('Riley Member');
		await para(page, 'Work starts on').hover();
		await expect(page.locator('.mc-hover')).toHaveCount(0);
		await clickBeside(page, para(page, 'Work starts on'));
		await expect(page.locator('.mc-composer')).toHaveCount(0);
		await note(page, 'from a member').hover();
		await expect(note(page, 'from a member').getByRole('button', { name: 'Reply' })).toHaveCount(0);

		await loginAs(page, MEMBER);
		await open(page, 'e2e-users');
		await clickBeside(page, para(page, 'Work starts on'));
		await write(page, 'members can write');
		const rows = await comments('e2e-users');
		expect(rows[1].user_id).toBe(MEMBER.id);
		expect(rows[1].author_name).toBe('Riley Member');
	});

	test('mdpubs-comments-email: required', async ({ page, request }) => {
		const res = await request.post('/api/notes/e2e-email/comments', {
			data: {
				body: 'x',
				name: 'Guest',
				anchor: { v: 1, kind: 'block', tag: 'p', index: 1, text: 'x' }
			}
		});
		expect(res.status()).toBe(400);

		await open(page, 'e2e-email');
		await clickBeside(page, para(page, 'Payment is due'));
		const c = composer(page);
		await expect(c.getByPlaceholder('Email', { exact: true })).toBeVisible();
		await c.getByPlaceholder('Your name').fill('Maya Lin');
		await c.locator('textarea').fill('with an email');
		await expect(c.getByRole('button', { name: 'Comment' })).toBeDisabled();
		await c.locator('input[type="email"]').fill('not-an-email');
		await c.getByRole('button', { name: 'Comment' }).click();
		await expect(c.locator('.mc-error')).toBeVisible();
		await c.locator('input[type="email"]').fill('maya@example.test');
		await c.getByRole('button', { name: 'Comment' }).click();
		await expect(note(page, 'with an email')).toBeVisible();
	});

	test('mdpubs-comments-email: off asks for a name only and stores no email', async ({
		page,
		request
	}) => {
		await open(page, 'e2e-noemail');
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page).locator('input[type="email"]')).toHaveCount(0);
		await write(page, 'no email here', 'Maya Lin');
		await seedComment(request, 'e2e-noemail', 'Work starts on', 'tried to send one anyway');
		const rows = await comments('e2e-noemail');
		expect(rows.map((r) => r.author_email)).toEqual([null, null]);
	});

	test('no mdpubs-comments key: no comment UI, and the API refuses', async ({ page, request }) => {
		await page.goto('/e2e-off');
		await expect(page.locator('article')).toBeVisible();
		await expect(page.locator('.mc-root')).toHaveCount(0);
		await para(page, 'Payment is due').click();
		await expect(page.locator('.mc-composer')).toHaveCount(0);
		const res = await request.post('/api/notes/e2e-off/comments', {
			data: {
				body: 'x',
				name: 'Guest',
				anchor: { v: 1, kind: 'block', tag: 'p', index: 1, text: 'x' }
			}
		});
		expect(res.status()).toBe(403);
	});

	test('a private note keeps its comments private', async ({ request }) => {
		expect((await request.get('/api/notes/e2e-private/comments')).status()).toBe(404);
		const res = await request.post('/api/notes/e2e-private/comments', {
			data: {
				body: 'x',
				name: 'Guest',
				anchor: { v: 1, kind: 'block', tag: 'p', index: 1, text: 'x' }
			}
		});
		expect(res.status()).toBe(404);
		const owner = await request.get('/api/notes/e2e-private/comments', {
			headers: { authorization: `Bearer ${OWNER.session}` }
		});
		expect(owner.status()).toBe(200);
		expect((await owner.json()).canModerate).toBe(true);
	});
});

test.describe('embedded in another app', () => {
	const asOwner = { Authorization: `Bearer ${OWNER.session}` };
	const mint = async (request: APIRequestContext, id: string, data: Row, headers = asOwner) =>
		request.post(`/api/notes/${id}/embed`, { data, headers });
	const priya = { viewer: { id: 'user-42', name: 'Priya Shah' } };

	test.beforeAll(async () => {
		// Tokens are signed with the owner's stored API-key hash.
		await db.execute({
			sql: `update users set api_key = 'e2e-owner-api-key-hash' where id = ?`,
			args: [OWNER.id]
		});
	});

	test('only the owner can make a link; the note stays private without it', async ({
		page,
		request
	}) => {
		expect((await request.post('/api/notes/e2e-embed/embed', { data: priya })).status()).toBe(401);
		expect(
			(
				await mint(request, 'e2e-embed', priya, { Authorization: `Bearer ${MEMBER.session}` })
			).status()
		).toBe(404);
		expect((await mint(request, 'e2e-embed', { viewer: { id: 'x' } })).status()).toBe(400);

		const res = await mint(request, 'e2e-embed', priya);
		expect(res.status()).toBe(200);
		const { token, url } = await res.json();
		expect(url).toContain('/embed/e2e-embed?embed=mde_');

		// No token, a tampered token, or a token for another note: all refused.
		expect((await request.get('/api/notes/e2e-embed')).status()).toBe(404);
		expect((await page.goto('/e2e-embed'))!.status()).toBe(403);
		const forged = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa');
		expect(
			(await request.get('/api/notes/e2e-embed', { headers: { 'x-embed-token': forged } })).status()
		).toBe(404);
		expect(
			(
				await request.get('/api/notes/e2e-private', { headers: { 'x-embed-token': token } })
			).status()
		).toBe(404);
		expect(
			(await request.get('/api/notes/e2e-embed', { headers: { 'x-embed-token': token } })).status()
		).toBe(200);
		// A token reads and comments. It never edits the note.
		expect(
			(
				await request.put('/api/notes/e2e-embed', {
					data: { content: 'x' },
					headers: { 'x-embed-token': token }
				})
			).status()
		).toBe(401);
	});

	test('the reader sees the private note, with comments and history, under the name the app gave', async ({
		page,
		request
	}) => {
		const { url } = await (await mint(request, 'e2e-embed', priya)).json();
		// The link is a frame page (tested below); these checks are on the page inside it.
		await page.goto(url.replace('/embed/', '/'));
		await expect(page.locator('article')).toContainText('We will build the onboarding flow');
		await expect(page.locator('.mc-layer')).toBeAttached();
		await expect(page.getByRole('button', { name: /History/ })).toBeVisible();
		await expect(page.locator('footer')).toHaveCount(0);

		// No name to type: the app already said who this is.
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page).getByPlaceholder('Your name')).toHaveCount(0);
		await write(page, 'thirty days would suit us better');
		await expect(note(page, 'thirty days would suit us better')).toContainText('Priya Shah');

		const [row] = await comments('e2e-embed');
		expect(row.author_name).toBe('Priya Shah');
		expect(row.user_id).toBeNull();
		expect(row.author_key_hash).toBeTruthy();

		// A later visit with a fresh token: still her comment, hers to edit.
		const again = await (await mint(request, 'e2e-embed', priya)).json();
		const mine = await (
			await request.get('/api/notes/e2e-embed/comments', {
				headers: { 'x-embed-token': again.token }
			})
		).json();
		expect(mine.comments[0].mine).toBe(true);
		expect(mine.viewer.name).toBe('Priya Shah');

		// A colleague sees it, but it is not theirs.
		const other = await (
			await mint(request, 'e2e-embed', { viewer: { id: 'user-7', name: 'Omar Haddad' } })
		).json();
		const theirs = await (
			await request.get('/api/notes/e2e-embed/comments', {
				headers: { 'x-embed-token': other.token }
			})
		).json();
		expect(theirs.comments[0].mine).toBe(false);
		expect(theirs.canComment).toBe(true);
		expect(theirs.canModerate).toBe(false);

		// History loads through the token too.
		await page.getByRole('button', { name: /History/ }).click();
		await expect(page.locator('.hp-panel')).toBeVisible();
		await expect(page.locator('.hp-panel')).not.toContainText('Could not');
	});

	test('the link shows an outline of a page at once, then the note inside it', async ({
		page,
		request
	}) => {
		const { url } = await (await mint(request, 'e2e-embed', priya)).json();
		// The outline is in the very first response, before any note is fetched.
		const first = await (await request.get(`${url}&theme=night`)).text();
		expect(first).toContain('Loading the document');
		expect(first).toContain('#0f172a');
		expect(first).not.toContain('We will build');

		await page.goto(url);
		const inside = page.frameLocator('#f');
		await expect(inside.locator('article')).toContainText('We will build the onboarding flow');
		await expect(page.locator('#s')).toHaveClass('out');
		await expect(inside.locator('.mc-toggle-btn')).toBeVisible();
	});

	test('comments: false in the request leaves a note without the key comment-free', async ({
		page,
		request
	}) => {
		const { url } = await (await mint(request, 'e2e-embed', { ...priya, comments: false })).json();
		await page.goto(`${url.replace('/embed/', '/')}&theme=night`);
		await expect(page.locator('article')).toContainText('We will build');
		await expect(page.locator('.mc-toggle-btn')).toHaveCount(0);
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
	});
});

test.describe('a key limited to one company', () => {
	const asOwner = { Authorization: `Bearer ${OWNER.session}` };
	let key = '';

	test.beforeAll(async ({ request }) => {
		const now = Math.floor(Date.now() / 1000);
		await db.execute(`delete from org_members where org_id = 'e2e-org'`);
		await db.execute(`delete from organizations where id = 'e2e-org'`);
		await db.execute({
			sql: `insert into organizations (id, slug, name, created_at, updated_at) values ('e2e-org', 'e2e-co', 'E2E Co', ?, ?)`,
			args: [now, now]
		});
		await db.execute({
			sql: `insert into org_members (id, org_id, user_id, role, created_at) values ('e2e-m1', 'e2e-org', ?, 'owner', ?)`,
			args: [OWNER.id, now]
		});
		await db.execute({
			sql: `insert into org_members (id, org_id, user_id, role, created_at) values ('e2e-m2', 'e2e-org', ?, 'member', ?)`,
			args: [MEMBER.id, now]
		});
		await db.execute(
			`update users set api_key = 'e2e-owner-api-key-hash' where id = '${OWNER.id}'`
		);
		// One private note is the company's; the owner's other notes are personal.
		await db.execute(`update notes set org_id = 'e2e-org' where public_id = 'e2e-embed'`);

		// A plain member cannot make one; an owner can.
		expect(
			(
				await request.post('/api/orgs/e2e-co/keys', {
					data: {},
					headers: { Authorization: `Bearer ${MEMBER.session}` }
				})
			).status()
		).toBe(404);
		const res = await request.post('/api/orgs/e2e-co/keys', {
			data: { name: 'reports app' },
			headers: asOwner
		});
		expect(res.status(), await res.text()).toBe(201);
		key = (await res.json()).key;
		expect(key).toMatch(/^mdp_/);
	});

	test.afterAll(async () => {
		await db.execute(`update notes set org_id = null where public_id = 'e2e-embed'`);
	});

	test("it lists and reads the company's notes and nothing else of its owner's", async ({
		request
	}) => {
		const headers = { 'X-API-Key': key };
		const list = await (await request.get('/api/notes', { headers })).json();
		expect(list.notes.map((n: Row) => n.publicId)).toEqual(['e2e-embed']);
		// A colleague's private note in the same company is listed and readable too.
		await db.execute({
			sql: `insert into notes (public_id, user_id, org_id, title, content, file_extension, version, created_at, updated_at, tags, is_private)
			      values ('e2e-colleague', ?, 'e2e-org', 'Theirs', 'Body', 'md', 1, 1, 1, '[]', 1)`,
			args: [MEMBER.id]
		});
		const both = await (await request.get('/api/notes', { headers })).json();
		expect(both.notes.map((n: Row) => n.publicId).sort()).toEqual(['e2e-colleague', 'e2e-embed']);
		expect((await request.get('/api/notes/e2e-colleague', { headers })).status()).toBe(200);
		await db.execute(`delete from notes where public_id = 'e2e-colleague'`);
		// The owner's own session still sees everything.
		const all = await (await request.get('/api/notes', { headers: asOwner })).json();
		expect(all.count).toBeGreaterThan(5);

		expect((await request.get('/api/notes/e2e-embed', { headers })).status()).toBe(200);
		// Private and personal: the owner could read it, this key cannot. Nor a public one.
		expect((await request.get('/api/notes/e2e-private', { headers })).status()).toBe(404);
		expect((await request.get('/api/notes/e2e-public', { headers })).status()).toBe(404);
		expect((await request.get('/api/notes/e2e-private/versions', { headers })).status()).toBe(404);
		expect(
			(
				await request.put('/api/notes/e2e-private', { data: { title: 'taken over' }, headers })
			).status()
		).toBe(404);
		expect((await request.delete('/api/notes/e2e-private', { headers })).status()).toBe(404);
		expect((await request.get('/api/notes/deleted', { headers })).status()).toBe(200);
	});

	test('it makes embed links for its company only, and cannot make more keys', async ({
		request
	}) => {
		const headers = { 'X-API-Key': key };
		const viewer = { viewer: { id: 'u1', name: 'Priya Shah' } };
		expect(
			(await request.post('/api/notes/e2e-embed/embed', { data: viewer, headers })).status()
		).toBe(200);
		expect(
			(await request.post('/api/notes/e2e-private/embed', { data: viewer, headers })).status()
		).toBe(404);
		expect((await request.post('/api/orgs/e2e-co/keys', { data: {}, headers })).status()).toBe(403);
	});

	test('a note it creates is filed under its company; naming another is refused', async ({
		request
	}) => {
		const headers = { 'X-API-Key': key };
		const made = await request.post('/api/notes', {
			data: {
				title: 'From the reports app',
				content: '# Q4 report\n\nBody.',
				file_extension: 'md'
			},
			headers
		});
		expect(made.status(), await made.text()).toBe(201);
		const note = await made.json();
		expect(note.orgId).toBe('e2e-org');
		const refused = await request.post('/api/notes', {
			data: {
				title: 'Elsewhere',
				content: '---\nmdpubs-company: personal\n---\n\nBody.',
				file_extension: 'md'
			},
			headers
		});
		expect(refused.status()).toBe(403);
		await db.execute({ sql: `delete from notes where public_id = ?`, args: [note.publicId] });
	});
});

test.describe('bad input', () => {
	const anchor = { v: 1, kind: 'block', tag: 'p', index: 1, text: 'x' };
	const post = (request: APIRequestContext, data: Row) =>
		request.post('/api/notes/e2e-public/comments', { data });

	test('is refused', async ({ request }) => {
		expect((await post(request, { body: '   ', name: 'A', anchor })).status()).toBe(400);
		expect((await post(request, { body: 'x', name: '  ', anchor })).status()).toBe(400);
		expect((await post(request, { body: 'x', name: 'A' })).status()).toBe(400);
		expect(
			(
				await post(request, { body: 'x', name: 'A', anchor: { kind: 'text', tag: 'p', index: 0 } })
			).status()
		).toBe(400);
		expect((await post(request, { body: 'x'.repeat(4001), name: 'A', anchor })).status()).toBe(400);
		expect((await post(request, { body: 'x', name: 'A'.repeat(61), anchor })).status()).toBe(400);
		expect(
			(await post(request, { body: 'x', name: 'A', anchor, website: 'http://spam.test' })).status()
		).toBe(400);
		expect((await post(request, { body: 'x', name: 'A', parentId: 'nope' })).status()).toBe(404);
		expect(
			(
				await request.post('/api/notes/e2e-public/comments', {
					data: 'not json',
					headers: { 'content-type': 'text/plain' }
				})
			).status()
		).toBeGreaterThanOrEqual(400);
		expect((await request.get('/api/notes/does-not-exist/comments')).status()).toBe(404);
		expect(await comments('e2e-public')).toHaveLength(0);
	});

	test('a comment is shown as text, never as HTML', async ({ page, request }) => {
		await seedComment(
			request,
			'e2e-public',
			'Payment is due',
			'<img src=x onerror="window.__xss=1"><b>bold</b>',
			{
				name: '<script>window.__xss=1</script>'
			}
		);
		await open(page, 'e2e-public');
		await expect(page.locator('.mc-note')).toContainText('<b>bold</b>');
		await expect(page.locator('.mc-note b')).toHaveCount(0);
		expect(
			await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)
		).toBeUndefined();
	});

	test('one address cannot flood a note', async ({ request }) => {
		const statuses: number[] = [];
		for (let i = 0; i < 14; i++) {
			const res = await request.post('/api/notes/e2e-public/comments', {
				headers: { 'cf-connecting-ip': '203.0.113.9' },
				data: { body: `flood ${i}`, name: 'A', anchor }
			});
			statuses.push(res.status());
		}
		expect(statuses.slice(0, 12).every((s) => s === 201)).toBe(true);
		expect(statuses.slice(12)).toEqual([429, 429]);
	});
});

test.describe('phone', () => {
	test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

	test('tap a line, open the sheet, comment; no sideways scroll', async ({ page, request }) => {
		await seedComment(request, 'e2e-mobile', 'Payment is due', 'already here');
		await open(page, 'e2e-mobile');
		// No margin on a phone: brackets only, in the gutter.
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		await expect(page.locator('.mc-note')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			390
		);

		// A tap alone opens nothing but a button.
		await para(page, 'Payment is due').tap();
		await expect(page.locator('.mc-sheet')).toHaveCount(0);
		const pill = page.locator('.mc-pill-fixed');
		await expect(pill).toHaveText('1 comment');
		await pill.tap();
		const sheet = page.locator('.mc-sheet');
		await expect(sheet).toContainText('already here');
		// Same as the desktop pane: a conversation with initials, the page tinted, the paragraph bright
		// and moved up clear of the sheet.
		await expect(sheet.locator('.mc-turn .mc-avatar')).toHaveText('M');
		await expect(sheet).not.toContainText('Payment is due within fourteen');
		await expect(page.locator('.mc-spot')).toBeVisible();
		await expect
			.poll(async () => {
				const lit = (await para(page, 'Payment is due').boundingBox())!;
				const top = (await sheet.boundingBox())!.y;
				return lit.y >= 0 && lit.y + lit.height <= top;
			})
			.toBe(true);
		await sheet.getByPlaceholder('Your name').fill('Sam Ortiz');
		await sheet.locator('textarea').fill('from my phone');
		await sheet.getByRole('button', { name: 'Comment' }).tap();
		await expect(sheet).toHaveCount(0);

		await para(page, 'Work starts on').tap();
		await expect(pill).toHaveText('Comment on this line');
		await para(page, 'Payment is due').tap();
		await expect(pill).toHaveText('2 comments');
		await pill.tap();
		await expect(sheet).toContainText('from my phone');
		// The backdrop closes it.
		await page.locator('.mc-backdrop').tap({ position: { x: 20, y: 20 } });
		await expect(sheet).toHaveCount(0);

		// No hover on a phone: the ⋯ button opens the settings, and a tap elsewhere closes them.
		// No hover on a phone: a tap on the comments button opens the settings instead of toggling.
		await page.locator('.mc-toggle-btn').tap();
		await expect(page.locator('.mc-mark')).toHaveCount(1);
		const menu = page.locator('.mc-menu');
		await expect(menu).toBeVisible();
		const m = (await menu.boundingBox())!;
		expect(m.x).toBeGreaterThanOrEqual(0);
		expect(m.x + m.width).toBeLessThanOrEqual(390);
		expect(m.y).toBeGreaterThanOrEqual(0);
		await menu.getByRole('button', { name: 'Plain' }).tap();
		await para(page, 'We will build').tap();
		await expect(menu).toHaveCount(0);

		// The switch inside the menu is how comments are hidden on a phone.
		await page.locator('.mc-toggle-btn').tap();
		await page.getByRole('switch', { name: 'Show comments' }).tap();
		await expect(page.locator('.mc-mark')).toHaveCount(0);
		await page.getByRole('switch', { name: 'Show comments' }).tap();
		await expect(page.locator('.mc-mark')).toHaveCount(1); // both comments are on one paragraph
		await para(page, 'We will build').tap();

		// Tapping a bracket opens that line's comments straight away.
		await para(page, 'Payment is due').scrollIntoViewIfNeeded();
		await page.locator('.mc-mark-hit').first().tap();
		await expect(sheet).toContainText('from my phone');
		await page.locator('.mc-backdrop').tap({ position: { x: 20, y: 20 } });

		// The toggle sits bottom-left, clear of the title.
		const toggle = (await page.locator('.mc-toggle-btn').boundingBox())!;
		expect(toggle.y).toBeGreaterThan(600);
		expect(toggle.x).toBeLessThan(100);
	});

	test('select text on a phone', async ({ page }) => {
		await open(page, 'e2e-mobile');
		await selectText(page, para(page, 'We will build'), 'billing page');
		const pill = page.locator('.mc-pill-fixed');
		await expect(pill).toHaveText('Comment on selection');
		await pill.tap();
		const sheet = page.locator('.mc-sheet');
		await sheet.getByPlaceholder('Your name').fill('Sam Ortiz');
		await sheet.locator('textarea').fill('quoted on mobile');
		await sheet.getByRole('button', { name: 'Comment' }).tap();
		await expect(sheet).toHaveCount(0);
		await expect(page.locator('.mc-highlight')).toHaveCount(1);
		expect(((await comments('e2e-mobile'))[0].anchor as Row).quote).toBe('billing page');
	});
});

/** Open the history panel. Retries, because a click can land before the page is interactive. */
async function openHistory(page: Page, tap = false) {
	const panel = page.locator('.hp-panel');
	const button = page.getByRole('button', { name: /History/ });
	await expect(async () => {
		if (!(await panel.count())) await (tap ? button.tap() : button.click());
		await expect(panel).toBeVisible({ timeout: 1000 });
	}).toPass();
	return panel;
}

test.describe('history', () => {
	const v1 = NOTES['e2e-history'].content;
	const v2 = v1
		.replace('fourteen days of each invoice being issued', 'thirty days of every invoice')
		.replace('- Handover and training\n', '- Handover and training\n- Thirty days of support\n');
	const v3 = v2
		.replace('| Design | 40 | $4,000 |\n', '')
		.replace('about ten weeks from start', 'about twelve weeks from start');
	const only = (c: string) => c.replace('mdpubs-comments: public\n', '');

	test('the whole document: each version says in plain words what changed', async ({ page }) => {
		await setHistory('e2e-history-only', [v1, v2, v3].map(only));
		await page.goto('/e2e-history-only');
		await expect(page.locator('.mc-root')).toHaveCount(0);
		const panel = await openHistory(page);
		await expect(panel.locator('.hp-version')).toHaveCount(3);

		// Newest first, and the newest is open.
		const heads = panel.locator('.hp-version-head');
		await expect(heads.nth(0)).toContainText('current');
		await expect(heads.nth(0)).toContainText('1 reworded · 1 removed');
		await expect(heads.nth(1)).toContainText('1 reworded · 1 added');
		await expect(heads.nth(2)).toContainText('First published');
		const newest = panel.locator('.hp-version').nth(0);
		await expect(newest.locator('.hp-card')).toHaveCount(2);
		await expect(newest.locator('.hp-changed')).toContainText('Reworded paragraph in “Timeline”');
		await expect(newest.locator('.hp-changed ins')).toHaveText('twelve');
		await expect(newest.locator('.hp-changed del')).toHaveText('ten');
		await expect(newest.locator('.hp-removed')).toContainText('Removed table row');
		await expect(newest.locator('.hp-removed del')).toContainText('Design');
		// No developer notation anywhere.
		await expect(panel).not.toContainText('@@');
		await expect(panel).not.toContainText('+++');

		// An older version opens on request.
		await heads.nth(1).click();
		const older = panel.locator('.hp-version').nth(1);
		await expect(older.locator('.hp-added ins')).toHaveText('Thirty days of support');
		await expect(older.locator('.hp-changed ins').first()).toContainText('thirty');

		// A change leads to its place in the page.
		await page.evaluate(() => window.scrollTo(0, 0));
		await newest.locator('.hp-changed').click();
		await expect(para(page, 'Work starts on')).toBeInViewport();
		await expect(page.locator('[data-history-lit]')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0);
	});

	test('saves that changed only settings are counted, not listed', async ({ page }) => {
		// v3 saved three more times with nothing but frontmatter and tags touched.
		const settings = (extra: string) => v3.replace('title: Proposal', `title: Proposal\n${extra}`);
		await setHistory('e2e-history', [
			v1,
			v2,
			v3,
			settings('mdpubs-is-private: true'),
			settings('mdpubs-is-private: true\nmdpubs-tags:\n  - a'),
			settings('mdpubs-is-private: true\nmdpubs-tags:\n  - a\n  - b')
		]);
		await page.goto('/e2e-history');
		const panel = await openHistory(page);
		await expect(panel.locator('.hp-version')).toHaveCount(3);
		await expect(panel).not.toContainText('No changes to the text');
		await expect(panel).toContainText('3 other saves changed only settings, not the text.');
		// The newest save that changed the text is the one marked current and opened.
		await expect(panel.locator('.hp-version').first()).toContainText('current');
		await expect(panel.locator('.hp-version-head').first()).toHaveAttribute(
			'aria-expanded',
			'true'
		);
	});

	test('one paragraph, or a whole section, followed back through the versions', async ({
		page
	}) => {
		await setHistory('e2e-history-only', [v1, v2, v3].map(only));
		await page.goto('/e2e-history-only');
		const panel = await openHistory(page);
		await panel.getByRole('tab', { name: 'One paragraph' }).click();
		await expect(panel).toContainText('Click any paragraph');

		await para(page, 'Payment is due').click();
		// The same dim as an open comment thread: the page tinted, this paragraph bright.
		const litBox = async () => (await page.locator('[data-history-lit]').boundingBox())!;
		const covers = async (block: Locator) => {
			const a = await litBox();
			const b = (await block.boundingBox())!;
			return a.y <= b.y && a.y + a.height >= b.y + b.height && a.height < b.height + 40;
		};
		await expect.poll(() => covers(para(page, 'Payment is due'))).toBe(true);
		await expect(panel).toContainText('This paragraph changed 1 time');
		const steps = panel.locator('.hp-step');
		await expect(steps).toHaveCount(2);
		await expect(steps.nth(0)).toContainText('reworded');
		await expect(steps.nth(0).locator('ins').first()).toContainText('thirty');
		await expect(steps.nth(1)).toContainText('first written');
		await expect(steps.nth(1)).toContainText('fourteen days of each invoice being issued');

		// A paragraph nobody touched.
		await para(page, 'We will build').click();
		await expect(panel).toContainText('This paragraph changed 0 times');
		await expect.poll(() => covers(para(page, 'We will build'))).toBe(true);

		// A heading follows everything under it.
		await page.locator('article h2', { hasText: 'Timeline' }).click();
		await expect(panel).toContainText('This section changed 1 time');
		await expect(panel.locator('.hp-step').nth(0).locator('ins')).toHaveText('twelve');

		// A table row.
		await page.locator('article tr', { hasText: 'Build' }).click();
		await expect(panel).toContainText('This paragraph changed 0 times');

		await panel.getByRole('button', { name: 'Close history' }).click();
		await expect(page.locator('[data-history-lit]')).toHaveCount(0);
	});

	test('hovering the history button names it at once and leaves the comments menu shut', async ({
		page
	}) => {
		await page.goto('/e2e-history');
		await expect(page.locator('.mc-layer')).toBeAttached();
		const button = page.getByRole('button', { name: /History/ });
		await button.hover();
		expect(
			await button.evaluate((el) => getComputedStyle(el, '::after').content.replace(/"/g, ''))
		).toBe('History: see what changed');
		await page.waitForTimeout(300);
		await expect(page.locator('.mc-menu')).toHaveCount(0);
		// The comments button still opens its own menu, which says what it is.
		await page.locator('.mc-toggle-btn').hover();
		await expect(page.locator('.mc-menu')).toContainText('Comments');
	});

	test('with comments on: the button joins the comments bar and picking does not start a comment', async ({
		page
	}) => {
		await setHistory('e2e-history', [v1, v2]);
		await open(page, 'e2e-history');
		await expect(page.locator('.mc-toggle').getByRole('button', { name: /History/ })).toBeVisible();
		const panel = await openHistory(page);
		await para(page, 'Payment is due').click();
		await expect(page.locator('.hp-step')).toHaveCount(2);
		await expect(page.locator('.mc-composer')).toHaveCount(0);

		await panel.getByRole('button', { name: 'Close history' }).click();
		await expect(panel).toHaveCount(0);
		await clickBeside(page, para(page, 'Payment is due'));
		await expect(composer(page)).toBeVisible();
	});

	test('without mdpubs-history: public only the owner gets the button', async ({ page }) => {
		await setHistory(
			'e2e-public',
			[v1, v2].map((c) => c.replace('mdpubs-history: public\n', ''))
		);
		await open(page, 'e2e-public');
		await expect(page.getByRole('button', { name: /History/ })).toHaveCount(0);
		await loginAs(page, OWNER);
		await open(page, 'e2e-public');
		await expect(page.getByRole('button', { name: /History/ })).toBeVisible();
	});

	test.describe('on a phone', () => {
		test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

		test('the panel takes the bottom of the screen and the page above stays tappable', async ({
			page
		}) => {
			await setHistory('e2e-history-only', [v1, v2, v3].map(only));
			await page.goto('/e2e-history-only');
			const panel = await openHistory(page, true);
			const box = (await panel.boundingBox())!;
			expect(box.width).toBe(390);
			expect(box.y).toBeGreaterThan(250);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				390
			);

			await para(page, 'Payment is due').scrollIntoViewIfNeeded();
			await page.evaluate(() => window.scrollBy(0, 200));
			await para(page, 'Payment is due').tap();
			await expect(panel).toContainText('This paragraph changed 1 time');
		});
	});
});
