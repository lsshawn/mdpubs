/**
 * /api/notes/deleted — the caller's soft-deleted notes. Native port of the old
 * Hono `/notes/deleted`. This static segment is matched before `[id]`, matching
 * the old route order.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { requireApiAuth, isAuthError } from '$lib/server/api/auth';
import { NoteService } from '$lib/server/api/services/note';

const noteService = new NoteService();

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const notes = await noteService.getDeletedNotesByUserId(auth.user!.id);
		return json({ notes, count: notes.length });
	} catch (error) {
		console.error('Error getting deleted notes:', error);
		return json({ error: 'Failed to retrieve deleted notes' }, { status: 500 });
	}
}
