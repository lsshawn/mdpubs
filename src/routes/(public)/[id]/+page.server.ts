import { error } from '@sveltejs/kit';
import { config } from '$lib/config';
import { parseCustomComponentsInHtml } from '$lib/helpers/custom-components-parser';
import type { PageServerLoad } from './$types';

interface Heading {
	level: number;
	text: string;
	id: string;
}

interface TocNode extends Heading {
	children: TocNode[];
}

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	try {
		const showDiffs = url.searchParams.get('diffs') === 'true';

		const res = await fetch(`${config.apiUrl}/notes/${params.id}?parse=markdown`);

		if (!res.ok) {
			if (res.status === 404) {
				throw error(404, 'Note not found');
			}
			throw error(500, 'Failed to load note');
		}

		const note = await res.json();

		// Raw HTML pubs are rendered in a sandboxed iframe (served by the API's
		// /notes/:id/raw endpoint with a strict CSP), not via {@html}. Detect by
		// file extension; the API returns the raw note (no `html` field) for these.
		const ext = (note?.fileExtension || note?.file_extension || '').toLowerCase();
		const isHtml = ext === 'html' || ext === 'htm';

		// Process custom components in the markdown-rendered HTML (markdown pubs only)
		if (!isHtml && note?.html) {
			note.html = parseCustomComponentsInHtml(note.html);
		}

		console.log(
			'[LS] -> src/routes/(public)/[id]/+page.server.ts:52 -> note: ',
			JSON.stringify(note.toc)
		);

		let versions = null;
		if (showDiffs && note?.frontmatter?.mdpubs) {
			const versionsRes = await fetch(
				`${config.apiUrl}/notes/${note.frontmatter.mdpubs}/versions?diffs=true`
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
		const title = note?.frontmatter?.title || note?.title || 'Note';
		const description = note?.frontmatter?.description || 'A published note from MdPubs';
		const ogImage = `https://mdpubs.com/og/${params.id}.png`; // We'll create this endpoint

		// Check if note should be indexed (default: false for privacy)
		const allowIndexing = note?.frontmatter?.['mdpubs-allow-indexing'] === true;

		return {
			note,
			isHtml,
			rawUrl: isHtml ? `${config.apiUrl}/notes/${params.id}/raw` : null,
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
