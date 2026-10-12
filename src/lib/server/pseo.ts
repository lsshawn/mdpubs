import matter from 'gray-matter';
import { marked } from 'marked';

/**
 * Contract template pages (/templates/<slug>), one markdown file per page in
 * src/lib/pseo/templates/. Files, not DB rows: a new page is a reviewed PR, and
 * the folder is what the pSEO batches write into (see pseo/plan.md).
 *
 * Each body is a real contract with mdpubs sign-here anchors, so the same text
 * renders on the page and downloads as a file mdpubs can publish for signing.
 */

/**
 * Canonical origin. Hardcoded because PUBLIC_DOMAIN differs per env file (bare
 * host in one, with scheme in another, localhost in dev), and a canonical must
 * name production even when the page is served from www or a custom domain.
 */
export const SITE = 'https://mdpubs.com';

export type Faq = { q: string; a: string };

export type Template = {
	slug: string;
	keyword: string;
	profession: string;
	signer: string;
	title: string;
	description: string;
	updated: string;
	intro: string;
	covers: string[];
	faqs: Faq[];
	related: string[];
	body: string;
};

const files = import.meta.glob('/src/lib/pseo/templates/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

const ANCHOR = /<!--\s*mdpubs-sign-here:\s*(.+?)\s*-->/g;

function parse(path: string, raw: string): Template {
	const { data, content } = matter(raw);
	const slug = path.split('/').pop()!.replace(/\.md$/, '');
	if (data.slug && data.slug !== slug) throw new Error(`${path}: slug ${data.slug} != filename`);
	const updated =
		data.updated instanceof Date
			? data.updated.toISOString().slice(0, 10)
			: String(data.updated ?? '');
	return {
		slug,
		keyword: data.keyword,
		profession: data.profession,
		signer: data.signer,
		title: data.title,
		description: data.description,
		updated,
		intro: data.intro,
		covers: data.covers ?? [],
		faqs: data.faqs ?? [],
		related: data.related ?? [],
		body: content.trim()
	};
}

const templates: Template[] = Object.entries(files)
	.map(([path, raw]) => parse(path, raw))
	.sort((a, b) => a.keyword.localeCompare(b.keyword));

const bySlug = new Map(templates.map((t) => [t.slug, t]));

/**
 * The keyword as a heading: first letter up, and acronyms spelled as the
 * profession spells them, so "ugc creator" heads the page as "UGC creator".
 */
export function heading(t: Pick<Template, 'keyword' | 'profession'>): string {
	const forms = new Map(t.profession.split(/\s+/).map((w) => [w.toLowerCase(), w]));
	const words = t.keyword
		.split(' ')
		.map((w) => (forms.get(w) === w.toUpperCase() ? w.toUpperCase() : w));
	const out = words.join(' ');
	return out.charAt(0).toUpperCase() + out.slice(1);
}

export function allTemplates(): Template[] {
	return templates;
}

export function getTemplate(slug: string): Template | undefined {
	return bySlug.get(slug);
}

/** The contract as HTML, with each sign-here anchor drawn as a signature line. */
export function contractHtml(t: Template): string {
	const md = t.body.replace(
		ANCHOR,
		(_, who: string) => `**${who}**\n\nSignature: ______________________  Date: ____________`
	);
	return marked.parse(md, { async: false }) as string;
}

/** The download: the body plus the frontmatter that makes mdpubs collect signatures. */
export function signableMarkdown(t: Template): string {
	const name = t.profession.charAt(0).toUpperCase() + t.profession.slice(1);
	const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
	return [
		'---',
		`title: ${q(`${name} Agreement`)}`,
		'mdpubs-sign: true',
		'mdpubs-is-private: true',
		'mdpubs-signers-open:',
		`  - ${q(t.signer)}`,
		"  - 'Client'",
		'mdpubs-sign-order: parallel',
		'---',
		'',
		t.body,
		''
	].join('\n');
}
