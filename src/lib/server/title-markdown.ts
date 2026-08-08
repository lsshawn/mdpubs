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
