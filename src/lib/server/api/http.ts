/**
 * Shared HTTP helpers for the native `/api/*` note routes: multipart parsing and
 * note-reference resolution. Extracted so create/update share one implementation
 * (mirrors the old Hono routes' inline logic exactly).
 */
import { config } from './config';
import { database } from './db';

export type ParsedNoteBody = {
	payload: Record<string, unknown>;
	files: Record<string, { data: ArrayBuffer; type: string }>;
};

/** Thrown for a too-large uploaded file; caller maps to 413. */
export class UploadTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UploadTooLargeError';
	}
}

/** Thrown for a bad multipart/tags payload; caller maps to 400. */
export class BadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BadRequestError';
	}
}

/**
 * Parse a create/update request body into `{payload, files}`, handling both
 * multipart/form-data (binary uploads from the nvim plugin) and application/json.
 * Coerces `tags` (JSON string → array) and `isPrivate` (string → boolean) exactly
 * as the old routes did.
 */
export async function parseNoteBody(request: Request): Promise<ParsedNoteBody> {
	const contentType = request.headers.get('content-type') || '';
	const files: Record<string, { data: ArrayBuffer; type: string }> = {};

	if (contentType.includes('multipart/form-data')) {
		if (!contentType.includes('boundary=')) {
			throw new BadRequestError(
				'Invalid multipart/form-data request: "boundary" is missing in Content-Type header. If using curl with --form, do not manually set the Content-Type header.'
			);
		}
		const payload: Record<string, unknown> = {};
		const formData = await request.formData();
		for (const [key, value] of formData.entries()) {
			// Duck-type File-like (avoids ReferenceError where File is undefined).
			if (
				typeof value === 'object' &&
				value !== null &&
				typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
			) {
				const file = value as unknown as File;
				if (file.size > 0) {
					if (file.size > config.limits.fileSize.bytes) {
						const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
						throw new UploadTooLargeError(
							`"${file.name}" is too large (${sizeMB}MB). Maximum allowed size is ${config.limits.fileSize.mb}MB.`
						);
					}
					if (file.name) {
						const filePath = file.name.startsWith('/') ? file.name.substring(1) : file.name;
						files[filePath] = { data: await file.arrayBuffer(), type: file.type };
					}
				}
			} else {
				payload[key] = value;
			}
		}
		if (payload.tags && typeof payload.tags === 'string') {
			try {
				payload.tags = JSON.parse(payload.tags);
			} catch {
				throw new BadRequestError('Invalid tags format. Must be a JSON array string.');
			}
		}
		if (typeof payload.isPrivate === 'string') {
			payload.isPrivate = payload.isPrivate === 'true';
		}
		return { payload, files };
	}

	// application/json
	return { payload: await request.json(), files };
}

/**
 * Resolve a route param into the internal numeric note id. References are ALWAYS
 * the unguessable `publicId` (nanoid) — the enumerable autoincrement id is never
 * accepted as an address. Returns null if nothing matches (caller → 404).
 */
export async function resolveNoteId(ref: string | undefined): Promise<number | null> {
	if (!ref) return null;
	const byPublicId = await database.getNoteByPublicId(ref);
	return byPublicId ? byPublicId.id : null;
}
