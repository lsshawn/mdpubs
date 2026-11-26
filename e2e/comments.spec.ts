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
		await composer(page).getByRole('button', { name: 'change' }).click();
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
		await page.locator('.mc-pill-float').click();
		await expect(page.locator('.mc-highlight').first()).toBeVisible();
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
		await page.locator('.mc-pill-float').click();
		await write(page, 'these two belong together', 'Maya Lin');
		const mark = (await page.locator('.mc-mark').boundingBox())!;
		const a = (await para(page, 'We will build').boundingBox())!;
		const b = (await para(page, 'Payment is due').boundingBox())!;
		expect(mark.y).toBeLessThan(a.y + a.height);
		expect(mark.y + mark.height).toBeGreaterThan(b.y + b.height - 4);
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
		// The article gets the page back and is centred again.
		const cleanArticle = (await page.locator('article').boundingBox())!;
		expect(cleanArticle.x).toBeGreaterThan(wideArticle.x);

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
			const mark = (await page.locator('.mc-mark').boundingBox())!;
			const box = (await c.target(page).boundingBox())!;
			expect(mark.y).toBeLessThanOrEqual(box.y + box.height / 2);
			expect(mark.y + mark.height).toBeGreaterThanOrEqual(box.y + box.height / 2);
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
		const mark = (await page.locator('.mc-mark').boundingBox())!;
		const summary = (await page.locator('article details').boundingBox())!;
		expect(Math.abs(mark.y - summary.y)).toBeLessThan(12);
	});

	test('clicking a video plays it; the space beside it comments', async ({ page }) => {
		await open(page, 'e2e-elements');
		await page.locator('article video').click();
		await expect(composer(page)).toHaveCount(0);
		await clickBeside(page, page.locator('article video'));
		await expect(composer(page)).toBeVisible();
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
		await page.locator('.mc-pill-float').click();
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
		await page.getByRole('button', { name: 'Show 1 resolved' }).click();
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
		await expect(note(page, 'noted, will change')).toContainText('Dana Owner (author)');

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
