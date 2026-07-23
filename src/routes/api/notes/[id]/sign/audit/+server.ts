/**
 * /api/notes/[id]/sign/audit — the append-only signing event log. IP / location /
 * user-agent are owner-only; other viewers get them redacted. Native port of the
 * old Hono `/notes/:id/sign/audit`.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { NoteService } from '$lib/server/api/services/note';
import { signService } from '$lib/server/api/services/sign';
import { database, NotFoundError, NoteNotOwnedError } from '$lib/server/api/db';

const noteService = new NoteService();

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	const { isAdmin, user } = auth;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return json({ error: 'Note not found' }, { status: 404 });

		const note = isAdmin
			? await noteService.getNoteByIdAdmin(noteId)
			: await signService.getNoteForSigning(noteId, user?.id);

		const isOwner = isAdmin || (!!user && note.userId === user.id);
		const events = await database.getSignatureEvents(noteId);
		const view = events.map((e) => ({
			action: e.action,
			signerEmail: e.signerEmail,
			contentHash: e.contentHash,
			detail: e.detail,
			createdAt: e.createdAt,
			// Sensitive fields: owner-only.
			ipAddress: isOwner ? e.ipAddress : null,
			location: isOwner ? e.location : null,
			userAgent: isOwner ? e.userAgent : null
		}));
		return json({ events: view, isOwner });
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return json({ error: "Note not found, doesn't belong to you, or is not public." }, { status: 404 });
		}
		console.error('Error getting sign audit trail:', error);
		return json({ error: 'Failed to get audit trail' }, { status: 500 });
	}
}
