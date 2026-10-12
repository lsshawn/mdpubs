import { allTemplates, heading, SITE } from '#lib/server/pseo.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	canonical: `${SITE}/templates`,
	templates: allTemplates().map((t) => ({
		slug: t.slug,
		heading: heading(t),
		description: t.description
	}))
});
