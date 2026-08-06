/**
 * Split-pane markdown editor — server data.
 *
 * Loads the note straight from the DB (not through /api) because this page is
 * owner-only by definition: the API's read path deliberately hides private notes
 * and applies signing-link rules that don't apply to editing your own note.
 *
 * `locked` is the important field. Once a note carries a signature its body is
 * frozen (see NoteService.updateNote's lock-on-first-signature check), so a save
 * would 409. The editor uses this to render read-only up front rather than
 * letting someone type a page of changes into a doc that will reject them.
 */
import { error, redirect } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { note as noteTable } from '$lib/server/db/schema';
import { database } from '$lib/server/api/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) {
		return redirect(302, '/login');
	}

	// `params.id` is the unguessable publicId; the enumerable integer id is never
	// a valid public address.
	const [row] = await db
		.select()
		.from(noteTable)
		.where(and(eq(noteTable.publicId, params.id), isNull(noteTable.deletedAt)))
		.limit(1);

	if (!row) {
		throw error(404, 'Note not found');
	}

	// Editing is author-only. A shared company library is readable and movable by
	// any member (see the notes list), but the author owns the text — this matches
	// updateNote, which throws NoteNotOwnedError for anyone else and would reject
	// every save from a non-author editor.
	if (row.userId !== locals.user.id) {
		throw error(404, 'Note not found');
	}

	const locked = await database.noteHasSignatures(row.id);

	return {
		note: {
			publicId: row.publicId,
			title: row.title,
			content: row.content ?? '',
			fileExtension: row.fileExtension,
			version: row.version,
			isPrivate: row.isPrivate,
			tags: row.tags,
			updatedAt: row.updatedAt
		},
		locked
	};
};
