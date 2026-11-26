import { type ApiAuth } from '#lib/server/api/auth.js';
import { resolveNoteId } from '#lib/server/api/http.js';
import { NoteService } from '#lib/server/api/services/note.js';
import { signService } from '#lib/server/api/services/sign.js';
import { CommentError } from '#lib/server/api/services/comments.js';
import { NotFoundError, NoteNotOwnedError } from '#lib/server/api/db.js';
import type { Note } from '#lib/server/db/schema.js';

const noteService = new NoteService();

/** The note behind a public id, if this caller may read it. Same rule as the sign routes. */
export async function loadNote(ref: string | undefined, auth: ApiAuth): Promise<Note> {
	const noteId = await resolveNoteId(ref);
	if (noteId === null) throw new NotFoundError('Note not found');
	return auth.isAdmin
		? await noteService.getNoteByIdAdmin(noteId)
		: await signService.getNoteForSigning(noteId, auth.user?.id);
}

/** The secret a guest's browser keeps so it can delete its own comments. */
export function commentKey(request: Request): string | null {
	return request.headers.get('x-comment-key');
}

export function clientIp(request: Request): string | null {
	return (
		request.headers.get('cf-connecting-ip') ||
		request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
		request.headers.get('x-real-ip') ||
		null
	);
}

export function fail(error: unknown): Response {
	if (error instanceof CommentError) {
		return Response.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
		return Response.json({ error: 'Note not found, or it is not public.' }, { status: 404 });
	}
	console.error('Comments error:', error);
	return Response.json({ error: 'Something went wrong with comments.' }, { status: 500 });
}
