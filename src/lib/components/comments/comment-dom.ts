/**
 * The rendered article, read as the flat list of blocks that comment-anchor.ts
 * works on, plus the way back from text offsets to places on screen.
 *
 * The article's HTML is never changed: highlights and brackets are drawn in a
 * layer on top, from the rectangles this file hands out.
 */
import { buildDoc, type AnchorBlock, type AnchorDoc } from '#lib/helpers/comment-anchor.js';

/** Elements that are one "line" to comment on. */
const TEXT_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,tr,pre,dt,dd,summary,figcaption,caption';
/** Things with no text of their own. */
const MEDIA = 'img,video,audio,iframe,canvas,svg,hr,[data-component]';
/** Never commentable, and their text is not part of the document. */
const IGNORE = '[data-mdpubs-sign-here],[data-comments-ignore],script,style,.katex-mathml';
/** A child that ends a list item's own first lines. */
const NESTED = 'ul,ol,p,pre,blockquote,table,div,dl,details';
const HEADINGS = /^h[1-6]$/;

export type DomBlock = AnchorBlock & {
	el: Element;
	/** For a list item with a nested list: the block stops before this child. */
	until: Element | null;
};

export type DomIndex = {
	root: HTMLElement;
	blocks: DomBlock[];
	doc: AnchorDoc;
	byElement: Map<Element, number>;
	/** For every character of `doc.text`: the text node and offset it came from. */
	nodes: Text[];
	offsets: number[];
};

export type Box = { left: number; top: number; right: number; bottom: number };

function mediaSrc(el: Element): string | undefined {
	if (el.matches('[data-component]')) {
		return `component:${el.getAttribute('data-component')}:${el.getAttribute('data-label') ?? ''}`;
	}
	const m = el.matches('img,video,audio,iframe,source')
		? el
		: el.querySelector('img,video,audio,iframe,source');
	if (!m) return undefined;
	if (m.tagName === 'VIDEO' || m.tagName === 'AUDIO') {
		return m.getAttribute('src') || m.querySelector('source')?.getAttribute('src') || undefined;
	}
	return m.getAttribute('src') || undefined;
}

export function indexArticle(root: HTMLElement): DomIndex {
	const blocks: DomBlock[] = [];
	const nodes: Text[] = [];
	const offsets: number[] = [];
	let heading: string | undefined;

	function add(el: Element, until: Element | null, withText: boolean) {
		const tag = el.tagName.toLowerCase();
		if (HEADINGS.test(tag) && el.id) heading = el.id;

		let text = '';
		if (withText) {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			let pending: { node: Text; off: number } | null = null;
			for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
				if (until && (until === n.parentNode || until.contains(n))) break;
				if (n.parentElement?.closest(IGNORE)) continue;
				const data = n.data;
				for (let i = 0; i < data.length; i++) {
					if (/\s/.test(data[i])) {
						if (text && !pending) pending = { node: n, off: i };
						continue;
					}
					if (pending) {
						text += ' ';
						nodes.push(pending.node);
						offsets.push(pending.off);
						pending = null;
					}
					text += data[i];
					nodes.push(n);
					offsets.push(i);
				}
			}
			if (text) {
				// The space that joins this block to the next one in doc.text.
				nodes.push(nodes[nodes.length - 1]);
				offsets.push(offsets[offsets.length - 1] + 1);
			}
		}
		const block: DomBlock = { el, until, tag, text };
		const src = mediaSrc(el);
		if (src) block.src = src;
		if (heading) block.heading = heading;
		blocks.push(block);
	}

	function visit(el: Element) {
		if (el.matches(IGNORE)) return;
		if (el.matches('tr,.katex-display')) return add(el, null, true);
		if (el.matches(TEXT_BLOCKS)) {
			if (!el.querySelector(TEXT_BLOCKS)) return add(el, null, true);
			// A list item (or similar) holding more blocks. Its own first lines are
			// a block when it starts with text rather than with a nested block.
			let first: ChildNode | null = el.firstChild;
			while (first && first.nodeType === Node.TEXT_NODE && !(first as Text).data.trim()) {
				first = first.nextSibling;
			}
			const startsWithText =
				!!first && (first.nodeType === Node.TEXT_NODE || !(first as Element).matches?.(NESTED));
			let nested: Element | null = null;
			for (const child of Array.from(el.children)) {
				if (child.matches(NESTED)) {
					nested = child;
					break;
				}
			}
			if (startsWithText && nested) add(el, nested, true);
			for (const child of Array.from(el.children)) {
				if (startsWithText && nested) {
					// Skip the inline children already covered by the item's own block.
					if (
						child !== nested &&
						!(nested.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING)
					)
						continue;
				}
				visit(child);
			}
			return;
		}
		if (el.matches(MEDIA)) return add(el, null, false);
		if (!el.querySelector(`${TEXT_BLOCKS},${MEDIA}`)) {
			if (el.textContent?.trim()) add(el, null, true);
			return;
		}
		for (const child of Array.from(el.children)) visit(child);
	}

	for (const child of Array.from(root.children)) visit(child);

	const doc = buildDoc(blocks);
	const byElement = new Map<Element, number>();
	blocks.forEach((b, i) => {
		if (!byElement.has(b.el)) byElement.set(b.el, i);
	});
	return { root, blocks, doc, byElement, nodes, offsets };
}

