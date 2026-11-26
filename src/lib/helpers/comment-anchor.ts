/**
 * Where a margin comment sits in a document, and how to find that spot again
 * after the markdown has been edited.
 *
 * The page is read as a flat list of blocks (paragraph, heading, list item,
 * table row, code block, image, video...). An anchor remembers the block it was
 * made on: its text, the blocks either side, its media URL, and for a text
 * selection the quoted words plus a little text before and after.
 *
 * Nothing here touches the DOM, so it runs under `node --test`. The page turns
 * its rendered HTML into `AnchorBlock[]` (comment-dom.ts) and calls in here.
 *
 * Finding an anchor again, in order:
 *   1. the quote, word for word, in the right surroundings
 *   2. the same block (same text, or same media URL), wherever it moved to
 *   3. a block that still reads mostly the same, then the nearest words to the
 *      quote inside it
 *   4. a block sitting between the same two neighbours (it was rewritten)
 *   5. nothing: the text was removed. The comment is kept and reported as
 *      `detached`, with a hint for where it used to be.
 */

export type CommentAnchor = {
	v: 1;
	/** `text`: a selection. `block`: a whole line/element. */
	kind: 'text' | 'block';
	/** Lower-case tag of the block: p, h2, li, tr, pre, img, video, iframe... */
	tag: string;
	/** Position among the page's blocks when the comment was made. */
	index: number;
	/** The block's text (whitespace collapsed), cut to TEXT_MAX. */
	text: string;
	/** Start of the previous / next block, to tell twins apart. */
	before?: string;
	after?: string;
	/** Media URL, for images, video and embeds. */
	src?: string;
	/** id of the nearest heading above. */
	heading?: string;
	/** The selected words (kind `text`). */
	quote?: string;
	/** Text just before / after the quote. */
	prefix?: string;
	suffix?: string;
	/**
	 * A pin stuck at one point: where it is, as fractions of the block's box
	 * (0,0 top left; 1,1 bottom right). May fall outside the box, for a point
	 * in the space around the block.
	 */
	pin?: { x: number; y: number };
};

/** How far outside its block a pin may sit, in block widths or heights. */
export const PIN_REACH = 4;

export type AnchorBlock = { tag: string; text: string; src?: string; heading?: string };

export type AnchorDoc = {
	blocks: AnchorBlock[];
	/** Every block's text joined by one space. Quote offsets index into this. */
	text: string;
	/** Offset of each block's text in `text`. */
	starts: number[];
	grams: (Map<string, number> | undefined)[];
};

export type ResolvedAnchor = {
	/**
	 * exact: found as written. changed: found, but the text around it or in it
	 * was edited. detached: the text is gone.
	 */
	status: 'exact' | 'changed' | 'detached';
	/** First and last block the comment covers. For `detached`, the nearest surviving block, or null. */
	block: number | null;
	endBlock: number | null;
	/** Quote range in `doc.text`, when a text selection could be placed. */
	start?: number;
	end?: number;
};

export const TEXT_MAX = 400;
export const QUOTE_MAX = 1000;
const CONTEXT = 32;
const NEIGHBOUR = 80;
/** Text shorter than this ("Yes", "TBD") is too common to trust on its own. */
const SHORT = 16;

export function normalizeText(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

export function buildDoc(blocks: AnchorBlock[]): AnchorDoc {
	const starts: number[] = [];
	let text = '';
	for (const b of blocks) {
		starts.push(text.length);
		if (b.text) text += b.text + ' ';
	}
	return { blocks, text, starts, grams: [] };
}

/** The block holding offset `pos` of `doc.text`. */
export function blockAt(doc: AnchorDoc, pos: number): number {
	let lo = 0;
	let hi = doc.starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (doc.starts[mid] <= pos) lo = mid;
		else hi = mid - 1;
	}
	// Several empty blocks (images) can share a start; step back to the one with text.
	while (lo > 0 && !doc.blocks[lo].text && doc.starts[lo] === doc.starts[lo - 1]) lo--;
	while (lo < doc.blocks.length - 1 && !doc.blocks[lo].text) lo++;
	return lo;
}

function key(b: AnchorBlock | undefined): string {
	if (!b) return '';
	return (b.text || b.src || '').slice(0, NEIGHBOUR);
}

