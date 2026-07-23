/**
 * /api/notes/[id]/sign — signing state (GET) and sign a document (POST).
 * Native port of the old Hono `/notes/:id/sign`. Public but privacy-respecting;
 * signing is multipart with `name`, `email`, `signature` (PNG), and `field:*`.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { config } from '$lib/server/api/config';
import { NoteService } from '$lib/server/api/services/note';
import { signService, SignError } from '$lib/server/api/services/sign';
import { NotFoundError, NoteNotOwnedError } from '$lib/server/api/db';

const noteService = new NoteService();

const notFound = () => json({ error: 'Note not found' }, { status: 404 });
const notFoundOrPrivate = () =>
	json({ error: "Note not found, doesn't belong to you, or is not public." }, { status: 404 });

// GET /api/notes/[id]/sign — signing configuration + progress.
export async function GET(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();

		const note = auth.isAdmin
			? await noteService.getNoteByIdAdmin(noteId)
			: await signService.getNoteForSigning(noteId, auth.user?.id);

		let state = await signService.getState(note);
		state = await signService.withSignatureImageUrls(note, state);
		return json(state);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) return notFoundOrPrivate();
		console.error('Error getting sign state:', error);
		return json({ error: 'Failed to get signing status' }, { status: 500 });
	}
}

// POST /api/notes/[id]/sign — record a signature (multipart/form-data).
export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	const bucket = event.platform!.env.BUCKET;
	const req = event.request;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();

		const contentType = req.headers.get('content-type') || '';
		if (!contentType.includes('multipart/form-data')) {
			return json({ error: 'Signing requires a multipart/form-data request.' }, { status: 400 });
		}

		const formData = await req.formData();
		const name = String(formData.get('name') || '').trim();
		const email = String(formData.get('email') || '').trim();
		const sigValue = formData.get('signature');

		// Custom field values arrive as `field:<Label>` entries.
		const fieldValues: Record<string, string> = {};
		for (const [key, value] of formData.entries()) {
			if (key.startsWith('field:') && typeof value === 'string') {
				fieldValues[key.slice('field:'.length)] = value;
			}
		}

		if (
			!sigValue ||
			typeof sigValue !== 'object' ||
			typeof (sigValue as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
		) {
			return json({ error: 'A drawn signature image is required.' }, { status: 400 });
		}
		const sigFile = sigValue as unknown as File;
		if (sigFile.size > config.limits.fileSize.bytes) {
			return json({ error: 'Signature image is too large.' }, { status: 413 });
		}
		const signatureImagePng = await sigFile.arrayBuffer();

		const note = auth.isAdmin
			? await noteService.getNoteByIdAdmin(noteId)
			: await signService.getNoteForSigning(noteId, auth.user?.id);

		// Best-effort client metadata for the audit trail (Cloudflare geo headers).
		const ipAddress =
			req.headers.get('cf-connecting-ip') ||
			req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
			req.headers.get('x-real-ip') ||
			undefined;
		const userAgent = req.headers.get('user-agent') || undefined;
		const location =
			[
				req.headers.get('cf-ipcity'),
				req.headers.get('cf-region-code') || req.headers.get('cf-region'),
				req.headers.get('cf-ipcountry')
			]
				.map((p) => p?.trim())
				.filter(Boolean)
				.join(', ') || undefined;

		let state = await signService.sign({
			bucket,
			note,
			name,
			email,
			signatureImagePng,
			fieldValues,
			ipAddress,
			location,
			userAgent
		});
		state = await signService.withSignatureImageUrls(note, state);
		return json(state);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) return notFoundOrPrivate();
		if (error instanceof SignError) return json({ error: error.message }, { status: 409 });
		console.error('Error signing note:', error);
		return json({ error: 'Failed to sign document' }, { status: 500 });
	}
}
