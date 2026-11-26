/**
 * How a document changed between versions, in terms a reader thinks in:
 * paragraphs that were reworded, added, removed or moved. No line numbers,
 * no plus and minus signs.
 *
 * Each saved version's markdown is cut into blocks (a heading, a paragraph, a
 * list item, a table row, a code block, an image). Versions are compared block
 * by block, and a changed block is compared word by word. A single paragraph or
 * a whole section can be followed back through every version.
 *
 * Pure functions, so they run under `node --test`.
 */
import { diffArrays, diffWordsWithSpace } from 'diff';

export type HistoryBlock = {
	kind: 'heading' | 'text' | 'item' | 'row' | 'code' | 'media';
	/** The block as a reader sees it: markdown marks removed. */
	text: string;
	/** Title of the heading it sits under ('' above the first heading). */
	section: string;
	/** Heading level (1-6) for a heading, else 0. */
	level: number;
};

/** A stretch of text that stayed (0), was added (1) or was removed (-1). */
export type Part = { text: string; op: -1 | 0 | 1 };

export type Change = {
	type: 'changed' | 'added' | 'removed' | 'moved';
	section: string;
	kind: HistoryBlock['kind'];
	before?: string;
	after?: string;
	/** Word-by-word difference, for `changed`. */
	parts?: Part[];
};

/** Markdown marks off, so the text matches what the page shows. */
export function plainText(md: string): string {
	return md
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => (alt ? `Image: ${alt}` : 'Image'))
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<(video|audio|iframe)\b[^>]*>(?:\s*<\/\1>)?/gi, (_, tag) =>
			tag.toLowerCase() === 'iframe' ? 'Embed' : tag[0].toUpperCase() + tag.slice(1).toLowerCase()
		)
		.replace(/<[^>]+>/g, '')
		.replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
		.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s).,;:!?])/g, '$1$2')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/^\s*\[[ xX]\]\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripFrontmatter(md: string): string {
	const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return m ? md.slice(m[0].length) : md;
}

