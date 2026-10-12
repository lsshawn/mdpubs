/**
 * /api/notes — list (GET) and create (POST).
 * Native port of the old Hono `/notes` root routes. Auth, status codes, and JSON
 * shapes match the old API so the nvim plugin and UI work unchanged.
 */
import { type RequestEvent } from '@sveltejs/kit';
import { noteUrl } from '#lib/server/tokens.js';
import { z } from 'zod';
import { requireApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { parseNoteBody, UploadTooLargeError, BadRequestError } from '#lib/server/api/http.js';
import {
	NoteService,
	InvalidFrontmatterError,
	InvalidAccountError
} from '#lib/server/api/services/note.js';
import { NoteLimitReachedError } from '#lib/server/api/db.js';
import { env } from 'cloudflare:workers';

const noteService = new NoteService();

const createNoteSchema = z.object({
	title: z.string().min(1, 'Title is required'),
	content: z.string().optional().default(''),
	file_extension: z.string().optional().default(''),
	tags: z.array(z.string()).optional().default([]),
	isPrivate: z.boolean().optional()
});

// GET /api/notes — all notes for the caller (or all notes for admin key).
export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;

	try {
		if (auth.isAdmin) {
			const notes = await noteService.getAllNotes();
			return Response.json({ notes, count: notes.length, admin: true });
		}
		const notes = await noteService.getNotesByUserId(auth.user!.id);
		return Response.json({ notes, count: notes.length });
	} catch (error) {
		console.error('Error getting notes:', error);
		return Response.json({ error: 'Failed to retrieve notes' }, { status: 500 });
	}
}

// POST /api/notes — create a note (multipart with files, or JSON).
export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	const user = auth.user!;
	const bucket = env.BUCKET;

	try {
		const { payload, files } = await parseNoteBody(event.request);

		const validation = createNoteSchema.safeParse(payload);
		if (!validation.success) {
			return Response.json(
				{ error: 'Invalid input', issues: validation.error.issues },
				{ status: 400 }
			);
		}

		const note = await noteService.createNote(
			bucket,
			user.id,
			user.plan || 'free',
			{ ...validation.data, files },
			user.defaultOrgId
		);
		// `url` is where the client opens it (branded domain if the org has one live).
		return Response.json({ ...note, url: await noteUrl(note, event.url.origin) }, { status: 201 });
	} catch (error) {
		if (error instanceof UploadTooLargeError)
			return Response.json({ error: error.message }, { status: 413 });
		if (error instanceof BadRequestError)
			return Response.json({ error: error.message }, { status: 400 });
		if (error instanceof NoteLimitReachedError) {
			return Response.json(
				{
					error:
						'Note limit reached for free plan. Delete some notes or upgrade your plan at https://mdpubs.com.'
				},
				{ status: 403 }
			);
		}
		if (error instanceof InvalidFrontmatterError)
			return Response.json({ error: error.message }, { status: 400 });
		if (error instanceof InvalidAccountError)
			return Response.json({ error: error.message }, { status: 403 });
		const message = error instanceof Error ? error.message : '';
		if (message.includes('too large')) return Response.json({ error: message }, { status: 413 });
		console.error('Error creating note:', error);
		return Response.json({ error: 'Failed to create note' }, { status: 500 });
	}
}
