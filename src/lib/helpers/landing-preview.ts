/**
 * Pure parsing behind the landing page's live playground.
 *
 * The playground renders whatever the visitor types into a phone-sized preview,
 * so it has to answer the same two questions the real published page answers:
 * which headings become the table of contents, and where the signing boxes go.
 *
 * Signing anchors are NOT re-parsed here — `parseSignAnchors` in
 * custom-components-parser.ts already turns `<!-- mdpubs-sign-here: Label -->`
 * into a placeholder div, and the playground mounts into those same divs the way
 * the public note view does. This file only adds what the playground needs on
 * top: the anchor labels in document order (so the drawer knows which slot a tap
 * belongs to), and a TOC built from the rendered headings.
 */

export type PreviewTocItem = { id: string; text: string; level: number };

/**
 * Slug a heading the way github-slugger does for the common case: lowercase,
 * strip anything that is not a word character, space or hyphen, spaces to
 * hyphens. Duplicates get a `-1`, `-2` suffix so every TOC link is unique.
 *
 * lean: a trimmed-down slugger for preview text only. The published page uses
 * github-slugger server-side; if the preview ever needs to deep-link into a real
 * note, swap this for that package instead of widening the regex.
 */
export function slugify(text: string, seen?: Map<string, number>): string {
	const base =
		text
			.trim()
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '') || 'section';
	if (!seen) return base;
	const n = seen.get(base) ?? 0;
	seen.set(base, n + 1);
	return n === 0 ? base : `${base}-${n}`;
}

/**
 * Read the signing anchor labels in document order.
 *
 * Order matters: an anchor with no label falls back to its position among the
 * anchors, which is exactly the `slotIndex` rule `resolveSignSlot` applies on a
 * real note.
 */
export function signAnchorLabels(markdown: string): string[] {
	return splitOnSignAnchors(markdown)
		.map((s) => s.label)
		.filter((l): l is string => l !== null);
}

/**
 * The stable key of each signing anchor, in document order, matching
 * `signAnchorLabels` one for one. Holding a signature against this key rather
 * than against a position is what stops it moving to another signer's box when
 * an earlier anchor is deleted.
 */
export function signAnchorKeys(markdown: string): string[] {
	return splitOnSignAnchors(markdown)
		.map((s) => s.key)
		.filter((k): k is string => k !== null);
}

export type PreviewSegment = {
	/** Markdown to render for this segment. */
	markdown: string;
	/** The anchor label that FOLLOWS this segment, or null for the last one. */
	label: string | null;
	/**
	 * Stable identity for the anchor that follows this segment, or null for the
	 * last one. See `anchorKey` for what makes it stable.
	 */
	key: string | null;
};

/**
 * Ranges of the markdown that are code, not prose: fenced blocks, indented
 * blocks and inline spans. An anchor written inside one of these is an example
 * of the syntax, not a request to sign, so it stays as text.
 *
 * Scanned line by line rather than with one regex because a fence's closing
 * marker has to match the one that opened it: a ``` block ends at ```, not at
 * the ~~~ or the longer ```` that may sit inside it.
 *
 * lean: inline-span detection pairs backticks within a single line, so a code
 * span wrapped across a newline is not covered. Documents that need that are
 * better served by running marked's lexer here instead.
 */
function codeRanges(markdown: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const lines = markdown.split('\n');
	let offset = 0;
	// The fence that opened the current block: its char (` or ~) and run length.
	let fence: { char: string; len: number; start: number } | null = null;

	for (const line of lines) {
		const lineStart = offset;
		const lineEnd = offset + line.length;
		offset = lineEnd + 1; // + the \n consumed by split

		const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (fence) {
			// Only a run of the SAME char, at least as long as the opener, closes it.
			const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
			if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
				ranges.push([fence.start, lineEnd]);
				fence = null;
			}
			continue;
		}
		if (open) {
			fence = { char: open[1][0], len: open[1].length, start: lineStart };
			continue;
		}
		// An indented code block: four spaces or a tab, and not a blank line.
		if (/^(?: {4}|\t)/.test(line) && line.trim()) {
			ranges.push([lineStart, lineEnd]);
			continue;
		}
		// Inline spans: pair up equal-length backtick runs across the line.
		const span = /(`+)(?:[^`]|(?!\1)`)*\1/g;
		let s: RegExpExecArray | null;
		while ((s = span.exec(line)) !== null) {
			ranges.push([lineStart + s.index, lineStart + s.index + s[0].length]);
		}
	}
	// An unterminated fence runs to the end of the document.
	if (fence) ranges.push([fence.start, markdown.length]);
	return ranges;
}

/**
 * Identify an anchor by its label plus which repeat of that label it is.
 *
 * Position alone is not an identity: delete the first of three anchors and the
 * third shifts from index 2 to index 1, so a signature held against index 2
 * would reappear under a different signer's name. Keying on the label means a
 * signature survives edits elsewhere in the document and disappears with its
 * own anchor. Unlabelled anchors fall back to their position among the other
 * unlabelled ones, which is the same rule `resolveSignSlot` applies.
 */
function anchorKey(label: string, seen: Map<string, number>): string {
	const base = label.trim().toLowerCase() || '#unlabelled';
	const n = seen.get(base) ?? 0;
	seen.set(base, n + 1);
	return n === 0 ? base : `${base}#${n}`;
}

