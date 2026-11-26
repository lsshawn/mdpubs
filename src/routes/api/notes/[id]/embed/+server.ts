/**
 * POST /api/notes/[id]/embed — a short-lived token for showing this note inside
 * another app (see src/lib/server/embed.ts). Called by that app's server with
 * its API key; never from a browser.
 *
 * Body: { viewer: { id, name }, comments?: boolean, history?: boolean, ttl?: seconds }
 * Returns: { token, url, expiresAt }
 */
import { type RequestEvent } from '@sveltejs/kit';
import { requireApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { resolveNoteId } from '#lib/server/api/http.js';
import { NoteService } from '#lib/server/api/services/note.js';
import { NotFoundError } from '#lib/server/api/db.js';
import { canManageNote } from '#lib/server/org.js';
import { mintEmbedToken, type EmbedRequest } from '#lib/server/embed.js';

const noteService = new NoteService();
const notFound = () =>
	Response.json({ error: "Note not found, or it doesn't belong to you." }, { status: 404 });

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();
		const note = await noteService.getNoteByIdAdmin(noteId);
		if (!note || note.deletedAt) return notFound();
		if (!auth.isAdmin && !(await canManageNote(note, auth.user!.id))) return notFound();

		const input = ((await event.request.json().catch(() => null)) ?? {}) as EmbedRequest;
		const made = await mintEmbedToken(note.publicId, note.userId, input);
		if ('error' in made) return Response.json({ error: made.error }, { status: 400 });
		return Response.json(
			{
				...made,
				// The frame page: an outline at once, then the note (routes/embed/[id]).
				url: `${event.url.origin}/embed/${note.publicId}?embed=${encodeURIComponent(made.token)}`
			},
			{ headers: { 'cache-control': 'private, no-store' } }
		);
	} catch (error) {
		if (error instanceof NotFoundError) return notFound();
		console.error('Embed token error:', error);
		return Response.json({ error: 'Could not make the embed link.' }, { status: 500 });
	}
}
