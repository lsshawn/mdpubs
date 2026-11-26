import { type ApiAuth } from '#lib/server/api/auth.js';
import { resolveNoteId } from '#lib/server/api/http.js';
import { NoteService } from '#lib/server/api/services/note.js';
import { signService } from '#lib/server/api/services/sign.js';
import { CommentError } from '#lib/server/api/services/comments.js';
import { NotFoundError, NoteNotOwnedError } from '#lib/server/api/db.js';
import type { Note } from '#lib/server/db/schema.js';
import { type RequestEvent } from '@sveltejs/kit';
import { type Viewer } from '#lib/server/api/services/comments.js';
import { embedAllows, embedCommentKey, embedTokenOf, readEmbedGrant } from '#lib/server/embed.js';

const noteService = new NoteService();

/** The note behind a public id, if this caller may read it. Same rule as the sign routes. */
export async function loadNote(
	ref: string | undefined,
	auth: ApiAuth,
	readAs?: string
): Promise<Note> {
	const noteId = await resolveNoteId(ref);
	if (noteId === null) throw new NotFoundError('Note not found');
	return auth.isAdmin
		? await noteService.getNoteByIdAdmin(noteId)
		: await signService.getNoteForSigning(noteId, readAs ?? auth.user?.id);
}

/**
 * The note and who is asking. Someone reading through another app's embed
 * (src/lib/server/embed.ts) is a named guest: the name comes from the token,
 * and a key made from their id over there keeps their comments theirs.
 */
export async function access(
	event: RequestEvent,
	auth: ApiAuth
): Promise<{ note: Note; viewer: Viewer }> {
	const token = embedTokenOf(event.request, event.url);
	const read = await readEmbedGrant(token, event.params.id);
	const note = await loadNote(event.params.id, auth, read?.o);
	const grant = embedAllows(read, note);
	// A logged-in mdpubs user (the owner, say) stays themselves inside an embed.
	if (grant && !auth.user) {
		return {
			note,
			viewer: {
				user: null,
				key: embedCommentKey(grant),
				embed: { name: grant.m, comments: grant.c }
			}
		};
	}
	return { note, viewer: { user: auth.user, key: commentKey(event.request) } };
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
