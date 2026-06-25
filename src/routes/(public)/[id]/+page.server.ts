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
 *
 * The note's owner is never gated: if they hit a non-OK from the API it's a real
 * error, not a "log in to view" situation (they're already logged in). We only
 * raise the gate for viewers who don't own the note.
 */
async function assertNotPrivate(id: string, currentUserId?: string): Promise<void> {
	const noteId = parseInt(id, 10);
	if (isNaN(noteId)) return;

	const [row] = await db
		.select({ isPrivate: noteTable.isPrivate, userId: noteTable.userId })
		.from(noteTable)
		.where(and(eq(noteTable.id, noteId), isNull(noteTable.deletedAt)));

	if (row?.isPrivate && row.userId !== currentUserId) {
		throw error(403, 'PRIVATE_NOTE');
	}
}

export const load: PageServerLoad = async ({ params, fetch, url, locals }) => {
	try {
		const showDiffs = url.searchParams.get('diffs') === 'true';

		// Forward the viewer's session to the API so a logged-in owner can load
		// their own private note (the API hides private notes from anonymous calls).
		const res = await fetch(`${config.apiUrl}/notes/${params.id}?parse=markdown`, {
			headers: locals.session ? { Authorization: `Bearer ${locals.session.id}` } : {}
		});

		if (!res.ok) {
			// The public API hides a private note's existence, but it may signal that
			// with any non-OK status (404, 401, 403, …). Whatever it returned, first
			// check the DB directly: a live private note becomes a 403 "log in" gate
			// (unless the viewer owns it).
			await assertNotPrivate(params.id, locals.user?.id);
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

		let versions = null;
		if (showDiffs && note?.frontmatter?.mdpubs) {
			const versionsRes = await fetch(
				`${config.apiUrl}/notes/${note.frontmatter.mdpubs}/versions?diffs=true`,
				{ headers: locals.session ? { Authorization: `Bearer ${locals.session.id}` } : {} }
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
		// Re-throw SvelteKit errors (incl. the 403 private-note gate) untouched.
		if (e && typeof e === 'object' && 'status' in e) {
			throw e;
		}
		throw error(500, 'Network error occurred');
	}
};