/** Describe block `index`, or the selection `range` (offsets into `doc.text`) that starts in it. */
export function makeAnchor(
	doc: AnchorDoc,
	index: number,
	range?: { start: number; end: number }
): CommentAnchor {
	const b = doc.blocks[index];
	const anchor: CommentAnchor = {
		v: 1,
		kind: range ? 'text' : 'block',
		tag: b.tag,
		index,
		text: b.text.slice(0, TEXT_MAX)
	};
	const before = key(doc.blocks[index - 1]);
	const after = key(doc.blocks[index + 1]);
	if (before) anchor.before = before;
	if (after) anchor.after = after;
	if (b.src) anchor.src = b.src;
	if (b.heading) anchor.heading = b.heading;
	if (range) {
		const end = Math.min(range.end, range.start + QUOTE_MAX);
		anchor.quote = doc.text.slice(range.start, end);
		anchor.prefix = doc.text.slice(Math.max(0, range.start - CONTEXT), range.start);
		anchor.suffix = doc.text.slice(end, end + CONTEXT);
	}
	return anchor;
}

// ─── Finding it again ────────────────────────────────────────────────────────

function grams(s: string): Map<string, number> {
	const m = new Map<string, number>();
	const t = s.toLowerCase();
	for (let i = 0; i + 3 <= t.length; i++) {
		const g = t.slice(i, i + 3);
		m.set(g, (m.get(g) ?? 0) + 1);
	}
	return m;
}

/** 0..1, how much two texts share (Dice over character trigrams). */
function similarity(a: Map<string, number>, b: Map<string, number>): number {
	let na = 0;
	let nb = 0;
	let both = 0;
	for (const n of a.values()) na += n;
	for (const [g, n] of b) {
		nb += n;
		const m = a.get(g);
		if (m) both += Math.min(m, n);
	}
	return na + nb === 0 ? 0 : (2 * both) / (na + nb);
}

function blockGrams(doc: AnchorDoc, i: number): Map<string, number> {
	return (doc.grams[i] ??= grams(doc.blocks[i].text.slice(0, TEXT_MAX)));
}

/** 0, 1 or 2: how many of the anchor's neighbours still sit beside block `i`. */
function neighbours(a: CommentAnchor, doc: AnchorDoc, i: number): number {
	let n = 0;
	if (a.before && key(doc.blocks[i - 1]) === a.before) n++;
	if (a.after && key(doc.blocks[i + 1]) === a.after) n++;
	return n;
}

function pick(a: CommentAnchor, doc: AnchorDoc, candidates: number[]): number {
	let best = candidates[0];
	let bestScore = -Infinity;
	for (const i of candidates) {
		const score = neighbours(a, doc, i) * 1000 - Math.abs(i - a.index);
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	}
	return best;
}

type BlockHit = { index: number; exact: boolean } | { index: null; hint: number | null };

function findBlock(a: CommentAnchor, doc: AnchorDoc): BlockHit {
	const { blocks } = doc;

	// Same text (and same media, when it has one).
	if (a.text) {
		const same: number[] = [];
		for (let i = 0; i < blocks.length; i++) {
			if (blocks[i].text.slice(0, TEXT_MAX) === a.text && (!a.src || blocks[i].src === a.src)) {
				same.push(i);
			}
		}
		if (same.length) {
			const i = pick(a, doc, same);
			if (a.text.length >= SHORT || i === a.index || neighbours(a, doc, i) > 0) {
				return { index: i, exact: true };
			}
		}
	}

	// Same image / video / embed, whatever its caption says now.
	if (a.src) {
		const same: number[] = [];
		for (let i = 0; i < blocks.length; i++) if (blocks[i].src === a.src) same.push(i);
		if (same.length) return { index: pick(a, doc, same), exact: !a.text };
	}

	// Still reads mostly the same.
	if (a.text.length >= SHORT) {
		const mine = grams(a.text);
		let best = -1;
		let bestScore = 0;
		let bestSim = 0;
		for (let i = 0; i < blocks.length; i++) {
			if (!blocks[i].text) continue;
			const sim = similarity(mine, blockGrams(doc, i));
			if (sim < 0.3) continue;
			const score = sim + 0.08 * neighbours(a, doc, i) + (blocks[i].tag === a.tag ? 0.03 : 0);
			if (score > bestScore) {
				bestScore = score;
				bestSim = sim;
				best = i;
			}
		}
		if (best >= 0 && (bestSim >= 0.5 || neighbours(a, doc, best) > 0)) {
			return { index: best, exact: false };
		}
	}

	// Rewritten in place: a block sitting between the same two neighbours.
	let beforeAt = -1;
	if (a.before) {
		const hits: number[] = [];
		for (let i = 0; i < blocks.length; i++) if (key(blocks[i]) === a.before) hits.push(i);
		if (hits.length)
			beforeAt = pick({ ...a, before: undefined, after: undefined, index: a.index - 1 }, doc, hits);
	}
	if (beforeAt >= 0 && a.after && key(blocks[beforeAt + 2]) === a.after) {
		return { index: beforeAt + 1, exact: false };
	}
	if (!a.before && a.after && a.index === 0 && key(blocks[1]) === a.after) {
		return { index: 0, exact: false };
	}
	if (beforeAt >= 0 && !a.after && beforeAt + 1 === blocks.length - 1) {
		return { index: beforeAt + 1, exact: false };
	}

	// An image or video swapped for another file, still in front of the same block.
	if (a.src && !a.text && a.after) {
		const hits: number[] = [];
		for (let i = 1; i < blocks.length; i++) {
			if (key(blocks[i]) === a.after && blocks[i - 1].src && !blocks[i - 1].text) hits.push(i - 1);
		}
		if (hits.length) return { index: pick(a, doc, hits), exact: false };
	}

	// Gone. Say roughly where it was.
	if (beforeAt >= 0) return { index: null, hint: beforeAt };
	if (a.heading) {
		for (let i = blocks.length - 1; i >= 0; i--) {
			if (blocks[i].heading === a.heading) return { index: null, hint: i };
		}
	}
	return { index: null, hint: null };
}

