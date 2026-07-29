import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { fail, redirect } from '@sveltejs/kit';
import { config } from '$lib/config';
import { and, eq, sql, isNull, desc } from 'drizzle-orm';
import { getOrgRole } from '$lib/server/org';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 20;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		return redirect(302, '/login');
	}

	const page = Number(url.searchParams.get('page') ?? '1');
	const searchId = url.searchParams.get('search');

	/**
	 * Workspace scoping (sidebar company switcher). `?org=<slug>` shows that
	 * company's notes — every member's, since the whole point of a company account
	 * is a shared library — while no param shows the user's own personal notes
	 * (those with no org).
	 *
	 * Membership is verified here rather than trusting the slug: a non-member (or
	 * unknown slug) silently falls back to Personal, matching the sidebar, which
	 * only ever lists orgs the user belongs to.
	 */
	const orgSlug = url.searchParams.get('org');
	let activeOrg: { id: string; name: string; slug: string } | null = null;
	if (orgSlug) {
		const [row] = await db
			.select({
				id: table.organization.id,
				name: table.organization.name,
				slug: table.organization.slug
			})
			.from(table.orgMember)
			.innerJoin(table.organization, eq(table.orgMember.orgId, table.organization.id))
			.where(
				and(
					eq(table.orgMember.userId, locals.user.id),
					eq(table.organization.slug, orgSlug.toLowerCase())
				)
			)
			.limit(1);
		activeOrg = row ?? null;
	}

	const whereClauses = [isNull(table.note.deletedAt)];
	if (activeOrg) {
		whereClauses.push(eq(table.note.orgId, activeOrg.id));
	} else {
		// Personal: this user's notes that aren't filed under any company.
		whereClauses.push(eq(table.note.userId, locals.user.id), isNull(table.note.orgId));
	}
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
		search: searchId ?? '',
		activeOrg
	};
};

export const actions: Actions = {
	/**
	 * Re-file a note under a different company (or back to Personal).
	 *
	 * This is the UI equivalent of editing `mdpubs-company` frontmatter and
	 * re-syncing, so it enforces the same rule as resolveNoteOrg: the caller must
	 * be a member of the destination org. Access to the note itself is either
	 * ownership or membership in its *current* org — a shared company library is
	 * editable by any member, matching what the notes list already shows them.
	 *
	 * Moving to Personal (`orgId: null`) is only allowed for the note's own author;
	 * otherwise a member could pull a colleague's note out of the shared library
	 * and into their own space.
	 */
	move: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const publicId = formData.get('id');
		const targetOrgId = formData.get('orgId');

		if (typeof publicId !== 'string' || publicId === '') {
			return fail(400, { message: 'Invalid note ID' });
		}
		if (typeof targetOrgId !== 'string') {
			return fail(400, { message: 'Invalid destination' });
		}
		// '' is the Personal option in the select.
		const destOrgId = targetOrgId === '' ? null : targetOrgId;

		const [target] = await db
			.select({ id: table.note.id, userId: table.note.userId, orgId: table.note.orgId })
			.from(table.note)
			.where(and(eq(table.note.publicId, publicId), isNull(table.note.deletedAt)))
			.limit(1);

		if (!target) {
			return fail(404, { message: 'Note not found' });
		}

		const isAuthor = target.userId === locals.user.id;
		if (!isAuthor) {
			if (!target.orgId || !(await getOrgRole(target.orgId, locals.user.id))) {
				return fail(403, { message: 'You do not have access to this note' });
			}
		}

		if (destOrgId === null) {
			if (!isAuthor) {
				return fail(403, { message: 'Only the note’s author can move it to Personal.' });
			}
		} else if (!(await getOrgRole(destOrgId, locals.user.id))) {
			return fail(403, { message: 'You are not a member of that company.' });
		}

		if (destOrgId === target.orgId) {
			return { success: true, moved: false };
		}

		await db
			.update(table.note)
			.set({ orgId: destOrgId, updatedAt: new Date() })
			.where(eq(table.note.id, target.id));

		return { success: true, moved: true };
	},

	delete: async ({ request, locals, fetch }) => {
		if (!locals.user || !locals?.session?.id) {
			return fail(401, { message: 'Unauthorized' });
		}
		const formData = await request.formData();
		// The publicId (nanoid) is the note's public identifier; the external API
		// resolves notes by publicId only, so send it through as-is (no parseInt).
		const publicId = formData.get('id');

		if (typeof publicId !== 'string' || publicId === '') {
			return fail(400, { message: 'Invalid note ID' });
		}

		try {
			const response = await fetch(`${config.apiUrl}/notes/${publicId}`, {
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
	},

	hardDelete: async ({ request, locals, fetch }) => {
		if (!locals.user || !locals?.session?.id) {
			return fail(401, { message: 'Unauthorized' });
		}
		const formData = await request.formData();
		// publicId (nanoid) — the API resolves notes by publicId only (no parseInt).
		const publicId = formData.get('id');

		if (typeof publicId !== 'string' || publicId === '') {
			return fail(400, { message: 'Invalid note ID' });
		}

		try {
			// ?hard=true purges the DB rows AND the note's Cloudflare R2 images.
			const response = await fetch(`${config.apiUrl}/notes/${publicId}?hard=true`, {
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
			return fail(500, { message: 'Could not permanently delete note' });
		}
	}
};