/** A block's box on screen (viewport coordinates), or null while it is hidden. */
export function blockBox(index: DomIndex, i: number): Box | null {
	const b = index.blocks[i];
	let rect: DOMRect | null = null;

	// Inside a closed <details>: stand in with its summary line. (Chrome still
	// reports a box for the hidden content, so size alone can't tell.)
	let closed: Element | null = null;
	if (!b.el.matches('summary')) {
		for (let d = b.el.closest('details:not([open])'); d && index.root.contains(d); ) {
			closed = d;
			d = d.parentElement?.closest('details:not([open])') ?? null;
		}
	}
	if (closed) {
		rect = closed.getBoundingClientRect();
	} else if (b.until) {
		const r = document.createRange();
		r.setStart(b.el, 0);
		r.setEndBefore(b.until);
		rect = r.getBoundingClientRect();
		if (!rect.height) rect = b.el.getBoundingClientRect();
	} else {
		rect = b.el.getBoundingClientRect();
	}
	if (!rect.height && !rect.width) return null;
	return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** The block a click landed in, walking up from the clicked element. */
export function blockOfNode(index: DomIndex, node: Node | null): number | null {
	for (let n: Node | null = node; n && n !== index.root; n = n.parentNode) {
		if (n.nodeType !== Node.ELEMENT_NODE) continue;
		const i = index.byElement.get(n as Element);
		if (i !== undefined) return i;
	}
	return null;
}

/**
 * The selection as offsets into `doc.text`, trimmed of spaces. Null when it
 * holds none of the article's text.
 */
export function selectionOffsets(
	index: DomIndex,
	range: Range
): { start: number; end: number } | null {
	const { nodes, offsets, doc } = index;
	const n = nodes.length;
	if (!n || !range.intersectsNode(index.root)) return null;
	const cmp = (i: number) => range.comparePoint(nodes[i], Math.min(offsets[i], nodes[i].length));
	// First character at or after the range's start.
	let lo = 0;
	let hi = n;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cmp(mid) < 0) lo = mid + 1;
		else hi = mid;
	}
	let start = lo;
	// First character starting after the range's end.
	hi = n;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cmp(mid) <= 0) lo = mid + 1;
		else hi = mid;
	}
	let end = lo;
	// A character that only starts at the range's end is not selected.
	if (
		end > start &&
		range.comparePoint(nodes[end - 1], Math.min(offsets[end - 1] + 1, nodes[end - 1].length)) > 0
	) {
		end--;
	}
	while (start < end && doc.text[start] === ' ') start++;
	while (end > start && doc.text[end - 1] === ' ') end--;
	return end > start ? { start, end } : null;
}

/** One box per line of text for `doc.text[start, end)`, in viewport coordinates. */
export function textBoxes(index: DomIndex, start: number, end: number): Box[] {
	const { nodes, offsets } = index;
	const raw: Box[] = [];
	const range = document.createRange();
	let i = start;
	while (i < end && i < nodes.length) {
		const node = nodes[i];
		const from = offsets[i];
		let to = from;
		while (i < end && nodes[i] === node) {
			to = offsets[i];
			i++;
		}
		if (!node.isConnected) continue;
		try {
			range.setStart(node, Math.min(from, node.length));
			range.setEnd(node, Math.min(to + 1, node.length));
		} catch {
			continue;
		}
		for (const r of Array.from(range.getClientRects())) {
			if (r.width < 0.5 || r.height < 0.5) continue;
			raw.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
		}
	}
	// Join the pieces that share a line.
	raw.sort((a, b) => a.top - b.top || a.left - b.left);
	const lines: Box[] = [];
	for (const r of raw) {
		const last = lines[lines.length - 1];
		if (last) {
			const overlap = Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top);
			const shorter = Math.min(last.bottom - last.top, r.bottom - r.top);
			if (overlap > shorter * 0.5 && r.left <= last.right + 6) {
				last.right = Math.max(last.right, r.right);
				last.top = Math.min(last.top, r.top);
				last.bottom = Math.max(last.bottom, r.bottom);
				continue;
			}
		}
		lines.push({ ...r });
	}
	return lines;
}
