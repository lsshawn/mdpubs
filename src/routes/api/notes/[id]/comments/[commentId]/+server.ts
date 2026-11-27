/**
 * /api/notes/[id]/comments/[commentId] — resolve or reopen a thread (PATCH, the
 * note's owner), reword a comment (PATCH {body}, its writer), list its earlier
 * wording (GET, its writer or the owner) and delete it (DELETE, its writer or the owner).
 */
import { type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { access, clientIp, fail } from '../shared.js';
import {
	deleteComment,
	editComment,
	getCommentEdits,
	updateComment
} from '#lib/server/api/services/comments.js';
import { notifyLive } from '#lib/server/live.js';

export async function PATCH(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const { note, viewer } = await access(event, auth);
		const input = await event.request.json().catch(() => null);
		if (!input || typeof input !== 'object') {
			return Response.json({ error: 'Send the change as JSON.' }, { status: 400 });
		}
		// A new wording comes from the comment's writer; resolving and re-anchoring from the owner.
		if ('body' in input) {
			const edited = await editComment(
				note,
				viewer,
				event.params.commentId!,
				(input as { body: unknown }).body,
				clientIp(event.request)
			);
			notifyLive(event.params.id!, note.content, { t: 'comments' });
			return Response.json(edited);
		}
		await updateComment(note, viewer, event.params.commentId!, input);
		notifyLive(event.params.id!, note.content, { t: 'comments' });
		return Response.json({ ok: true });
	} catch (error) {
		return fail(error);
	}
}

export async function DELETE(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const { note, viewer } = await access(event, auth);
		await deleteComment(note, viewer, event.params.commentId!);
		notifyLive(event.params.id!, note.content, { t: 'comments' });
		return Response.json({ ok: true });
	} catch (error) {
		return fail(error);
	}
}

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const { note, viewer } = await access(event, auth);
		const edits = await getCommentEdits(note, viewer, event.params.commentId!);
		return Response.json({ edits }, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		return fail(error);
	}
}
