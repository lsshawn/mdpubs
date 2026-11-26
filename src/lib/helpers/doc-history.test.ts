import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffBlocks, follow, plainText, splitBlocks, summarize } from './doc-history.ts';

// Synthetic documents only.
const v1 = `---
title: Proposal
mdpubs-comments: public
---

<!-- toc -->
- [Scope](#scope)
<!-- toc -->

## Scope

We will build the **onboarding flow** and the [billing page](https://example.test) in the first month.

Payment is due within fourteen days of each invoice.

- Design review
- Build phase

| Phase | Hours |
| --- | --- |
| Design | 40 |
| Build | 120 |

![Diagram](/d.png)

\`\`\`js
const total = 1;
\`\`\`

## Timeline

Work starts on the first Monday after the deposit clears.
`;

test('markdown is cut into the blocks a reader sees', () => {
	const blocks = splitBlocks(v1);
	assert.deepEqual(
		blocks.map((b) => [b.kind, b.text, b.section]),
		[
			['heading', 'Scope', 'Scope'],
			[
				'text',
				'We will build the onboarding flow and the billing page in the first month.',
				'Scope'
			],
			['text', 'Payment is due within fourteen days of each invoice.', 'Scope'],
			['item', 'Design review', 'Scope'],
			['item', 'Build phase', 'Scope'],
			['row', 'Phase · Hours', 'Scope'],
			['row', 'Design · 40', 'Scope'],
			['row', 'Build · 120', 'Scope'],
			['media', 'Image: Diagram', 'Scope'],
			['code', 'const total = 1;', 'Scope'],
			['heading', 'Timeline', 'Timeline'],
			['text', 'Work starts on the first Monday after the deposit clears.', 'Timeline']
		]
	);
});

test('plainText drops markdown marks but keeps the words', () => {
	assert.equal(
		plainText('A *very* **bold** `code` [link](http://x) ~~gone~~'),
		'A very bold code link gone'
	);
	assert.equal(plainText('snake_case_name stays'), 'snake_case_name stays');
	assert.equal(plainText('<video controls src="/a.mp4"></video>'), 'Video');
});

test('a reworded paragraph is one change with a word-by-word difference', () => {
	const v2 = v1.replace('fourteen days of each invoice', 'thirty days of every invoice');
	const changes = diffBlocks(splitBlocks(v1), splitBlocks(v2));
	assert.equal(changes.length, 1);
	assert.equal(changes[0].type, 'changed');
	assert.equal(changes[0].section, 'Scope');
	const added = changes[0].parts!.filter((p) => p.op === 1).map((p) => p.text.trim());
	const removed = changes[0].parts!.filter((p) => p.op === -1).map((p) => p.text.trim());
	assert.deepEqual(added.filter(Boolean), ['thirty', 'every']);
	assert.deepEqual(removed.filter(Boolean), ['fourteen', 'each']);
	assert.equal(summarize(changes), '1 reworded');
});

test('added, removed and moved blocks are told apart', () => {
	let v2 = v1.replace('- Build phase\n', '- Build phase\n- Handover\n');
	v2 = v2.replace('| Design | 40 |\n', '');
	// Move the payment paragraph under Timeline.
	v2 = v2.replace('Payment is due within fourteen days of each invoice.\n\n', '');
	v2 += '\nPayment is due within fourteen days of each invoice.\n';
	const changes = diffBlocks(splitBlocks(v1), splitBlocks(v2));
	assert.deepEqual(changes.map((c) => [c.type, c.after ?? c.before]).sort(), [
		['added', 'Handover'],
		['moved', 'Payment is due within fourteen days of each invoice.'],
		['removed', 'Design · 40']
	]);
	assert.equal(changes.find((c) => c.type === 'moved')!.section, 'Timeline');
});

test('frontmatter-only edits are not changes to the text', () => {
	const v2 = v1.replace('mdpubs-comments: public', 'mdpubs-comments: true');
	assert.deepEqual(diffBlocks(splitBlocks(v1), splitBlocks(v2)), []);
	assert.equal(summarize([]), 'No changes to the text');
});

test('one paragraph is followed back through every version', () => {
	const v0 = v1.replace('Payment is due within fourteen days of each invoice.\n\n', '');
	const v2 = v1.replace('fourteen days of each invoice', 'thirty days of each invoice');
	const v3 = v2.replace('## Scope\n', 'A new opening line.\n\n## Scope\n'); // unrelated edit
	const v4 = v3.replace(
		'thirty days of each invoice',
		'thirty days of every invoice, no exceptions'
	);
	const versions = [v0, v1, v2, v3, v4].map(splitBlocks);
	const { section, steps } = follow(
		versions,
		'Payment is due within thirty days of every invoice, no exceptions.'
	);
	assert.equal(section, false);
	assert.deepEqual(
		steps.map((s) => [s.version, s.type]),
		[
			[1, 'first'],
			[2, 'changed'],
			[4, 'changed']
		]
	);
	assert.equal(steps[1].text, 'Payment is due within thirty days of each invoice.');
});

test('a heading follows its whole section', () => {
	const v2 = v1.replace(
		'first Monday after the deposit clears',
		'first Monday after the deposit clears, at 9am'
	);
	const v3 = v2.replace('## Timeline', '## Timeline and dates');
	const { section, steps } = follow([v1, v2, v3].map(splitBlocks), 'Timeline and dates');
	assert.equal(section, true);
	assert.deepEqual(
		steps.map((s) => [s.version, s.type]),
		[
			[0, 'first'],
			[1, 'changed']
		]
	);
	assert.ok(steps[1].parts!.some((p) => p.op === 1 && p.text.includes('9am')));
});

test('text that is not in the document has no history', () => {
	assert.deepEqual(
		follow([v1].map(splitBlocks), 'Completely unrelated sentence about llamas.').steps,
		[]
	);
	assert.deepEqual(follow([], 'x').steps, []);
});
