/**
 * /api/notes/[id]/comments/[commentId] — resolve or reopen a thread (PATCH, the
 * note's owner), reword a comment (PATCH {body}, its writer), list its earlier
 * wording (GET, its writer or the owner) and delete it (DELETE, its writer or the owner).
 */
import { type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { loadNote, commentKey, clientIp, fail } from '../shared.js';
import {
	deleteComment,
	editComment,
	getCommentEdits,
	updateComment
} from '#lib/server/api/services/comments.js';

export async function PATCH(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const note = await loadNote(event.params.id, auth);
		const input = await event.request.json().catch(() => null);
		if (!input || typeof input !== 'object') {
			return Response.json({ error: 'Send the change as JSON.' }, { status: 400 });
		}
		// A new wording comes from the comment's writer; resolving and re-anchoring from the owner.
		if ('body' in input) {
			const edited = await editComment(
				note,
				{ user: auth.user, key: commentKey(event.request) },
				event.params.commentId!,
				(input as { body: unknown }).body,
				clientIp(event.request)
			);
			return Response.json(edited);
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

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const note = await loadNote(event.params.id, auth);
		const edits = await getCommentEdits(
			note,
			{ user: auth.user, key: commentKey(event.request) },
			event.params.commentId!
		);
		return Response.json({ edits }, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		return fail(error);
	}
}
