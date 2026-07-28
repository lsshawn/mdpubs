import { json } from '@sveltejs/kit';
import { getOrgByDomain } from '$lib/server/org.js';
import type { RequestHandler } from './$types';

/**
 * Host → org slug lookup for the universal `reroute` hook (src/hooks.ts).
 *
 * `reroute` is a UNIVERSAL hook: it runs on the server and in the browser, so
 * it cannot import $lib/server code. This endpoint is the server-side half —
 * the hook fetches it to learn which org a custom domain belongs to.
 *
 * Cached for an hour at the edge; the host→slug mapping only changes when an
 * org edits its custom domain.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const host = (url.searchParams.get('host') ?? '').toLowerCase();
	if (!host) return json({ slug: null });

	const org = await getOrgByDomain(host);

	setHeaders({ 'cache-control': 'public, max-age=3600' });
	return json({ slug: org?.slug ?? null });
};
