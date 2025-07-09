import { error } from '@sveltejs/kit';
import { app } from '$lib/config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	try {
		const showDiffs = url.searchParams.get('diffs') === 'true';

		const res = await fetch(`${app.apiUrl}/notes/${params.id}?parse=markdown`);

		if (!res.ok) {
			if (res.status === 404) {
				throw error(404, 'Note not found');
			}
			throw error(500, 'Failed to load note');
		}

		const note = await res.json();

		let versions = null;
		if (showDiffs && note?.frontmatter?.mdpubs) {
			const versionsRes = await fetch(
				`${app.apiUrl}/notes/${note.frontmatter.mdpubs}/versions?diffs=true`
			);
			if (versionsRes.ok) {
				const versionsData = await versionsRes.json();
				// Sort versions descending to show latest first
				versions = versionsData.versions.sort((a: any, b: any) => b.version - a.version);
			} else {
				// Don't throw an error, just log it and the page will show a message.
				console.error('Failed to load note versions');
			}
		}

		// Generate meta tags for social sharing
		const title = note?.frontmatter?.title || 'Note';
		const description = note?.frontmatter?.description || 'A published note from MdPubs';
		const ogImage = `https://mdpubs.com/og/${params.id}.png`; // We'll create this endpoint

		// Check if note should be indexed (default: false for privacy)
		const allowIndexing = note?.frontmatter?.['mdpubs-allow-indexing'] === true;

		return {
			note,
			versions,
			meta: {
				title,
				description,
				ogImage,
				url: `https://mdpubs.com/${params.id}`,
				allowIndexing
			}
		};
	} catch (e) {
		if (e.status) {
			throw e; // Re-throw SvelteKit errors
		}
		throw error(500, 'Network error occurred');
	}
};
