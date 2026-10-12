import { allTemplates, SITE } from '#lib/server/pseo.js';
import type { RequestHandler } from './$types';

/**
 * Marketing pages only. Published notes are not listed: they are user content,
 * noindex by default (see (public)/[id]/+layout.server.ts), and a sitemap
 * entry for a noindex URL is a contradiction Search Console reports as an error.
 */
export const GET: RequestHandler = () => {
	const latest = allTemplates().reduce((m, t) => (t.updated > m ? t.updated : m), '');
	const urls = [
		{ loc: `${SITE}/`, lastmod: '' },
		{ loc: `${SITE}/templates`, lastmod: latest },
		...allTemplates().map((t) => ({ loc: `${SITE}/templates/${t.slug}`, lastmod: t.updated }))
	];
	const body =
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
		urls
			.map(
				(u) =>
					`  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
			)
			.join('\n') +
		'\n</urlset>\n';
	return new Response(body, {
		headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' }
	});
};