export function splitBlocks(markdown: string): HistoryBlock[] {
	const body = stripFrontmatter(markdown)
		// The table of contents is navigation, not content.
		.replace(/<!--\s*(?:vim-markdown-)?toc.*?-->[\s\S]*?<!--\s*(?:vim-markdown-)?toc\s*-->/, '');
	const blocks: HistoryBlock[] = [];
	let section = '';
	let para: string[] = [];
	let paraKind: HistoryBlock['kind'] = 'text';

	const push = (kind: HistoryBlock['kind'], raw: string, level = 0) => {
		const media =
			/^\s*(!\[[^\]]*\]\([^)]*\)|<(video|audio|iframe|img)\b[^>]*>(\s*<\/\2>)?)\s*$/i.test(raw);
		const text = kind === 'code' ? raw.trim() : plainText(raw);
		if (!text) return;
		blocks.push({ kind: media ? 'media' : kind, text, section, level });
	};
	const flush = () => {
		if (para.length) push(paraKind, para.join(' '));
		para = [];
		paraKind = 'text';
	};

	const lines = body.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		const fence = line.match(/^\s*(```+|~~~+)/);
		if (fence) {
			flush();
			const code: string[] = [];
			for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++)
				code.push(lines[i]);
			push('code', code.join('\n'));
			continue;
		}
		if (/^\s*\$\$\s*$/.test(line)) {
			flush();
			const math: string[] = [];
			for (i++; i < lines.length && !/^\s*\$\$\s*$/.test(lines[i]); i++) math.push(lines[i]);
			push('code', math.join('\n'));
			continue;
		}

		line = line.replace(/^\s*>\s?/, '');
		if (!line.trim()) {
			flush();
			continue;
		}
		const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
		if (heading) {
			flush();
			section = plainText(heading[2]);
			push('heading', heading[2], heading[1].length);
			continue;
		}
		if (/^\s*\|/.test(line)) {
			flush();
			if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue; // the |---|---| rule
			push(
				'row',
				line
					.trim()
					.replace(/^\||\|$/g, '')
					.split('|')
					.map((c) => c.trim())
					.join(' · ')
			);
			continue;
		}
		if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
			flush();
			continue;
		}
		const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
		if (item) {
			flush();
			paraKind = 'item';
			para.push(item[1]);
			continue;
		}
		para.push(line.trim());
	}
	flush();
	return blocks;
}

export function wordDiff(before: string, after: string): Part[] {
	return diffWordsWithSpace(before, after).map((p) => ({
		text: p.value,
		op: p.added ? 1 : p.removed ? -1 : 0
	}));
}

function words(s: string): Set<string> {
	return new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** 0..1: share of words two texts have in common. */
export function alike(a: string, b: string): number {
	if (a === b) return 1;
	const wa = words(a);
	const wb = words(b);
	if (!wa.size || !wb.size) return 0;
	let both = 0;
	for (const w of wa) if (wb.has(w)) both++;
	return (2 * both) / (wa.size + wb.size);
}

/** What changed going from `prev` to `next`, in reading order. */
export function diffBlocks(prev: HistoryBlock[], next: HistoryBlock[]): Change[] {
	const changes: Change[] = [];
	const runs = diffArrays(
		prev.map((b) => b.text),
		next.map((b) => b.text)
	);
	let pi = 0;
	let ni = 0;
	for (let r = 0; r < runs.length; r++) {
		const run = runs[r];
		const n = run.value.length;
		if (!run.added && !run.removed) {
			pi += n;
			ni += n;
			continue;
		}
		if (run.removed) {
			const removed = prev.slice(pi, pi + n);
			pi += n;
			const following = runs[r + 1];
			let added: HistoryBlock[] = [];
			if (following?.added) {
				added = next.slice(ni, ni + following.value.length);
				ni += following.value.length;
				r++;
			}
			// Pair each removed block with the added block it most resembles: a rewording.
			const used = new Set<number>();
			const pairOf = removed.map((b) => {
				let best = -1;
				let score = 0.4;
				added.forEach((a, k) => {
					if (used.has(k) || a.kind !== b.kind) return;
					const s = alike(b.text, a.text);
					if (s > score) {
						score = s;
						best = k;
					}
				});
				if (best >= 0) used.add(best);
				return best;
			});
			const emitted = new Set<number>();
			const emitAddedUpTo = (limit: number) => {
				for (let k = 0; k < limit; k++) {
					if (emitted.has(k) || used.has(k)) continue;
					emitted.add(k);
					changes.push({
						type: 'added',
						section: added[k].section,
						kind: added[k].kind,
						after: added[k].text
					});
				}
			};
			removed.forEach((b, k) => {
				const pair = pairOf[k];
				if (pair < 0) {
					changes.push({ type: 'removed', section: b.section, kind: b.kind, before: b.text });
					return;
				}
				emitAddedUpTo(pair);
				const a = added[pair];
				changes.push({
					type: 'changed',
					section: a.section,
					kind: a.kind,
					before: b.text,
					after: a.text,
					parts: wordDiff(b.text, a.text)
				});
			});
			emitAddedUpTo(added.length);
			continue;
		}
		for (const a of next.slice(ni, ni + n)) {
			changes.push({ type: 'added', section: a.section, kind: a.kind, after: a.text });
		}
		ni += n;
	}

	// The same text removed in one place and added in another was moved.
	const out: Change[] = [];
	const removedAt = new Map<string, number>();
	changes.forEach((c, i) => {
		if (c.type === 'removed' && !removedAt.has(c.before!)) removedAt.set(c.before!, i);
	});
	const dropped = new Set<number>();
	changes.forEach((c, i) => {
		if (c.type !== 'added') return;
		const from = removedAt.get(c.after!);
		if (from === undefined || dropped.has(from)) return;
		dropped.add(from);
		changes[i] = { type: 'moved', section: c.section, kind: c.kind, after: c.after };
	});
	changes.forEach((c, i) => {
		if (!dropped.has(i)) out.push(c);
	});
	return out;
}

export function summarize(changes: Change[]): string {
	const count = (t: Change['type']) => changes.filter((c) => c.type === t).length;
	const bits: string[] = [];
	const say = (n: number, word: string) => {
		if (n) bits.push(`${n} ${word}`);
	};
	say(count('changed'), 'reworded');
	say(count('added'), 'added');
	say(count('removed'), 'removed');
	say(count('moved'), 'moved');
	return bits.join(' · ') || 'No changes to the text';
}

/** Index of the block in `blocks` that is `text`, or reads most like it. -1 if none does. */
export function findBlock(blocks: HistoryBlock[], text: string, near = -1): number {
	let best = -1;
	let score = 0.45;
	blocks.forEach((b, i) => {
		let s = alike(b.text, text);
		if (s === 1 && i === near) s = 1.01;
		if (s > score) {
			score = s;
			best = i;
		}
	});
	return best;
}

/** The text of the section that starts at heading `at`: everything down to the next heading of its level or higher. */
export function sectionText(blocks: HistoryBlock[], at: number): string {
	const level = blocks[at].level;
	const out: string[] = [];
	for (let i = at + 1; i < blocks.length; i++) {
		if (blocks[i].kind === 'heading' && blocks[i].level <= level) break;
		out.push(blocks[i].text);
	}
	return out.join('\n\n');
}

export type Step = {
	/** Position in the `versions` array given to `follow`. */
	version: number;
	type: 'first' | 'changed' | 'removed';
	text: string;
	parts?: Part[];
};

/**
 * Follow one paragraph (or, for a heading, its whole section) through
 * `versions`, oldest first. Returns one step per version in which it first
 * appeared or changed, oldest first. `text` is the block as it reads in the
 * newest version.
 */
export function follow(
	versions: HistoryBlock[][],
	text: string
): { section: boolean; steps: Step[] } {
	const last = versions.length - 1;
	if (last < 0) return { section: false, steps: [] };
	let at = findBlock(versions[last], text);
	if (at < 0) return { section: false, steps: [] };
	const section = versions[last][at].kind === 'heading';

	// Its text in each version, walking back until it is no longer there.
	const texts: (string | null)[] = versions.map(() => null);
	let current = versions[last][at].text;
	for (let v = last; v >= 0; v--) {
		at = findBlock(versions[v], current, at);
		if (at < 0) break;
		current = versions[v][at].text;
		texts[v] = section ? sectionText(versions[v], at) : current;
	}

	const steps: Step[] = [];
	let before: string | null = null;
	texts.forEach((t, v) => {
		if (t === null) return;
		if (before === null) steps.push({ version: v, type: 'first', text: t });
		else if (t !== before)
			steps.push({ version: v, type: 'changed', text: t, parts: wordDiff(before, t) });
		before = t;
	});
	return { section, steps };
}
