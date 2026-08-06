/**
 * POST /api/notes/[id]/assets — upload one image/video for the web editor.
 *
 * Exists so paste/drop can insert a working `![](url)` immediately, instead of
 * waiting for the next save to carry the bytes. The nvim sync path still posts
 * files alongside the note body (see parseNoteBody + uploadAndMapFiles); this is
 * the interactive equivalent for a single file.
 *
 * Why the returned URL is inserted directly into the markdown, rather than a
 * local filename that resolves through `imageMap`:
 *
 *   The editor autosaves on a debounce, so an upload can land while a save is
 *   already in flight. If the markdown referenced a bare local name, whichever
 *   write finished last would decide whether the map entry survived, and a lost
 *   entry renders as a broken image. An absolute URL in the body needs no map
 *   entry to resolve, so paste can never race save.
 *
 * We still record the entry in the `imageMap` column, because that column is
 * what note deletion (deleteFolder/deleteFiles) and the R2 orphan cleanup in
 * updateNote use to decide which objects belong to this note.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { requireApiAuth, isAuthError } from '$lib/server/api/auth';
import { resolveNoteId } from '$lib/server/api/http';
import { NoteService } from '$lib/server/api/services/note';
import { database, NotFoundError, NoteNotOwnedError } from '$lib/server/api/db';
import { uploadFile, MAX_FILE_BYTES } from '$lib/server/storage';

const noteService = new NoteService();

/**
 * What the editor is allowed to paste/drop. Deliberately a allowlist of types
 * that render in a browser via <img>/<video> — an arbitrary binary would upload
 * fine but produce a dead reference in the note.
 */
const ALLOWED_PREFIXES = ['image/', 'video/'];
const ALLOWED_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/avif',
	'image/svg+xml',
	'video/mp4',
	'video/webm',
	'video/ogg',
	'video/quicktime'
]);

/** Filesystem-safe, collision-resistant name. fileKey() hashes it for the key. */
function safeName(name: string, contentType: string): string {
	const cleaned = (name || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
	if (cleaned && /\.[a-z0-9]+$/i.test(cleaned)) return cleaned;
	// No usable extension — derive one from the MIME type so the <video>/<img>
	// renderer detection (which keys off the path extension) still works.
	const ext = contentType.split('/')[1]?.split('+')[0] || 'bin';
	const base = cleaned || 'pasted';
	return `${base}.${ext === 'quicktime' ? 'mov' : ext}`;
}

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	const user = auth.user;
	if (!user) return json({ error: 'Upload requires a user session' }, { status: 403 });
	if (auth.isReadOnly) {
		return json({ error: 'Read-only API key cannot upload' }, { status: 403 });
	}

	const bucket = event.platform?.env?.BUCKET;
	if (!bucket) {
		return json({ error: 'Storage is not configured' }, { status: 500 });
	}

	try {
		const noteId = await resolveNoteId(event.params.id);
		if (noteId === null) return json({ error: 'Note not found' }, { status: 404 });

		// Throws NotFoundError for a missing/deleted note, handled below.
		const existing = await noteService.getNoteByIdAdmin(noteId);
		if (existing.userId !== user.id) {
			return json({ error: "Note not found or doesn't belong to you" }, { status: 404 });
		}

		const form = await event.request.formData();
		const file = form.get('file');
		if (!(file instanceof File)) {
			return json({ error: 'Expected a `file` field' }, { status: 400 });
		}

		const contentType = file.type || 'application/octet-stream';
		const allowed =
			ALLOWED_TYPES.has(contentType) || ALLOWED_PREFIXES.some((p) => contentType.startsWith(p));
		if (!allowed) {
			return json({ error: `Unsupported file type: ${contentType}` }, { status: 415 });
		}
		if (file.size > MAX_FILE_BYTES) {
			const mb = (file.size / (1024 * 1024)).toFixed(1);
			const max = MAX_FILE_BYTES / (1024 * 1024);
			return json({ error: `File is too large (${mb}MB). Max ${max}MB.` }, { status: 413 });
		}

		const name = safeName(file.name, contentType);
		const result = await uploadFile(
			bucket,
			user.id,
			noteId,
			name,
			await file.arrayBuffer(),
			contentType
		);

		if (!result.success) {
			return json({ error: result.error || 'Upload failed' }, { status: 500 });
		}

		// Record ownership of the object so cleanup paths can find it. Merge rather
		// than replace: a concurrent autosave may have just rewritten this column.
		const currentMap = (existing.imageMap || {}) as Record<string, string>;
		await database.updateNote(noteId, {
			imageMap: { ...currentMap, [name]: result.url }
		});

		return json({
			url: result.url,
			name,
			size: result.size,
			kind: contentType.startsWith('video/') ? 'video' : 'image'
		});
	} catch (error) {
		if (error instanceof NotFoundError || error instanceof NoteNotOwnedError) {
			return json({ error: 'Note not found' }, { status: 404 });
		}
		console.error('Error uploading note asset:', error);
		return json({ error: 'Failed to upload file' }, { status: 500 });
	}
}
