import { error } from '@sveltejs/kit';
import { contractHtml, getTemplate, heading, signableMarkdown, SITE } from '#lib/server/pseo.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const t = getTemplate(params.slug);
	if (!t) error(404, 'Template not found');
	const related = t.related
		.map((s) => getTemplate(s))
		.filter((r) => r !== undefined)
		.map((r) => ({ slug: r.slug, heading: heading(r) }));
	return {
		canonical: `${SITE}/templates/${t.slug}`,
		template: { ...t, body: undefined, heading: heading(t) },
		html: contractHtml(t),
		markdown: signableMarkdown(t),
		related
	};
};
