import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDoc,
	makeAnchor,
	resolveAnchor,
	cleanAnchor,
	type AnchorBlock
} from './comment-anchor.ts';

// Synthetic document only; no database access.
const p = (text: string): AnchorBlock => ({ tag: 'p', text });
const original: AnchorBlock[] = [
	{ tag: 'h2', text: 'Scope of work', heading: 'scope-of-work' },
	{
		...p('We will build the onboarding flow and the billing page in the first month.'),
		heading: 'scope-of-work'
	},
	{
		...p('Payment is due within fourteen days of each invoice being issued.'),
		heading: 'scope-of-work'
	},
	{ tag: 'img', text: '', src: 'https://img.example/diagram.png', heading: 'scope-of-work' },
	{ tag: 'tr', text: 'Design 40 hours', heading: 'scope-of-work' },
	{ tag: 'tr', text: 'Build 120 hours', heading: 'scope-of-work' },
	{ tag: 'li', text: 'Yes', heading: 'scope-of-work' },
	{ tag: 'li', text: 'No', heading: 'scope-of-work' },
	{
		...p('Either party may end this agreement with thirty days of written notice.'),
		heading: 'scope-of-work'
	}
];
const doc = buildDoc(original);

/** Anchor a selection of `quote` inside block `i` of the original document. */
function select(i: number, quote: string) {
	const start = doc.starts[i] + original[i].text.indexOf(quote);
	return makeAnchor(doc, i, { start, end: start + quote.length });
}

function textOf(d: ReturnType<typeof buildDoc>, r: { start?: number; end?: number }) {
	return d.text.slice(r.start, r.end);
}

test('unchanged document: block and quote resolve exactly', () => {
	const block = resolveAnchor(makeAnchor(doc, 2), doc);
	assert.deepEqual(block, { status: 'exact', block: 2, endBlock: 2 });

	const r = resolveAnchor(select(2, 'fourteen days'), doc);
	assert.equal(r.status, 'exact');
	assert.equal(r.block, 2);
	assert.equal(textOf(doc, r), 'fourteen days');
});

test('a selection across two paragraphs keeps both ends', () => {
	const start = doc.starts[1] + original[1].text.indexOf('first month.');
	const end = doc.starts[2] + 'Payment is due'.length;
	const r = resolveAnchor(makeAnchor(doc, 1, { start, end }), doc);
	assert.equal(r.status, 'exact');
	assert.equal(r.block, 1);
	assert.equal(r.endBlock, 2);
});

test('paragraphs added above: the comment moves with its block', () => {
	const next = buildDoc([p('A new introduction.'), p('And a second new line.'), ...original]);
	assert.equal(resolveAnchor(makeAnchor(doc, 2), next).block, 4);
	const r = resolveAnchor(select(2, 'fourteen days'), next);
	assert.equal(r.status, 'exact');
	assert.equal(r.block, 4);
});

test('the block was reordered to the end', () => {
	const moved = [...original];
	const [para] = moved.splice(2, 1);
	moved.push(para);
	const r = resolveAnchor(makeAnchor(doc, 2), buildDoc(moved));
	assert.equal(r.status, 'exact');
	assert.equal(r.block, moved.length - 1);
});

test('words around the quote were edited: the quote is still found', () => {
	const edited = [...original];
	edited[2] = p('Our payment terms: fourteen days from the invoice date, no exceptions.');
	const next = buildDoc(edited);
	const r = resolveAnchor(select(2, 'fourteen days'), next);
	assert.equal(r.block, 2);
	assert.equal(textOf(next, r), 'fourteen days');
});

test('the quote itself was edited: the nearest words are marked as changed', () => {
	const edited = [...original];
	edited[2] = p('Payment is due within thirty days of each invoice being issued.');
	const next = buildDoc(edited);
	const r = resolveAnchor(select(2, 'due within fourteen days of each invoice'), next);
	assert.equal(r.status, 'changed');
	assert.equal(r.block, 2);
	assert.equal(textOf(next, r), 'due within thirty days of each invoice');
});

test('the quote was replaced outright: falls back to the text between its old surroundings', () => {
	const edited = [...original];
	edited[2] = p('Payment is due within 2 weeks of each invoice being issued.');
	const next = buildDoc(edited);
	const r = resolveAnchor(select(2, 'fourteen days'), next);
	assert.equal(r.status, 'changed');
	assert.equal(textOf(next, r), '2 weeks');
});

