import { error } from '@sveltejs/kit';
import { app } from '$lib/config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const res = await fetch(`${app.apiUrl}/public/notes/${params.id}?parse=markdown`);
		
		if (!res.ok) {
			if (res.status === 404) {
				throw error(404, 'Note not found');
			}
			throw error(500, 'Failed to load note');
		}

		const note = await res.json();
		
		// Generate meta tags for social sharing
		const title = note?.frontmatter?.title || 'Note';
		const description = note?.frontmatter?.description || 'A published note from NeoNote';
		const ogImage = `https://neonote.sshawn.com/og/${params.id}.png`; // We'll create this endpoint
		
		return {
			note,
			meta: {
				title,
				description,
				ogImage,
				url: `https://neonote.sshawn.com/${params.id}`
			}
		};
	} catch (e) {
		if (e.status) {
			throw e; // Re-throw SvelteKit errors
		}
		throw error(500, 'Network error occurred');
	}
}; 