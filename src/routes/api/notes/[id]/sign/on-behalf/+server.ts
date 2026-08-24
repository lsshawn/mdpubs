/**
 * POST /api/notes/[id]/sign/on-behalf — the note's author applies a signature
 * for a signer from an image that signer supplied out-of-band (an emailed scan,
 * a photo of a wet signature).
 *
 * Owner-only, and separate from the public signing endpoint on purpose: the
 * signature it writes carries a DIFFERENT claim. A row created here records
 * that the signer provided the image and the owner applied it, with the
 * provenance text and applier's identity in the audit trail, and with no signer
 * IP/user-agent (there was no signer request to attribute).
 *
 * This is the supported answer to "the stored signature image is wrong".
 * Overwriting the R2 object behind an existing signature would leave the trail
 * asserting the signer drew a mark they never drew — so the flow is: reopen the
 * slot (voiding the bad signature, recorded), then apply the real one here.
 *
 * multipart/form-data: `signerIndex`, `signature` (PNG), `provenance`, and
 * optionally `name`/`email` (open slots) and `field:*`.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { requireApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { config } from '$lib/server/api/config';
import { signService, SignError } from '$lib/server/api/services/sign';
import { database, NotFoundError } from '$lib/server/api/db';

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	if (auth.isReadOnly) {
		return json({ error: 'This API key is read-only.' }, { status: 403 });
	}
	const bucket = event.platform!.env.BUCKET;
	const req = event.request;

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return json({ error: 'Note not found' }, { status: 404 });

		const contentType = req.headers.get('content-type') || '';
		if (!contentType.includes('multipart/form-data')) {
			return json({ error: 'This endpoint requires multipart/form-data.' }, { status: 400 });
		}

		const note = await database.getNoteById(noteId);
		if (!note || note.deletedAt) return json({ error: 'Note not found' }, { status: 404 });
		// Author-only. Admin keys are allowed through for support use; a company
		// colleague is not — applying a signature for someone else is the author's
		// call alone.
		if (!auth.isAdmin && note.userId !== auth.user?.id) {
			return json({ error: 'Only the note’s author can apply a signature.' }, { status: 403 });
		}

		const formData = await req.formData();
		const provenance = String(formData.get('provenance') || '').trim();
		if (!provenance) {
			return json(
				{ error: 'A `provenance` note is required — record how the signer supplied this image.' },
				{ status: 400 }
			);
		}

		// An admin key has no user attached, so it cannot name the applier by itself.
		// Require it explicitly rather than recording a useless "admin key" in a
		// trail whose purpose is to say who applied the signature.
		const appliedByField = String(formData.get('appliedBy') || '').trim();
		if (auth.isAdmin && !appliedByField) {
			return json(
				{ error: 'An `appliedBy` field is required when using an admin key.' },
				{ status: 400 }
			);
		}

		const rawIndex = String(formData.get('signerIndex') ?? '');
		const signerIndex = Number(rawIndex);
		if (!Number.isInteger(signerIndex) || signerIndex < 0) {
			return json({ error: 'A valid `signerIndex` is required.' }, { status: 400 });
		}

		const sigValue = formData.get('signature');
		if (
			!sigValue ||
			typeof sigValue !== 'object' ||
			typeof (sigValue as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
		) {
			return json({ error: 'A signature image is required.' }, { status: 400 });
		}
		const sigFile = sigValue as unknown as File;
		if (sigFile.size > config.limits.fileSize.bytes) {
			return json({ error: 'Signature image is too large.' }, { status: 413 });
		}

		const fieldValues: Record<string, string> = {};
		for (const [key, value] of formData.entries()) {
			if (key.startsWith('field:') && typeof value === 'string') {
				fieldValues[key.slice('field:'.length)] = value;
			}
		}

		let state = await signService.applyOnBehalf({
			bucket,
			note,
			signerIndex,
			signatureImagePng: await sigFile.arrayBuffer(),
			provenance,
			appliedBy: auth.user?.email || `${appliedByField} (via admin key)`,
			name: String(formData.get('name') || '').trim() || undefined,
			email: String(formData.get('email') || '').trim() || undefined,
			fieldValues,
			ipAddress:
				req.headers.get('cf-connecting-ip') ||
				req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
				undefined,
			userAgent: req.headers.get('user-agent') || undefined
		});
		state = await signService.withSignatureImageUrls(note, state);
		return json(state);
	} catch (error) {
		if (error instanceof SignError) return json({ error: error.message }, { status: 400 });
		if (error instanceof NotFoundError) return json({ error: 'Note not found' }, { status: 404 });
		console.error('Error applying signature on behalf:', error);
		return json({ error: 'Failed to apply the signature' }, { status: 500 });
	}
}
