/**
 * POST /api/notes/[id]/preview — render editor content to HTML.
 *
 * The whole point of this endpoint is that the preview pane CANNOT drift from
 * the published page. Rather than reimplementing the render chain client-side
 * (marked + KaTeX + custom components + imageMap rewriting), we run the exact
 * same two steps the public note page runs:
 *
 *   1. NoteService.parseMarkdownContent — frontmatter, imageMap URL rewriting,
 *      video-aware image/link renderer, heading slugs, TOC, KaTeX.
 *   2. parseCustomComponentsInHtml    — ::progress[...] and sign anchors.
 *
 * See src/routes/(public)/[id]/+page.server.ts, which composes them identically.
 * If that chain gains a step, add it here too or the preview starts lying.
 *
 * Content comes from the REQUEST BODY, not the DB, because the editor previews
 * unsaved keystrokes. The note is still resolved and ownership-checked so this
 * can't be used as an anonymous markdown-rendering service, and so the stored
 * imageMap (which lives in the column, not the draft text) can be applied.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { requireApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { NoteService } from '$lib/server/api/services/note';
import { parseCustomComponentsInHtml } from '$lib/helpers/custom-components-parser';
import { NotFoundError, NoteNotOwnedError } from '$lib/server/api/db';

const noteService = new NoteService();

const previewSchema = z.object({
	content: z.string().default('')
});

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	const user = auth.user;
	if (!user) return json({ error: 'Preview requires a user session' }, { status: 403 });

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return json({ error: 'Note not found' }, { status: 404 });

		// Ownership check: previewing arbitrary content against someone else's note
		// would leak their imageMap. Throws NotFoundError for missing/deleted notes,
		// handled below.
		const existing = await noteService.getNoteByIdAdmin(noteId);
		if (existing.userId !== user.id) {
			return json({ error: "Note not found or doesn't belong to you" }, { status: 404 });
		}

		const body = await event.request.json().catch(() => ({}));
		const validation = previewSchema.safeParse(body);
		if (!validation.success) {
			return json({ error: 'Invalid input', issues: validation.error.issues }, { status: 400 });
		}

		const { frontmatter, html, toc } = noteService.parseMarkdownContent(
			validation.data.content,
			existing.imageMap
		);

		return json({
			html: parseCustomComponentsInHtml(html),
			frontmatter,
			toc
		});
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return json({ error: 'Note not found' }, { status: 404 });
		}
		// A malformed frontmatter block is an expected, user-caused condition while
		// typing (e.g. a half-written `---` fence). Report it as a 422 with the
		// message so the pane can show it inline instead of blanking the preview.
		const message = error instanceof Error ? error.message : 'Failed to render preview';
		return json({ error: message }, { status: 422 });
	}
}
