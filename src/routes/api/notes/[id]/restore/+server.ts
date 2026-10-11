/**
 * /api/notes/[id]/restore — undelete a soft-deleted note. Native port of the old
 * Hono `POST /notes/:id/restore`.
 */
import { type RequestEvent } from '@sveltejs/kit';
import { requireApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { resolveNoteId } from '#lib/server/api/http.js';
import { NoteService } from '#lib/server/api/services/note.js';
import { NotFoundError } from '#lib/server/api/db.js';

const noteService = new NoteService();

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return Response.json({ error: 'Note not found' }, { status: 404 });

		await noteService.restoreNote(noteId, auth.user!.id);
		return Response.json({ message: 'Note restored successfully' });
	} catch (error) {
		if (error instanceof NotFoundError) {
			return Response.json({ error: "Note not found or doesn't belong to you" }, { status: 404 });
		}
		console.error('Error restoring note:', error);
		return Response.json({ error: 'Failed to restore note' }, { status: 500 });
	}
}
