import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import { db } from '$lib/server/db';
import { note } from '$lib/server/db/schema';
import { getOrgBySlug } from '$lib/server/org';
import { and, eq, desc, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/**
 * Org landing page. Reached directly at /o/<slug>, or transparently when a
 * request arrives on the org's custom domain (rerouted in hooks.server.ts).
 * Lists the org's public notes, mirroring the /u/[username] view.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { org: slug } = params;

	const org = await getOrgBySlug(slug);
	if (!org) throw error(404, 'Account not found');

	const limit = 10;
	const offset = 0;

	const notesFromDb = await db
		.select({
			id: note.publicId,
			title: note.title,
			updatedAt: note.updatedAt,
			content: note.content,
			tags: note.tags
		})
		.from(note)
		.where(and(eq(note.orgId, org.id), eq(note.isPrivate, false), isNull(note.deletedAt)))
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

		const parsedContent = marked.parse(content, {
			async: false,
			gfm: true,
			breaks: true
		}) as string;
		const plainText = parsedContent
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s\s+/g, ' ')
			.trim();
		const contentSnippet = plainText.substring(0, 200);

		return {
			id: n.id,
			title: n.title,
			updatedAt: n.updatedAt,
			tags: n.tags,
			contentSnippet
		};
	});

	return { notes, org: { slug: org.slug, name: org.name } };
};
