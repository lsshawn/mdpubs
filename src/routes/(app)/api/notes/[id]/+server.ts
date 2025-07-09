import { json, error, type RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { note } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { marked } from 'marked';

export async function GET({ locals, params, url }: RequestEvent): Promise<Response> {
	if (!locals.user) {
		throw error(401, 'Unauthorized');
	}

	const noteId = parseInt(params.id, 10);
	if (isNaN(noteId)) {
		throw error(400, 'Invalid note ID');
	}

	const [noteData] = await db
		.select()
		.from(note)
		.where(and(eq(note.id, noteId), eq(note.userId, locals.user.id)));

	if (!noteData) {
		throw error(404, 'Note not found');
	}

	let html = '';
	if (url.searchParams.get('parse') === 'markdown' && noteData.content) {
		html = await marked.parse(noteData.content);
	}

	return json({
		...noteData,
		html
	});
}
