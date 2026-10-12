/**
 * /api/og/<publicId>.png — the note's share card with its title on it, and
 * /api/og/default.png — the site card.
 *
 * The title comes from the same anonymous note read a link-preview crawler gets,
 * so the card never shows more than og:title already does. A note the API won't
 * serve anonymously (private, deleted, missing) gets the site card.
 */
import { config } from '#lib/config.js';
import { cachedOgImage, plainTitle, renderOgImage } from '#lib/server/og.js';
import { isCustomDomainHost } from '#lib/server/host.js';
import type { RequestHandler } from './$types';

async function noteTitle(id: string, fetch: typeof globalThis.fetch): Promise<string | null> {
	const [noteRes, fmRes] = await Promise.all([
		fetch(`${config.apiUrl}/notes/${id}`),
		fetch(`${config.apiUrl}/notes/${id}?only=frontmatter`)
	]);
	if (!noteRes.ok) return null;
	const note = await noteRes.json();
	const fm = fmRes.ok ? await fmRes.json() : {};
	return plainTitle(fm?.title || note?.title);
}

export const GET: RequestHandler = async ({ params, fetch, url }) => {
	const id = params.file.replace(/\.png$/, '');
	try {
		return await cachedOgImage(url.href, async () =>
			renderOgImage({
				fetch,
				origin: url.origin,
				title: id === 'default' ? null : await noteTitle(id, fetch),
				customHost: isCustomDomainHost(url.host) ? url.host : null
			})
		);
	} catch (e) {
		// A broken card must never break the share preview: fall back to the static one.
		console.error('og render failed', e);
		return Response.redirect(`${url.origin}/og-default.png`, 302);
	}
};
