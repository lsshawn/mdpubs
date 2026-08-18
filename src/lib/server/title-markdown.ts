import { marked } from 'marked';

/**
 * Render a note title's inline markdown to a small, fixed set of safe tags.
 *
 * Titles come from author-controlled `title:` frontmatter, so the output is
 * injected with {@html} in the notes list. That makes this a security boundary,
 * not a formatting nicety: everything here exists to guarantee the result can
 * only ever contain the four inline tags below.
 *
 * Inline-only by design. A title is a single line, so block constructs
 * (headings, lists, paragraphs) are meaningless, and the <p> wrapper marked
 * would emit for a block parse breaks the `truncate` layout in the list.
 */

/** Emphasis and code only — no links, no images, no attributes anywhere. */
const ALLOWED_TAGS = ['em', 'strong', 'code', 'del'];

/**
 * Drop every tag that isn't on the allowlist, keeping its text content.
 *
 * Runs on marked's *output*, so it is the last word on what survives: raw HTML
 * the author typed into the title (marked passes such tags through untouched)
 * is stripped here. Allowed tags are re-emitted bare, which discards any
 * attribute — so an `onerror=` or `href=javascript:` has nothing to ride on.
 * Comments and bracketed constructs like `<!-- -->` are removed by the same
 * pass since they match the tag pattern and are not on the allowlist.
 */
function stripToAllowlist(html: string): string {
	return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>|<!--[\s\S]*?-->/g, (tag, name) => {
		if (!name) return ''; // an HTML comment
		const lower = String(name).toLowerCase();
		if (!ALLOWED_TAGS.includes(lower)) return '';
		return tag.startsWith('</') ? `</${lower}>` : `<${lower}>`;
	});
}

/**
 * Convert a raw title to HTML safe for {@html}.
 *
 * Returns '' for an empty/missing title so callers can fall back to 'Untitled'
 * without having to distinguish null from whitespace.
 */
export function renderTitleMarkdown(title: string | null | undefined): string {
	const raw = (title ?? '').trim();
	if (raw === '') return '';

	// parseInline keeps this to spans of text — no <p>, no block tokens.
	// Entity-encoding of stray `<`, `&` etc. is marked's job; the allowlist pass
	// then removes any real tags it decided to pass through.
	const parsed = marked.parseInline(raw, { async: false, gfm: true }) as string;
	return stripToAllowlist(parsed);
}

/**
 * Wrap every occurrence of `query` in `<mark>`, case-insensitively.
 *
 * Two entry points with different inputs, hence two exports below: titles
 * arrive as already-rendered HTML, snippets as raw text.
 */

/** Escape text so it is safe to place in an HTML document as content. */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Escape a user string for literal use inside a RegExp. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mark matches in a run of plain text, escaping the text itself.
 *
 * The `<mark>` tags are the only markup this can emit: everything originating
 * from the caller's string is escaped first, so a query or body containing
 * `<script>` becomes text, not a tag.
 */
function markEscaped(text: string, pattern: RegExp): string {
	let out = '';
	let last = 0;
	pattern.lastIndex = 0;
	for (const m of text.matchAll(pattern)) {
		out += escapeHtml(text.slice(last, m.index)) + `<mark>${escapeHtml(m[0])}</mark>`;
		last = m.index + m[0].length;
	}
	return out + escapeHtml(text.slice(last));
}

/**
 * Highlight `query` inside a snippet of PLAIN TEXT, returning HTML.
 *
 * The result is injected with {@html}, so this function — not the caller — is
 * responsible for escaping. Note bodies are arbitrary author input and go
 * through no allowlist, which is exactly why every non-match run is escaped
 * here rather than trusted.
 */
export function highlightText(text: string, query: string): string {
	const needle = query.trim();
	if (!needle) return escapeHtml(text);
	return markEscaped(text, new RegExp(escapeRegExp(needle), 'gi'));
}

/**
 * Highlight `query` inside ALREADY-RENDERED title HTML from
 * renderTitleMarkdown.
 *
 * Only text nodes are considered: the input is split on tags and matching runs
 * only inside the gaps, so a query like `em` or `strong` can't corrupt the
 * markup by matching a tag name, and `<mark>` can never open inside another
 * tag's angle brackets.
 *
 * Consequence worth knowing: a match STRADDLING a formatting boundary (`Q3
 * plan` where only `Q3` is bold) is not highlighted, since neither text node
 * contains the whole query. The row still appears in the results, just without a
 * mark; stitching a highlight across the tag tree is not worth it for one line
 * of title.
 *
 * Safe to emit `<mark>` here even though it is not in ALLOWED_TAGS — that is
 * deliberate. The allowlist governs what an *author* may put in a title; these
 * tags are added afterwards, by us, so a literal `<mark>` typed into a title is
 * still stripped. Text between tags is already entity-encoded by marked, so it
 * is re-emitted as-is rather than escaped again (which would double-encode a
 * legitimate `&amp;`).
 */
export function highlightTitleHtml(html: string, query: string): string {
	const needle = query.trim();
	if (!needle) return html;
	const pattern = new RegExp(escapeRegExp(needle), 'gi');

	// Split keeping the delimiters, so odd indices are the tags themselves.
	return html
		.split(/(<[^>]*>)/)
		.map((part, i) => {
			if (i % 2 === 1) return part; // a tag — never touched
			// Match against the decoded text so a query spanning an entity (e.g. "&")
			// still hits, then re-escape only what we emit.
			return markEscaped(decodeBasicEntities(part), pattern);
		})
		.join('');
}

/**
 * Reverse the entity encoding marked applies to text, so matching happens
 * against what the reader actually sees. Only the five marked emits.
 */
function decodeBasicEntities(text: string): string {
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');
}
