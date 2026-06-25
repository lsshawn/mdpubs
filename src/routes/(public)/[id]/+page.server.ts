import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { config } from '$lib/config';
import { db } from '$lib/server/db';
import { note as noteTable } from '$lib/server/db/schema';
import { parseCustomComponentsInHtml } from '$lib/helpers/custom-components-parser';
import type { PageServerLoad } from './$types';

/**
 * The public API returns 404 for missing, deleted, AND private notes alike (it
 * intentionally hides a private note's existence). When that 404 is actually a
 * private-but-not-deleted note, we want to show a "private note, log in" gate
 * rather than the generic "not found"/"something went wrong" page. We can tell
 * the cases apart because the UI shares the main DB: a direct lookup reveals
 * whether the id is a live private note. Throws 403 (PRIVATE_NOTE) if so.
 */
async function assertNotPrivate(id: string): Promise<void> {
	const noteId = parseInt(id, 10);
	if (isNaN(noteId)) return;

	const [row] = await db
		.select({ isPrivate: noteTable.isPrivate })
		.from(noteTable)
		.where(and(eq(noteTable.id, noteId), isNull(noteTable.deletedAt)));

	if (row?.isPrivate) {
		throw error(403, 'PRIVATE_NOTE');
	}
}

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	try {
		const showDiffs = url.searchParams.get('diffs') === 'true';

		const res = await fetch(`${config.apiUrl}/notes/${params.id}?parse=markdown`);

		if (!res.ok) {
			if (res.status === 404) {
				// A 404 from the public API may really be a live private note.
				await assertNotPrivate(params.id);
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
				versions = versionsData.versions.sort(
					(a: { version: number }, b: { version: number }) => b.version - a.version
				);
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
