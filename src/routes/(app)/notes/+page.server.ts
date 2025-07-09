import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { fail, redirect } from '@sveltejs/kit';
import { config } from '$lib/config';
import { and, eq, sql, isNull, desc } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		return redirect(302, '/login');
	}

	const page = Number(url.searchParams.get('page') ?? '1');
	const searchId = url.searchParams.get('search');

	const whereClauses = [eq(table.note.userId, locals.user.id), isNull(table.note.deletedAt)];
	if (searchId) {
		const id = parseInt(searchId, 10);
		if (!isNaN(id)) {
			whereClauses.push(eq(table.note.id, id));
		}
	}

	const notesQuery = db
		.select()
		.from(table.note)
		.where(and(...whereClauses))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE)
		.orderBy(desc(table.note.updatedAt));

	const countQuery = db
		.select({ count: sql<number>`count(*)` })
		.from(table.note)
		.where(and(...whereClauses));

	const [notes, totalNotesResult] = await Promise.all([notesQuery, countQuery]);

	const totalNotes = totalNotesResult[0].count;
	const totalPages = Math.ceil(totalNotes / PAGE_SIZE);

	return {
		notes,
		currentPage: page,
		totalPages,
		totalNotes,
		search: searchId ?? ''
	};
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		if (!locals.user || !locals?.session?.id) {
			return fail(401, { message: 'Unauthorized' });
		}
		const formData = await request.formData();
		const id = formData.get('id');

		if (typeof id !== 'string') {
			return fail(400, { message: 'Invalid request' });
		}

		const noteId = parseInt(id, 10);
		if (isNaN(noteId)) {
			return fail(400, { message: 'Invalid note ID' });
		}

		try {
			const response = await fetch(`${config.apiUrl}/notes/${noteId}`, {
				method: 'DELETE',
				headers: {
					Authorization: `Bearer ${locals.session.id}`
				}
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const message = errorData.error || `Failed to delete note. Status: ${response.status}`;
				return fail(response.status, { message });
			}

			return { success: true };
		} catch (e) {
			console.error(e);
			return fail(500, { message: 'Could not delete note' });
		}
	}
};