test('a block comment survives a heavy rewrite of its paragraph', () => {
	const edited = [...original];
	edited[1] = p('In month one we will build the onboarding flow, then the billing page.');
	const r = resolveAnchor(makeAnchor(doc, 1), buildDoc(edited));
	assert.equal(r.status, 'changed');
	assert.equal(r.block, 1);
});

test('a paragraph rewritten from scratch is found by its neighbours', () => {
	const edited = [...original];
	edited[2] = p('Invoices are settled monthly by bank transfer.');
	const r = resolveAnchor(makeAnchor(doc, 2), buildDoc(edited));
	assert.equal(r.status, 'changed');
	assert.equal(r.block, 2);
});

test('an image is followed by its URL, and by its place when the file is swapped', () => {
	const moved = [original[3], ...original.slice(0, 3), ...original.slice(4)];
	assert.deepEqual(resolveAnchor(makeAnchor(doc, 3), buildDoc(moved)), {
		status: 'exact',
		block: 0,
		endBlock: 0
	});

	const swapped = [...original];
	swapped[3] = { tag: 'img', text: '', src: 'https://img.example/diagram-v2.png' };
	const r = resolveAnchor(makeAnchor(doc, 3), buildDoc(swapped));
	assert.equal(r.status, 'changed');
	assert.equal(r.block, 3);
});

test('a swapped image is still found when the paragraph above it was edited too', () => {
	const edited = [...original];
	edited[2] = p('Payment is due within thirty days of every invoice.');
	edited[3] = { tag: 'img', text: '', src: 'https://img.example/diagram-v2.png' };
	const r = resolveAnchor(makeAnchor(doc, 3), buildDoc(edited));
	assert.equal(r.status, 'changed');
	assert.equal(r.block, 3);
});

test('a table row follows its text when a row is inserted above', () => {
	const edited = [...original];
	edited.splice(4, 0, { tag: 'tr', text: 'Research 10 hours' });
	assert.equal(resolveAnchor(makeAnchor(doc, 5), buildDoc(edited)).block, 6);
});

test('twin blocks are told apart by their neighbours', () => {
	const twins = buildDoc([
		p('Intro paragraph one.'),
		{ tag: 'li', text: 'Yes' },
		p('Middle paragraph here.'),
		{ tag: 'li', text: 'Yes' },
		p('Closing paragraph.')
	]);
	const anchor = makeAnchor(twins, 3);
	const next = buildDoc([p('Brand new first line.'), ...twins.blocks]);
	assert.equal(resolveAnchor(anchor, next).block, 4);
});

test('deleted text detaches the comment instead of latching onto a lookalike', () => {
	const removed = original.filter((_, i) => i !== 2);
	const next = buildDoc(removed);
	const block = resolveAnchor(makeAnchor(doc, 2), next);
	assert.equal(block.status, 'detached');
	assert.equal(block.block, 1); // hint: right after the paragraph that used to precede it

	// "days" still appears elsewhere ("thirty days"), but not in the same surroundings.
	const quote = resolveAnchor(select(2, 'days'), next);
	assert.equal(quote.status, 'detached');
});

test('a short twin whose own block was deleted does not jump to another twin', () => {
	const twins = buildDoc([
		p('Intro paragraph one.'),
		{ tag: 'li', text: 'Yes' },
		p('Middle paragraph here.'),
		{ tag: 'li', text: 'Yes' },
		p('Closing paragraph.')
	]);
	const anchor = makeAnchor(twins, 3);
	const next = buildDoc([twins.blocks[1], twins.blocks[0], twins.blocks[2], twins.blocks[4]]);
	assert.equal(resolveAnchor(anchor, next).status, 'detached');
});

test('empty document', () => {
	assert.equal(resolveAnchor(makeAnchor(doc, 2), buildDoc([])).status, 'detached');
});

test('cleanAnchor drops junk and caps sizes', () => {
	assert.equal(cleanAnchor(null), null);
	assert.equal(cleanAnchor({ kind: 'text', tag: 'p', index: 0, text: 'x' }), null); // no quote
	assert.equal(cleanAnchor({ kind: 'block', tag: 'p', index: -1, text: 'x' }), null);
	const a = cleanAnchor({ kind: 'block', tag: 'p', index: 3, text: 'x'.repeat(5000), extra: 1 });
	assert.equal(a?.text.length, 400);
	assert.equal('extra' in (a as object), false);
});
