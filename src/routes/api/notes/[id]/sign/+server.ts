/**
 * /api/notes/[id]/sign — signing state (GET), sign a document (POST), and clear
 * signatures (DELETE).
 * Native port of the old Hono `/notes/:id/sign`. Public but privacy-respecting;
 * signing is multipart with `name`, `email`, `signature` (PNG), and `field:*`.
 */
import { type RequestEvent } from '@sveltejs/kit';
import { optionalApiAuth, requireApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { resolveNoteId } from '#lib/server/api/http.js';
import { config } from '#lib/server/api/config.js';
import { NoteService } from '#lib/server/api/services/note.js';
import { signService, SignError } from '#lib/server/api/services/sign.js';
import { database, NotFoundError, NoteNotOwnedError } from '#lib/server/api/db.js';
import { canReopenSigning } from '#lib/server/org.js';
import { env } from 'cloudflare:workers';

const noteService = new NoteService();

const notFound = () => Response.json({ error: 'Note not found' }, { status: 404 });
const notFoundOrPrivate = () =>
	Response.json(
		{ error: "Note not found, doesn't belong to you, or is not public." },
		{ status: 404 }
	);

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
		return Response.json(state);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError)
			return notFoundOrPrivate();
		console.error('Error getting sign state:', error);
		return Response.json({ error: 'Failed to get signing status' }, { status: 500 });
	}
}

// POST /api/notes/[id]/sign — record a signature (multipart/form-data).
export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await optionalApiAuth(event);
	if (isAuthError(auth)) return auth;
	const bucket = env.BUCKET;
	const req = event.request;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();

		const contentType = req.headers.get('content-type') || '';
		if (!contentType.includes('multipart/form-data')) {
			return Response.json(
				{ error: 'Signing requires a multipart/form-data request.' },
				{ status: 400 }
			);
		}

		const formData = await req.formData();
		const name = String(formData.get('name') || '').trim();
		const email = String(formData.get('email') || '').trim();
		const sigValue = formData.get('signature');
		const rawIndex = formData.get('signerIndex');
		const signerIndex =
			typeof rawIndex === 'string' && rawIndex.trim() !== '' ? Number(rawIndex) : undefined;

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
			return Response.json({ error: 'A drawn signature image is required.' }, { status: 400 });
		}
		const sigFile = sigValue as unknown as File;
		if (sigFile.size > config.limits.fileSize.bytes) {
			return Response.json({ error: 'Signature image is too large.' }, { status: 413 });
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
			signerIndex,
			fieldValues,
			ipAddress,
			location,
			userAgent
		});
		state = await signService.withSignatureImageUrls(note, state);
		return Response.json(state);
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError)
			return notFoundOrPrivate();
		if (error instanceof SignError) return Response.json({ error: error.message }, { status: 409 });
		console.error('Error signing note:', error);
		return Response.json({ error: 'Failed to sign document' }, { status: 500 });
	}
}

/**
 * DELETE /api/notes/[id]/sign?signerIndex=N&reason=… — clear signatures so the
 * slot can be signed again. The API twin of the reopen action on /notes, for
 * agents and the CLI.
 *
 * `signerIndex` clears one slot and the body stays locked; leaving it out clears
 * every signature and unlocks the note. `reason` is required because it is the
 * only record in the append-only audit trail of why a signature was withdrawn.
 *
 * The note's author, or an owner/admin of its org. Admin keys are allowed for
 * support use and must name who is acting with `appliedBy`.
 */
export async function DELETE(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	if (auth.isReadOnly) {
		return Response.json({ error: 'This API key is read-only.' }, { status: 403 });
	}
	const params = event.url.searchParams;
	const req = event.request;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return notFound();
		const note = await database.getNoteById(noteId);
		if (!note || note.deletedAt) return notFound();
		if (!auth.isAdmin && !(await canReopenSigning(note, auth.user!.id))) {
			return Response.json(
				{ error: 'Only the note’s author or an org owner/admin can clear signatures.' },
				{ status: 403 }
			);
		}

		const reason = (params.get('reason') || '').trim();
		if (!reason) {
			return Response.json(
				{ error: 'A `reason` is required — it is recorded in the audit trail.' },
				{ status: 400 }
			);
		}
		const appliedBy = (params.get('appliedBy') || '').trim();
		if (auth.isAdmin && !appliedBy) {
			return Response.json(
				{ error: 'An `appliedBy` parameter is required when using an admin key.' },
				{ status: 400 }
			);
		}

		// Absent or '' = every signer.
		const rawIndex = params.get('signerIndex');
		let signerIndex: number | undefined;
		if (rawIndex !== null && rawIndex !== '') {
			signerIndex = Number(rawIndex);
			if (!Number.isInteger(signerIndex) || signerIndex < 0) {
				return Response.json({ error: 'Invalid `signerIndex`.' }, { status: 400 });
			}
		}

		const { voided, state } = await signService.reopen({
			note,
			signerIndex,
			reason,
			actorEmail: auth.user?.email || `${appliedBy} (via admin key)`,
			bucket: env.BUCKET,
			ipAddress:
				req.headers.get('cf-connecting-ip') ||
				req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
				undefined,
			userAgent: req.headers.get('user-agent') || undefined
		});
		return Response.json({ voided, state: await signService.withSignatureImageUrls(note, state) });
	} catch (error) {
		if (error instanceof SignError) return Response.json({ error: error.message }, { status: 409 });
		if (error instanceof NotFoundError) return notFound();
		console.error('Error clearing signatures:', error);
		return Response.json({ error: 'Failed to clear signatures' }, { status: 500 });
	}
}
