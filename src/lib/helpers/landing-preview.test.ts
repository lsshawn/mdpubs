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

/*
	Indentation only means CODE where a code block can actually start: after a
	blank line, and never inside a list. Treating every indented line as code cost
	a visitor their signing box when they indented the anchor under a list item or
	wrapped it onto a continuation line — the anchor rendered as a bare HTML
	comment and no box could ever appear, with nothing on screen to explain why.

	Each case asserts against what marked itself does with the same markdown, so
	the scanner and the renderer cannot drift apart: a real `<pre><code>` means
	the anchor is an example, anything else means it is a live anchor.
*/
function rendersAsCode(md: string): boolean {
	const html = marked.parse(md, { async: false, gfm: true }) as string;
	return /<pre><code>[\s\S]*mdpubs-sign-here/.test(html);
}

test('an anchor indented under a list item still gets a signing box', () => {
	const md = ['- Deliverables', '', '    <!-- mdpubs-sign-here: Client -->', '', '- Timeline'].join(
		'\n'
	);
	assert.equal(rendersAsCode(md), false, 'marked treats this as a live anchor, not code');
	assert.deepEqual(signAnchorLabels(md), ['Client']);
});

test('an anchor indented directly under a list item, no blank line, still signs', () => {
	const md = ['- Deliverables', '    <!-- mdpubs-sign-here: Client -->', '- Timeline'].join('\n');
	assert.equal(rendersAsCode(md), false);
	assert.deepEqual(signAnchorLabels(md), ['Client']);
});

test('an anchor under a numbered list item still signs', () => {
	const md = ['1. Scope', '', '    <!-- mdpubs-sign-here: Client -->'].join('\n');
	assert.equal(rendersAsCode(md), false);
	assert.deepEqual(signAnchorLabels(md), ['Client']);
});

test('an anchor on a paragraph continuation line still signs', () => {
	const md = ['Sign below please', '    <!-- mdpubs-sign-here: Client -->'].join('\n');
	assert.equal(rendersAsCode(md), false);
	assert.deepEqual(signAnchorLabels(md), ['Client']);
});

test('an indented anchor after the list ends is code again', () => {
	// The flush-left paragraph closes the list, the blank line lets code open.
	const md = ['- item', '', 'Prose ends the list.', '', '    <!-- mdpubs-sign-here: A -->'].join(
		'\n'
	);
	assert.equal(rendersAsCode(md), true, 'marked treats this as a real code block');
	assert.deepEqual(signAnchorLabels(md), []);
});

test('a multi-line indented code block hides an anchor on any of its lines', () => {
	const md = [
		'Example:',
		'',
		'    first line',
		'    <!-- mdpubs-sign-here: A -->',
		'',
		'done'
	].join('\n');
	assert.equal(rendersAsCode(md), true);
	assert.deepEqual(signAnchorLabels(md), []);
});

test('an inline code span on an indented continuation line is still code', () => {
	// The line continues a paragraph, so it is not a code block, but the backtick
	// span on it still hides the anchor inside it.
	const md = ['Write this:', '    `<!-- mdpubs-sign-here: A -->`'].join('\n');
	assert.deepEqual(signAnchorLabels(md), []);
});

/*
	The scanner decides what is code by reading the markdown itself, so it can
	drift from what the page actually renders — and a drift either way costs the
	visitor something: an anchor silently inert, or a signing box swallowing the
	document. This checks the two against each other across the shapes people
	actually write. marked is the oracle: if it escaped the anchor into a code
	element, it is an example; otherwise it is a live anchor.

	It caught two cases a hand-written rule missed: eight spaces inside a list
	item IS code (four of those columns belong to the item), and a fence indented
	inside a list item is still a fence.
*/
const CODE_SHAPES: Array<[string, string]> = (() => {
	const A = '<!-- mdpubs-sign-here: X -->';
	return [
		['a bare anchor', A],
		['after a paragraph', `text\n\n${A}`],
		['a paragraph continuation line', `text\n    ${A}`],
		['on the same line as a bullet', `- item ${A}`],
		['indented under a bullet', `- item\n    ${A}`],
		['indented under a bullet, blank line between', `- item\n\n    ${A}`],
		['under a numbered item', `1. item\n\n    ${A}`],
		['under a star bullet', `* item\n\n    ${A}`],
		['under a plus bullet', `+ item\n\n    ${A}`],
		['eight spaces inside a list item', `- item\n\n        ${A}`],
		['a real indented code block', `text\n\n    ${A}`],
		['the second line of an indented code block', `text\n\n    a\n    ${A}`],
		['indented after the list has ended', `- item\n\nprose\n\n    ${A}`],
		['a tab-indented code block', `text\n\n\t${A}`],
		['a backtick fence', `\`\`\`\n${A}\n\`\`\``],
		['a tilde fence', `~~~\n${A}\n~~~`],
		['a fence indented inside a list item', `- item\n\n    \`\`\`\n    ${A}\n    \`\`\``],
		['an inline code span', `write \`${A}\` here`],
		['indented after a heading', `# H\n\n    ${A}`],
		['an indented line under a blockquote', `> quote\n    ${A}`],
		['indented at the very start of the document', `    ${A}`],
		['indented after two blank lines', `text\n\n\n    ${A}`]
	];
})();

test('what counts as code matches what the page renders', () => {
	const disagreements: string[] = [];
	for (const [name, md] of CODE_SHAPES) {
		const html = marked.parse(md, { async: false, gfm: true }) as string;
		const rendersAsExample =
			/<pre><code>[\s\S]*mdpubs-sign-here/.test(html) ||
			/<code>[^<]*mdpubs-sign-here/.test(html) ||
			html.includes('&lt;!-- mdpubs-sign-here');
		const treatedAsExample = signAnchorLabels(md).length === 0;
		if (rendersAsExample !== treatedAsExample) {
			disagreements.push(
				`${name}: the page renders it as ${rendersAsExample ? 'an example' : 'a live anchor'}, ` +
					`but it is treated as ${treatedAsExample ? 'an example' : 'a live anchor'}\n` +
					`  markdown: ${JSON.stringify(md)}\n  html: ${html.trim()}`
			);
		}
	}
	assert.deepEqual(disagreements, [], `\n${disagreements.join('\n\n')}`);
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
