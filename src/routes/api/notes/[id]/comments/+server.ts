/**
 * /api/notes/[id]/comments — list a note's margin comments (GET) and add one (POST).
 * Open to whoever can read the note; the note's frontmatter decides who may write
 * (see services/comments.ts).
 */
import { type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { loadNote, commentKey, clientIp, fail } from './shared.js';
import { addComment, getCommentsState } from '#lib/server/api/services/comments.js';

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const note = await loadNote(event.params.id, auth);
		const state = await getCommentsState(note, { user: auth.user, key: commentKey(event.request) });
		return Response.json(state, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		return fail(error);
	}
}

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const note = await loadNote(event.params.id, auth);
		const input = await event.request.json().catch(() => null);
		if (!input || typeof input !== 'object') {
			return Response.json({ error: 'Send the comment as JSON.' }, { status: 400 });
		}
		const comment = await addComment(note, { user: auth.user }, input, clientIp(event.request));
		return Response.json(comment, { status: 201 });
	} catch (error) {
		return fail(error);
	}
}
