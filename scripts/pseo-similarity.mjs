#!/usr/bin/env node
// Near-duplicate gate for the /templates pages: word 5-gram Jaccard of each
// body against every sibling. Google demotes folders whose pages differ only
// by a swapped noun, so a pair above the threshold fails the run.
//
//   node scripts/pseo-similarity.mjs            # all pages, exit 1 on a fail
//   node scripts/pseo-similarity.mjs <slug>...  # only these against the rest
import { readdirSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';

const DIR = 'src/lib/pseo/templates';
const THRESHOLD = 0.5;

const shingles = (text) => {
	const w =
		text
			.toLowerCase()
			.replace(/\[[^\]]*\]/g, ' ')
			.match(/[a-z0-9']+/g) ?? [];
	const out = new Set();
	for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '));
	return out;
};
const jaccard = (a, b) => {
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	return inter / (a.size + b.size - inter || 1);
};

const pages = readdirSync(DIR)
	.filter((f) => f.endsWith('.md'))
	.map((f) => {
		const { data, content } = matter(readFileSync(`${DIR}/${f}`, 'utf8'));
		const text = [
			data.intro,
			...(data.covers ?? []),
			...(data.faqs ?? []).map((q) => `${q.q} ${q.a}`),
			content
		].join(' ');
		return { slug: f.replace(/\.md$/, ''), set: shingles(text) };
	});

const only = process.argv.slice(2);
let fail = 0;
for (const p of pages.filter((p) => !only.length || only.includes(p.slug))) {
	let best = { slug: '-', score: 0 };
	for (const q of pages) {
		if (q.slug === p.slug) continue;
		const s = jaccard(p.set, q.set);
		if (s > best.score) best = { slug: q.slug, score: s };
	}
	const bad = best.score > THRESHOLD;
	fail += bad ? 1 : 0;
	console.log(
		`${bad ? 'FAIL' : 'ok  '} ${best.score.toFixed(3)}  ${p.slug}  (closest: ${best.slug})`
	);
}
process.exit(fail ? 1 : 0);