/** How many characters `a` and `b` share, counted backwards from their ends. */
function commonSuffix(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

function commonPrefix(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/** The quote, word for word. Returns its offset in `doc.text`, or -1. */
function findQuoteExact(a: CommentAnchor, doc: AnchorDoc, inBlock: number | null): number {
	const quote = a.quote!;
	const prefix = a.prefix ?? '';
	const suffix = a.suffix ?? '';
	const span = prefix.length + suffix.length;

	let best = -1;
	let bestContext = -1;
	let bestInBlock = -1;
	let count = 0;
	for (let at = doc.text.indexOf(quote); at !== -1; at = doc.text.indexOf(quote, at + 1)) {
		count++;
		const context =
			commonSuffix(doc.text.slice(Math.max(0, at - CONTEXT), at), prefix) +
			commonPrefix(doc.text.slice(at + quote.length, at + quote.length + CONTEXT), suffix);
		if (context > bestContext) {
			bestContext = context;
			best = at;
		}
		if (inBlock !== null && bestInBlock === -1 && blockAt(doc, at) === inBlock) bestInBlock = at;
		if (count > 500) break;
	}
	if (best === -1) return -1;
	// Same words in the same surroundings.
	if (span === 0 || bestContext >= span / 2) return best;
	// Surroundings changed, but the quote is long enough to be the only one.
	if (count === 1 && quote.length >= 30) return best;
	// Otherwise only trust a match inside the block the comment was made on.
	return bestInBlock;
}

type Token = { word: string; start: number; end: number };

function tokens(s: string, max: number): Token[] {
	const out: Token[] = [];
	const re = /\S+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s)) !== null && out.length < max) {
		const word = m[0].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
		if (word) out.push({ word, start: m.index, end: m.index + m[0].length });
	}
	return out;
}

/**
 * The quote was edited. Find what is left of it inside block text `t`: first by
 * the text that used to sit either side, then by the longest run of its words
 * still in order. Returns offsets into `t`, or null.
 */
function findQuoteFuzzy(a: CommentAnchor, t: string): { start: number; end: number } | null {
	const quote = a.quote!;
	const longest = Math.max(quote.length * 3, quote.length + 40);

	const pre = (a.prefix ?? '').slice(-12);
	const suf = (a.suffix ?? '').slice(0, 12);
	if (pre.trim().length >= 6 && suf.trim().length >= 6) {
		const p = t.lastIndexOf(pre);
		if (p !== -1) {
			const from = p + pre.length;
			const q = t.indexOf(suf, from);
			if (q > from && q - from <= longest && t.slice(from, q).trim()) {
				return trim(t, from, q);
			}
		}
	}

	const qs = tokens(quote, 150);
	const ts = tokens(t, 800);
	if (!qs.length || !ts.length) return null;
	// Longest common subsequence of words.
	const w = ts.length + 1;
	const dp = new Uint16Array((qs.length + 1) * w);
	for (let i = qs.length - 1; i >= 0; i--) {
		for (let j = ts.length - 1; j >= 0; j--) {
			dp[i * w + j] =
				qs[i].word === ts[j].word
					? dp[(i + 1) * w + j + 1] + 1
					: Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
		}
	}
	const kept = dp[0];
	if (kept < Math.max(1, Math.ceil(qs.length / 2))) return null;
	let first = -1;
	let last = -1;
	for (let i = 0, j = 0; i < qs.length && j < ts.length; ) {
		if (qs[i].word === ts[j].word) {
			if (first === -1) first = j;
			last = j;
			i++;
			j++;
		} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
		else j++;
	}
	if (first === -1) return null;
	const start = ts[first].start;
	const end = ts[last].end;
	if (end - start > longest) return null;
	return { start, end };
}

