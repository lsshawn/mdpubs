/**
 * /api/notes/[id] — get (GET), update (PUT), delete (DELETE).
 * [id] is the public nanoid. Native port of the old Hono `/notes/:id` routes,
 * preserving the ?version / ?parse=markdown / ?only=frontmatter behaviour.
 */
import { type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { requireApiAuth, optionalApiAuth, isAuthError } from '#lib/server/api/auth.js';
import {
	parseNoteBody,
	resolveNoteId,
	UploadTooLargeError,
	BadRequestError
} from '#lib/server/api/http.js';
import {
	NoteService,
	InvalidFrontmatterError,
	InvalidAccountError
} from '#lib/server/api/services/note.js';
import { signService } from '#lib/server/api/services/sign.js';
import { NotFoundError, NoteNotOwnedError, NoteLockedError } from '#lib/server/api/db.js';
import { env } from 'cloudflare:workers';

const noteService = new NoteService();

const notFound = () => Response.json({ error: 'Note not found' }, { status: 404 });
const notFoundOrPrivate = () =>
	Response.json(
		{ error: "Note not found, doesn't belong to you, or is not public." },
		{ status: 404 }
	);

const updateNoteSchema = z.object({
	title: z.string().min(1, 'Title is required').optional(),
	content: z.string().optional(),
	file_extension: z.string().optional(),
	tags: z.array(z.string()).optional(),
	isPrivate: z.boolean().optional()
});

// GET /api/notes/[id]
export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	const { isAdmin, user } = auth;
	const url = event.url;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();

		const parseMarkdown =
			url.searchParams.get('parse') === 'markdown' || url.searchParams.get('format') === 'markdown';
		const versionParam = url.searchParams.get('version');
		const only = url.searchParams.get('only');

		if (versionParam) {
			const version = parseInt(versionParam);
			if (isNaN(version))
				return Response.json({ error: 'Invalid version parameter' }, { status: 400 });

			const noteVersion = isAdmin
				? await noteService.getNoteVersionAdmin(noteId, version)
				: await noteService.getNoteVersion(noteId, version, user?.id);

			if (
				(parseMarkdown || only === 'frontmatter') &&
				(noteVersion.fileExtension === '' ||
					noteService.isMarkdownFile(noteVersion.fileExtension || undefined))
			) {
				const mainNote = isAdmin
					? await noteService.getNoteByIdAdmin(noteId)
					: await noteService.getNoteById(noteId, user?.id);
				const { frontmatter, markdownBody, html } = noteService.parseMarkdownContent(
					noteVersion.content || '',
					mainNote.imageMap
				);
				if (only === 'frontmatter') return Response.json(frontmatter);
				return Response.json({ ...noteVersion, frontmatter, markdownBody, html });
			}
			return Response.json(noteVersion);
		}

		// Current version. Signable private notes are reachable via link (so signers
		// can view) — getNoteForSigning applies that rule, else the privacy gate.
		const note = isAdmin
			? await noteService.getNoteByIdAdmin(noteId)
			: await signService.getNoteForSigning(noteId, user?.id);

		if (
			(parseMarkdown || only === 'frontmatter') &&
			(note.fileExtension === '' || noteService.isMarkdownFile(note.fileExtension || undefined))
		) {
			const { frontmatter, markdownBody, html, toc } = noteService.parseMarkdownContent(
				note.content || '',
				note.imageMap
			);
			if (only === 'frontmatter') return Response.json(frontmatter);
			return Response.json({ ...note, frontmatter, markdownBody, toc, html });
		}
		return Response.json(note);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError)
			return notFoundOrPrivate();
		console.error('Error getting note:', error);
		return Response.json({ error: 'Failed to retrieve note' }, { status: 500 });
	}
}

// PUT /api/notes/[id]
export async function PUT(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	const user = auth.user!;
	const bucket = env.BUCKET;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();

		const { payload, files } = await parseNoteBody(event.request);
		const validation = updateNoteSchema.safeParse(payload);
		if (!validation.success) {
			return Response.json(
				{ error: 'Invalid input', issues: validation.error.issues },
				{ status: 400 }
			);
		}

		// ?silent=true — autosave from the web editor: write the note but don't mint a
		// `note_versions` row (see UpdateNoteRequest.skipVersion). Restricted to
		// session auth: an API-key write is a deliberate sync from the nvim plugin or
		// CLI, and those ARE the revision history we want to keep.
		const silent = event.url.searchParams.get('silent') === 'true' && !auth.usedApiKey;

		const updatedNote = await noteService.updateNote(
			bucket,
			noteId,
			user.id,
			{ ...validation.data, files, skipVersion: silent },
			user.defaultOrgId
		);
		return Response.json(updatedNote);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return Response.json({ error: "Note not found or doesn't belong to you" }, { status: 404 });
		}
		if (error instanceof NoteLockedError)
			return Response.json({ error: error.message }, { status: 409 });
		if (error instanceof UploadTooLargeError)
			return Response.json({ error: error.message }, { status: 413 });
		if (error instanceof BadRequestError)
			return Response.json({ error: error.message }, { status: 400 });
		if (error instanceof InvalidFrontmatterError)
			return Response.json({ error: error.message }, { status: 400 });
		if (error instanceof InvalidAccountError)
			return Response.json({ error: error.message }, { status: 403 });
		const message = error instanceof Error ? error.message : '';
		if (message.includes('too large')) return Response.json({ error: message }, { status: 413 });
		console.error('Error updating note:', error);
		return Response.json({ error: 'Failed to update note' }, { status: 500 });
	}
}

// DELETE /api/notes/[id]
export async function DELETE(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	const user = auth.user!;
	const bucket = env.BUCKET;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();

		// ?hard=true permanently deletes the note, its versions/signatures, and its
		// R2 image objects (irreversible). Without it, the note is soft-deleted.
		const hard = event.url.searchParams.get('hard') === 'true';
		if (hard) {
			await noteService.hardDeleteNote(bucket, noteId, user.id);
			return Response.json({ message: 'Note permanently deleted' });
		}

		await noteService.deleteNote(bucket, noteId, user.id);
		return Response.json({ message: 'Note deleted successfully' });
	} catch (error) {
		if (error instanceof NotFoundError) {
			return Response.json({ error: "Note not found or doesn't belong to you" }, { status: 404 });
		}
		console.error('Error deleting note:', error);
		return Response.json({ error: 'Failed to delete note' }, { status: 500 });
	}
}
