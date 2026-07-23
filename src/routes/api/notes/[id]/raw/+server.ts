/**
 * /api/notes/[id]/raw — serve an HTML pub's body as text/html with a strict CSP,
 * for embedding in the sandboxed iframe on the public view. HTML pubs only;
 * markdown 404s. Native port of the old Hono `/notes/:id/raw`.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { config } from '$lib/server/api/config';
import { NoteService } from '$lib/server/api/services/note';
import { signService } from '$lib/server/api/services/sign';
import { NotFoundError, NoteNotOwnedError } from '$lib/server/api/db';

const noteService = new NoteService();

export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return json({ error: 'Note not found' }, { status: 404 });

		const note = auth.isAdmin
			? await noteService.getNoteByIdAdmin(noteId)
			: await signService.getNoteForSigning(noteId, auth.user?.id);

		if (!noteService.isHtmlFile(note.fileExtension || undefined)) {
			return json({ error: 'Not an HTML pub' }, { status: 404 });
		}

		const body = noteService.stripLeadingFrontmatter(note.content || '');
		let html = noteService.rewriteHtmlAssetUrls(body, note.imageMap);

		const wantPrint = event.url.searchParams.get('print') === '1';
		if (wantPrint) html += `<script>${noteService.PRINT_SCRIPT}</script>`;

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy': noteService.htmlPubCsp(config.htmlPub.frameAncestor, wantPrint),
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer'
			}
		});
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return json({ error: "Note not found, doesn't belong to you, or is not public." }, { status: 404 });
		}
		console.error('Error getting raw HTML pub:', error);
		return json({ error: 'Failed to retrieve pub' }, { status: 500 });
	}
}