function trim(t: string, start: number, end: number): { start: number; end: number } {
	while (start < end && t[start] === ' ') start++;
	while (end > start && t[end - 1] === ' ') end--;
	return { start, end };
}

export function resolveAnchor(a: CommentAnchor, doc: AnchorDoc): ResolvedAnchor {
	if (!doc.blocks.length) return { status: 'detached', block: null, endBlock: null };
	const hit = findBlock(a, doc);

	if (a.kind === 'text' && a.quote) {
		const at = findQuoteExact(a, doc, hit.index);
		if (at !== -1) {
			const end = at + a.quote.length;
			return {
				status: 'exact',
				block: blockAt(doc, at),
				endBlock: blockAt(doc, Math.max(at, end - 1)),
				start: at,
				end
			};
		}
		if (hit.index !== null) {
			const t = doc.blocks[hit.index].text;
			const found = findQuoteFuzzy(a, t);
			if (found) {
				const base = doc.starts[hit.index];
				return {
					status: 'changed',
					block: hit.index,
					endBlock: hit.index,
					start: base + found.start,
					end: base + found.end
				};
			}
			// The words are gone but their paragraph is still here: mark the paragraph.
			return { status: 'changed', block: hit.index, endBlock: hit.index };
		}
		return { status: 'detached', block: hit.hint, endBlock: hit.hint };
	}

	if (hit.index !== null) {
		return { status: hit.exact ? 'exact' : 'changed', block: hit.index, endBlock: hit.index };
	}
	return { status: 'detached', block: hit.hint, endBlock: hit.hint };
}

/** Cut an anchor that came over the wire down to the fields and sizes we store. */
export function cleanAnchor(input: unknown): CommentAnchor | null {
	if (!input || typeof input !== 'object') return null;
	const a = input as Record<string, unknown>;
	const str = (v: unknown, max: number) =>
		typeof v === 'string' && v ? v.slice(0, max) : undefined;
	if (a.kind !== 'text' && a.kind !== 'block') return null;
	if (typeof a.index !== 'number' || !Number.isInteger(a.index) || a.index < 0) return null;
	const tag = str(a.tag, 20);
	if (!tag) return null;
	const out: CommentAnchor = {
		v: 1,
		kind: a.kind,
		tag,
		index: a.index,
		text: typeof a.text === 'string' ? a.text.slice(0, TEXT_MAX) : ''
	};
	const before = str(a.before, NEIGHBOUR);
	const after = str(a.after, NEIGHBOUR);
	const src = str(a.src, 2000);
	const heading = str(a.heading, 200);
	if (before) out.before = before;
	if (after) out.after = after;
	if (src) out.src = src;
	if (heading) out.heading = heading;
	const pin = a.pin as { x?: unknown; y?: unknown } | undefined;
	if (
		a.kind === 'block' &&
		pin &&
		typeof pin === 'object' &&
		typeof pin.x === 'number' &&
		typeof pin.y === 'number' &&
		Number.isFinite(pin.x) &&
		Number.isFinite(pin.y)
	) {
		const fit = (n: number) =>
			Math.round(Math.min(1 + PIN_REACH, Math.max(-PIN_REACH, n)) * 10000) / 10000;
		out.pin = { x: fit(pin.x), y: fit(pin.y) };
	}
	if (a.kind === 'text') {
		const quote = str(a.quote, QUOTE_MAX);
		if (!quote) return null;
		out.quote = quote;
		out.prefix = typeof a.prefix === 'string' ? a.prefix.slice(-CONTEXT) : '';
		out.suffix = typeof a.suffix === 'string' ? a.suffix.slice(0, CONTEXT) : '';
	}
	return out;
}
