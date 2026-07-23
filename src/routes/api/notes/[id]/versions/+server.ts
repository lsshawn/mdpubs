/**
 * /api/notes/[id]/versions — version history (optionally with diffs). Native port
 * of the old Hono `/notes/:id/versions`.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { NoteService } from '$lib/server/api/services/note';
import { NotFoundError, NoteNotOwnedError } from '$lib/server/api/db';

const noteService = new NoteService();

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	const { isAdmin, user } = auth;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return json({ error: 'Note not found' }, { status: 404 });

		const withDiffs = event.url.searchParams.get('diffs') === 'true';
		const limitParam = event.url.searchParams.get('limit');

		let limit: number | undefined;
		if (limitParam) {
			limit = parseInt(limitParam);
			if (isNaN(limit)) return json({ error: 'Invalid limit parameter' }, { status: 400 });
		} else if (withDiffs) {
			limit = 10;
		}

		let versions;
		if (withDiffs) {
			versions = isAdmin
				? await noteService.getNoteVersionsWithDiffsAdmin(noteId, limit)
				: await noteService.getNoteVersionsWithDiffs(noteId, user?.id, limit);
		} else {
			versions = isAdmin
				? await noteService.getNoteVersionsAdmin(noteId)
				: await noteService.getNoteVersions(noteId, user?.id);
			if (limit) versions = versions.slice(0, limit);
		}

		return json({ versions, count: versions.length });
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return json({ error: "Note not found, doesn't belong to you, or is not public." }, { status: 404 });
		}
		console.error('Error getting note versions:', error);
		return json({ error: 'Failed to retrieve note versions' }, { status: 500 });
	}
}
