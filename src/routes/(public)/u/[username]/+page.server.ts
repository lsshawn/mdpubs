import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import { db } from '$lib/server/db';
import { note, user } from '$lib/server/db/schema';
import { and, eq, desc, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { username } = params;

	if (!username) {
		// This case should not be hit with SvelteKit routing, but good for type safety
		throw error(400, 'Username is required');
	}

	const [targetUser] = await db
		.select({
			id: user.id,
			username: user.username
		})
		.from(user)
		.where(eq(user.username, username));

	if (!targetUser) {
		throw error(404, 'User not found');
	}

	const limit = 10;
	const page = 1;
	const offset = (page - 1) * limit;

	const notesFromDb = await db
		.select({
			id: note.id,
			title: note.title,
			updatedAt: note.updatedAt,
			content: note.content,
			tags: note.tags
		})
		.from(note)
		.where(
			and(eq(note.userId, targetUser.id), eq(note.isPrivate, false), isNull(note.deletedAt))
		)
		.orderBy(desc(note.updatedAt))
		.limit(limit)
		.offset(offset);

	const notes = notesFromDb.map((n) => {
		let content = n.content || '';

		if (content.startsWith('---')) {
			const endOfFrontmatter = content.indexOf('---', 3);
			if (endOfFrontmatter > -1) {
				content = content.substring(endOfFrontmatter + 3).trim();
			}
		}

		content = content.replace(/\[TOC\]/gi, '').trim();

		const parsedContent = marked.parse(content, { async: false }) as string;
		const plainText = parsedContent.replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
		const contentSnippet = plainText.substring(0, 200);

		return {
			id: n.id,
			title: n.title,
			updatedAt: n.updatedAt,
			tags: n.tags,
			contentSnippet
		};
	});

	return { notes, username: targetUser.username };
};
