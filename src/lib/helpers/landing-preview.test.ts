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
	signAnchorKeys,
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
		{ markdown: 'a', label: 'One', key: 'one' },
		{ markdown: 'b', label: 'Two', key: 'two' },
		{ markdown: 'c', label: null, key: null }
	]);
});

test('markdown with no anchor is one whole segment', () => {
	assert.deepEqual(splitOnSignAnchors('# Just text'), [
		{ markdown: '# Just text', label: null, key: null }
	]);
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

/*
	Bug: writing the anchor inside a code block — documenting the syntax — put a
	real signing box on the page AND deleted the rest of the document. The split
	drops the anchor text, so the opening ``` and the closing ``` ended up in
	different segments and marked swallowed everything after it into an
	unterminated code block.
*/
test('an anchor inside a fenced code block is an example, not a signing box', () => {
	const md = [
		'# Doc',
		'',
		'To make it signable, write:',
		'',
		'```markdown',
		'<!-- mdpubs-sign-here: Client Name -->',
		'```',
		'',
		'## After the code block',
		'',
		'This paragraph must survive.'
	].join('\n');

	assert.deepEqual(signAnchorLabels(md), []);
	const segs = splitOnSignAnchors(md);
	assert.equal(segs.length, 1, 'the document is not cut at an anchor inside code');

	// The whole document still renders: nothing after the fence is lost.
	const html = marked.parse(segs[0].markdown, { async: false, gfm: true }) as string;
	assert.ok(html.includes('After the code block'), `heading lost: ${html}`);
	assert.ok(html.includes('This paragraph must survive.'), `paragraph lost: ${html}`);
	// And the anchor shows as the text it is, inside a code block.
	assert.ok(html.includes('<code'), 'the fence still renders as code');
});

test('tilde fences and indented code hide an anchor too', () => {
	const tilde = ['~~~', '<!-- mdpubs-sign-here: A -->', '~~~'].join('\n');
	assert.deepEqual(signAnchorLabels(tilde), []);

	const indented = ['text', '', '    <!-- mdpubs-sign-here: A -->', '', 'more'].join('\n');
	assert.deepEqual(signAnchorLabels(indented), []);
});

test('an anchor in an inline code span is an example, not a signing box', () => {
	const md = 'Write `<!-- mdpubs-sign-here: Client -->` where the signature goes.';
	assert.deepEqual(signAnchorLabels(md), []);
	assert.equal(splitOnSignAnchors(md).length, 1);
});

test('a fence inside a longer fence does not end the block early', () => {
	// The inner ``` is content of the ```` block, so the anchor stays hidden.
	const md = ['````markdown', '```', '<!-- mdpubs-sign-here: A -->', '```', '````'].join('\n');
	assert.deepEqual(signAnchorLabels(md), []);
});

test('a real anchor outside the code block still signs', () => {
	const md = [
		'```',
		'<!-- mdpubs-sign-here: Example -->',
		'```',
		'',
		'<!-- mdpubs-sign-here: Client Name -->'
	].join('\n');
	assert.deepEqual(signAnchorLabels(md), ['Client Name']);
	assert.equal(splitOnSignAnchors(md).length, 2);
});

/*
	Bug: delete an anchor after drawing a signature and the drawing hopped onto the
	next signer's box, under their name — the signature was held against the
	anchor's POSITION, and deleting an earlier anchor shifted every later one down
	an index. Keys are stable per label instead, so a signature either stays with
	its own anchor or goes away with it.
*/
test('deleting an anchor does not move a signature onto another signer', () => {
	const before = '<!-- mdpubs-sign-here: Alice -->\ntext\n<!-- mdpubs-sign-here: Bob -->';
	const after = 'text\n<!-- mdpubs-sign-here: Bob -->'; // Alice deleted

	const keysBefore = signAnchorKeys(before);
	const keysAfter = signAnchorKeys(after);
	assert.deepEqual(keysBefore, ['alice', 'bob']);

	// A signature drawn for Bob is still Bob's, at a different position.
	const signatures: Record<string, string> = { [keysBefore[1]]: 'Bob drawing' };
	assert.equal(keysAfter.indexOf('bob'), 0, 'Bob moved from index 1 to index 0');
	assert.equal(signatures[keysAfter[0]], 'Bob drawing', "Bob's box keeps Bob's signature");

	// Alice's key is gone, so her box is empty rather than showing a stray drawing.
	assert.ok(!keysAfter.includes('alice'));
});

test("a deleted anchor's signature is dropped, not left for the next anchor", () => {
	const before = '<!-- mdpubs-sign-here: Alice -->\n<!-- mdpubs-sign-here: Bob -->';
	const after = '<!-- mdpubs-sign-here: Bob -->'; // Alice deleted

	// Alice signs, keyed the way the playground keys it.
	const signatures: Record<string, string> = { [signAnchorKeys(before)[0]]: 'Alice drawing' };
	const live = new Set(signAnchorKeys(after));
	for (const k of Object.keys(signatures)) if (!live.has(k)) delete signatures[k];

	assert.deepEqual(signatures, {}, "Alice's signature does not survive her anchor");
	assert.equal(signatures[signAnchorKeys(after)[0]], undefined, "Bob's box is unsigned");
});

test('repeated labels get distinct keys so two boxes never share a signature', () => {
	const md = [
		'<!-- mdpubs-sign-here: Witness -->',
		'<!-- mdpubs-sign-here: Witness -->',
		'<!-- mdpubs-sign-here: -->',
		'<!-- mdpubs-sign-here: -->'
	].join('\n');
	const keys = signAnchorKeys(md);
	assert.equal(new Set(keys).size, keys.length, `keys not unique: ${keys.join()}`);
	assert.deepEqual(keys, ['witness', 'witness#1', '#unlabelled', '#unlabelled#1']);
});

test('a key ignores case and surrounding space, so retyping a label keeps the signature', () => {
	assert.deepEqual(signAnchorKeys('<!-- mdpubs-sign-here:  Client Name  -->'), ['client name']);
	assert.deepEqual(signAnchorKeys('<!-- mdpubs-sign-here: CLIENT NAME -->'), ['client name']);
});

test('editing text around an anchor leaves its signature in place', () => {
	const before = '# Old title\n\n<!-- mdpubs-sign-here: Client -->';
	const after = '# A completely new title\n\nMore text.\n\n<!-- mdpubs-sign-here: Client -->';
	assert.deepEqual(signAnchorKeys(before), signAnchorKeys(after));
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
