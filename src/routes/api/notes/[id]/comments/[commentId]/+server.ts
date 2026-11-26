/**
 * /api/notes/[id]/comments/[commentId] — resolve or reopen a thread (PATCH, the
 * note's owner) and delete a comment (DELETE, its writer or the owner).
 */
import { type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { loadNote, commentKey, fail } from '../shared.js';
import { deleteComment, updateComment } from '#lib/server/api/services/comments.js';

export async function PATCH(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const note = await loadNote(event.params.id, auth);
		const input = await event.request.json().catch(() => null);
		if (!input || typeof input !== 'object') {
			return Response.json({ error: 'Send the change as JSON.' }, { status: 400 });
		}
		await updateComment(note, { user: auth.user }, event.params.commentId!, input);
		return Response.json({ ok: true });
	} catch (error) {
		return fail(error);
	}
}

export async function DELETE(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const note = await loadNote(event.params.id, auth);
		await deleteComment(
			note,
			{ user: auth.user, key: commentKey(event.request) },
			event.params.commentId!
		);
		return Response.json({ ok: true });
	} catch (error) {
		return fail(error);
	}
}
