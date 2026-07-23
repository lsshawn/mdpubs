/**
 * /api/notes/[id]/diff — unified diff between two versions (?from & ?to), as
 * text/plain. Native port of the old Hono `/notes/:id/diff`.
 */
import { json, text, type RequestEvent } from '@sveltejs/kit';
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

		const fromVersion = parseInt(event.url.searchParams.get('from') || '');
		const toVersion = parseInt(event.url.searchParams.get('to') || '');
		if (isNaN(fromVersion) || isNaN(toVersion)) {
			return json({ error: 'Invalid "from" or "to" version parameter' }, { status: 400 });
		}

		const diff = isAdmin
			? await noteService.getNoteDiffAdmin(noteId, fromVersion, toVersion)
			: await noteService.getNoteDiff(noteId, fromVersion, toVersion, user?.id);

		return text(diff);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return json(
				{ error: "Note/version not found, doesn't belong to you, or is not public." },
				{ status: 404 }
			);
		}
		console.error('Error getting note diff:', error);
		return json({ error: 'Failed to retrieve note diff' }, { status: 500 });
	}
}