/**
 * Cut the markdown at each signing anchor, so each piece can be rendered on its
 * own and the signing boxes sit between the rendered pieces.
 *
 * Splitting the markdown rather than the rendered HTML is what keeps the output
 * valid. An anchor written inside a list item renders to
 * `<ul><li>text <div data-mdpubs-sign-here=".."></div></li>…`, and cutting
 * THERE leaves `<ul><li>text` — the browser closes the tags itself and the rest
 * of the list is orphaned. Cutting the markdown gives each piece its own
 * balanced tree instead. The published page does not need this because its HTML
 * comes from the server and it mounts into the placeholder div in place.
 *
 * An anchor inside a code block is left alone: it is someone documenting the
 * syntax, so it stays in the markdown and renders as the text it is. Cutting
 * there would be worse than a spurious signing box — the split drops the anchor
 * text, so the opening fence and the closing fence land in different segments
 * and marked swallows the rest of the document into an unterminated code block.
 */
export function splitOnSignAnchors(markdown: string): PreviewSegment[] {
	const re = /<!--\s*mdpubs-sign-here:\s*(.*?)\s*-->/gi;
	const code = codeRanges(markdown);
	const inCode = (i: number) => code.some(([a, b]) => i >= a && i < b);
	const seen = new Map<string, number>();
	const segments: PreviewSegment[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(markdown)) !== null) {
		if (inCode(m.index)) continue;
		const label = m[1].trim();
		segments.push({ markdown: markdown.slice(last, m.index), label, key: anchorKey(label, seen) });
		last = m.index + m[0].length;
	}
	segments.push({ markdown: markdown.slice(last), label: null, key: null });
	return segments;
}

/**
 * Build the table of contents from rendered HTML headings.
 *
 * Reads the HTML rather than the markdown so a heading written as raw HTML, or
 * one produced by setext underlining, lands in the TOC too — the published page
 * builds its TOC from rendered headings for the same reason.
 *
 * Levels 2 and 3 only: an h1 is the document title (already shown in the phone's
 * header), and h4+ makes a phone-width list unreadable.
 */
export function previewToc(html: string): PreviewTocItem[] {
	const seen = new Map<string, number>();
	const items: PreviewTocItem[] = [];
	const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const text = stripTags(m[2]);
		if (!text) continue;
		items.push({ id: slugify(text, seen), text, level: Number(m[1]) });
	}
	return items;
}

/**
 * Give every h2/h3 the same id the TOC links to, so tapping an entry scrolls.
 * Runs the slugger in the same order as `previewToc`, so the duplicate suffixes
 * line up.
 *
 * Pass `seen` to carry the duplicate counter across several calls — the preview
 * renders the body in chunks split at the signing anchors, and a heading in the
 * second chunk still has to get the id the whole-document TOC gave it.
 */
export function addHeadingIds(html: string, seen = new Map<string, number>()): string {
	return html.replace(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (full, level, attrs, inner) => {
		const text = stripTags(inner);
		if (!text) return full;
		const id = slugify(text, seen);
		// Respect an id the author wrote by hand.
		if (/\bid\s*=/i.test(attrs)) return full;
		return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
	});
}

/** The document title: the first h1, falling back to a neutral label. */
export function previewTitle(html: string): string {
	const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
	return (m && stripTags(m[1])) || 'Untitled document';
}

function stripTags(html: string): string {
	return html
		.replace(/<[^>]*>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}
