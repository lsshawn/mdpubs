import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import { parseSignAnchors } from './custom-components-parser.ts';
// `.ts` extension: under `node --test` with type stripping, Node resolves the
// specifier literally, so an extensionless import is ERR_MODULE_NOT_FOUND.
import {
	addHeadingIds,
	previewToc,
	previewTitle,
	signAnchorLabels,
	slugify,
	splitOnSignAnchors
} from './landing-preview.ts';

// Synthetic markdown/HTML only; no database access.

test('sign anchors are read in document order, labels trimmed', () => {
	const md = [
		'# Proposal',
		'<!-- mdpubs-sign-here:  Client Name  -->',
		'text',
		'<!-- mdpubs-sign-here: Studio -->'
	].join('\n');
	assert.deepEqual(signAnchorLabels(md), ['Client Name', 'Studio']);
});

test('an anchor with no label keeps its slot so position still resolves it', () => {
	const md = '<!-- mdpubs-sign-here: -->\n<!-- mdpubs-sign-here: Client -->';
	assert.deepEqual(signAnchorLabels(md), ['', 'Client']);
});

test('a document with no anchors has no signing boxes', () => {
	assert.deepEqual(signAnchorLabels('# Just a note\n\nNo signing here.'), []);
});

test('the TOC takes h2 and h3, skipping the h1 title and h4', () => {
	const html = '<h1>Title</h1><h2>Scope</h2><h3>Phase one</h3><h4>Detail</h4><h2>Price</h2>';
	assert.deepEqual(
		previewToc(html).map((i) => [i.level, i.text, i.id]),
		[
			[2, 'Scope', 'scope'],
			[3, 'Phase one', 'phase-one'],
			[2, 'Price', 'price']
		]
	);
});

test('inline markup inside a heading is stripped from the TOC text', () => {
	const html = '<h2>Scope &amp; <em>price</em></h2>';
	assert.deepEqual(previewToc(html), [{ id: 'scope-price', text: 'Scope & price', level: 2 }]);
});

test('repeated headings get unique ids so every TOC link lands somewhere', () => {
	const html = '<h2>Notes</h2><h2>Notes</h2><h2>Notes</h2>';
	assert.deepEqual(
		previewToc(html).map((i) => i.id),
		['notes', 'notes-1', 'notes-2']
	);
});

test('heading ids match the TOC ids, duplicates included', () => {
	const html = '<h2>Notes</h2><h2>Notes</h2>';
	const out = addHeadingIds(html);
	for (const item of previewToc(html)) assert.ok(out.includes(`id="${item.id}"`));
});

test('a hand-written heading id is left alone', () => {
	const html = '<h2 id="mine">Scope</h2>';
	assert.equal(addHeadingIds(html), html);
});

test('the title comes from the first h1', () => {
	assert.equal(previewTitle('<h1>Website Build</h1><h1>Second</h1>'), 'Website Build');
	assert.equal(previewTitle('<h2>No title here</h2>'), 'Untitled document');
});

test('a heading of only punctuation still slugs to something linkable', () => {
	assert.equal(slugify('***'), 'section');
});

test('splitting yields one more segment than anchors, last one unlabelled', () => {
	const segs = splitOnSignAnchors(
		'a<!-- mdpubs-sign-here: One -->b<!-- mdpubs-sign-here: Two -->c'
	);
	assert.deepEqual(segs, [
		{ markdown: 'a', label: 'One' },
		{ markdown: 'b', label: 'Two' },
		{ markdown: 'c', label: null }
	]);
});

test('markdown with no anchor is one whole segment', () => {
	assert.deepEqual(splitOnSignAnchors('# Just text'), [{ markdown: '# Just text', label: null }]);
});

/*
	The reason the split happens on markdown and not on rendered HTML: an anchor
	inside a list item renders to `<ul><li>text <div …></div></li>…`. Cutting the
	HTML there leaves `<ul><li>text` — the browser closes those tags itself and the
	remaining `</li><li>item two</li></ul>` is orphaned, so the list falls apart.
	Each markdown slice renders to its own balanced tree instead.
*/
test('an anchor inside a list leaves each rendered segment balanced', () => {
	const md = '- item one <!-- mdpubs-sign-here: A -->\n- item two\n';
	const segs = splitOnSignAnchors(md);
	assert.equal(segs.length, 2);
	for (const s of segs) {
		const html = marked.parse(s.markdown, { async: false, gfm: true }) as string;
		for (const tag of ['ul', 'li']) {
			assert.equal(
				(html.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length,
				(html.match(new RegExp(`</${tag}>`, 'g')) || []).length,
				`<${tag}> unbalanced in: ${html}`
			);
		}
	}

	// And the old approach — splitting the RENDERED html — does not survive it.
	const whole = marked.parse(md, { async: false, gfm: true }) as string;
	const bad = parseSignAnchors(whole).split(/<div data-mdpubs-sign-here="[^"]*"><\/div>/)[0];
	assert.ok(bad.includes('<ul>') && !bad.includes('</ul>'));
});

test('heading ids carry across segments so a TOC link still resolves', () => {
	// `seen` shared across calls: the second segment's duplicate heading must get
	// the `-1` suffix the whole-document TOC gave it.
	const seen = new Map<string, number>();
	const first = addHeadingIds('<h2>Notes</h2>', seen);
	const second = addHeadingIds('<h2>Notes</h2>', seen);
	assert.ok(first.includes('id="notes"'));
	assert.ok(second.includes('id="notes-1"'));
	assert.deepEqual(
		previewToc('<h2>Notes</h2><h2>Notes</h2>').map((i) => i.id),
		['notes', 'notes-1']
	);
});
