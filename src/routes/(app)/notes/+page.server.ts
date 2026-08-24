import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { fail, redirect } from '@sveltejs/kit';
import { config } from '$lib/config';
import { and, eq, or, like, sql, isNull, desc, inArray } from 'drizzle-orm';
import { getOrgRole } from '$lib/server/org';
import { deleteFolder } from '$lib/server/storage';
import { renderTitleMarkdown, highlightTitleHtml, highlightText } from '$lib/server/title-markdown';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 20;

/** Longest query we'll run through the body scan; anything more is a paste, not a search. */
const MAX_QUERY_LENGTH = 100;
/** Characters of body text either side of the match in a result snippet. */
const SNIPPET_CONTEXT = 90;

/** Escape LIKE's own wildcards so a literal `%` or `_` matches itself. */
function escapeLike(value: string) {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Strip the parts of a note's markdown that would make a snippet unreadable —
 * frontmatter, fences, markup — down to a single line of prose.
 *
 * Deliberately crude: this is preview text, not a render, and it runs over
 * every matched note on the page. It only needs to be good enough that the
 * matched phrase reads in context.
 */
function toPlainText(content: string) {
	return content
		.replace(/^---\n[\s\S]*?\n---\n?/, '') // YAML frontmatter
		.replace(/```[\s\S]*?```/g, ' ') // fenced code
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
		.replace(/<[^>]+>/g, ' ') // inline HTML
		.replace(/^[>#\-*+\s]+/gm, ' ') // block markers and list bullets
		.replace(/[*_`~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Pull the note's METADATA — YAML frontmatter and the HTML-comment directives
 * an exported doc carries instead — as one flat string.
 *
 * These are the regions `toPlainText` deliberately throws away, and they are
 * where `tags:`, `mdpubs-company:` and friends live. A note can match the SQL
 * on one of those alone, so they have to be searchable separately or the row
 * would show a snippet with nothing highlighted in it.
 */
function extractMetadata(content: string) {
	const lines: string[] = [];

	const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
	if (frontmatter) lines.push(...frontmatter[1].split('\n'));

	// Exported HTML keeps the same keys in comments: <!-- mdpubs-company: x -->
	for (const m of content.matchAll(/<!--([\s\S]*?)-->/g)) lines.push(...m[1].split('\n'));

	// Kept as separate lines, joined with a separator rather than a space: a
	// metadata excerpt is a list of keys, not a sentence, and running them
	// together produced snippets like "mdpubs: aB3xY mdpubs-account: cgpt" that
	// read as one meaningless string.
	//
	// Blank lines, YAML's `---` fences and `#` comments drop out as pure noise,
	// and list items are folded back onto the key above them so a `tags:` match
	// reads "tags: cgpt enetmedi" rather than "tags: · - cgpt · - enetmedi".
	const keys: string[] = [];
	for (const line of lines.map((l) => l.trim())) {
		if (line === '' || line === '---' || line.startsWith('#')) continue;
		if (line.startsWith('- ') && keys.length > 0) keys[keys.length - 1] += ` ${line.slice(2)}`;
		else keys.push(line);
	}
	return keys.join(' · ');
}

/** Where in the note the query was found. Drives what the row shows. */
type SnippetSource = 'body' | 'metadata' | 'title';

/**
 * A ~2-line excerpt centred on the first occurrence of `query`, plus where that
 * occurrence came from.
 *
 * Three outcomes, and the caller needs to tell them apart — a snippet with no
 * visible match is confusing unless the row says why:
 *
 *  - `body`: the ordinary case, excerpt centred on the match.
 *  - `metadata`: matched only in frontmatter/directives (a tag, a company
 *    slug). The excerpt is the matching metadata line, since quoting prose that
 *    doesn't contain the query would be a lie.
 *  - `title`: matched only in the title. Shows the note's opening as context.
 *
 * Returned as plain text; the caller escapes and highlights it.
 */
function buildSnippet(
	content: string | null,
	query: string
): { text: string; source: SnippetSource } | null {
	if (!content) return null;
	const needle = query.toLowerCase();

	const text = toPlainText(content);
	const at = text ? text.toLowerCase().indexOf(needle) : -1;

	if (at !== -1) {
		const start = Math.max(0, at - SNIPPET_CONTEXT);
		const end = Math.min(text.length, at + query.length + SNIPPET_CONTEXT);
		const excerpt = `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
		return { text: excerpt, source: 'body' };
	}

	// Not in the prose — check the regions toPlainText stripped before falling
	// back, so a tags-only or company-only match still shows its match.
	const meta = extractMetadata(content);
	const metaAt = meta.toLowerCase().indexOf(needle);
	if (metaAt !== -1) {
		const start = Math.max(0, metaAt - SNIPPET_CONTEXT);
		const end = Math.min(meta.length, metaAt + query.length + SNIPPET_CONTEXT);
		const excerpt = `${start > 0 ? '…' : ''}${meta.slice(start, end).trim()}${end < meta.length ? '…' : ''}`;
		return { text: excerpt, source: 'metadata' };
	}

	if (!text) return null;
	// Title-only match: the note's opening is the most useful thing to show.
	return {
		text:
			text.length > SNIPPET_CONTEXT * 2 ? `${text.slice(0, SNIPPET_CONTEXT * 2).trimEnd()}…` : text,
		source: 'title'
	};
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		return redirect(302, '/login');
	}

	const page = Number(url.searchParams.get('page') ?? '1');

	/**
	 * Search (`?q=`). Filtering happens in SQL rather than in the component
	 * because the list is paginated — a client-side filter would only ever search
	 * the 20 rows of the current page.
	 *
	 * Title *and* body: `notes.content` holds the note's markdown, so a
	 * case-insensitive LIKE over both is one query. There is no full-text index,
	 * so this is a scan; acceptable because it is always bounded by the workspace
	 * clauses below (one user's notes, or one org's). If libraries grow past a few
	 * thousand notes this is the thing to replace with an FTS5 table.
	 */
	const rawQuery = (url.searchParams.get('q') ?? '').trim();
	const query = rawQuery.slice(0, MAX_QUERY_LENGTH);

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

	if (query) {
		// `lower()` on both sides rather than relying on LIKE's own case folding,
		// which SQLite only applies to ASCII — an accented or non-Latin query would
		// otherwise be case-sensitive.
		const pattern = `%${escapeLike(query.toLowerCase())}%`;
		whereClauses.push(
			or(
				like(sql`lower(${table.note.title})`, sql`${pattern} escape '\\'`),
				like(sql`lower(${table.note.content})`, sql`${pattern} escape '\\'`)
			)!
		);
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

	/**
	 * Which of these notes have signatures, and who signed each slot.
	 *
	 * One query for the whole page rather than per row, and scoped to the 20 ids
	 * actually being rendered — this drives the row's "Signatures" menu, so it
	 * only needs the slots that exist, not the full audit trail.
	 */
	const noteIds = notes.map((n) => n.id);
	const signaturesByNoteId = new Map<
		number,
		{ id: number; signerName: string; signerEmail: string; signerIndex: number }[]
	>();
	if (noteIds.length > 0) {
		const rows = await db
			.select({
				id: table.signature.id,
				noteId: table.signature.noteId,
				signerName: table.signature.signerName,
				signerEmail: table.signature.signerEmail,
				signerIndex: table.signature.signerIndex
			})
			.from(table.signature)
			.where(inArray(table.signature.noteId, noteIds))
			.orderBy(table.signature.signerIndex);
		for (const r of rows) {
			const list = signaturesByNoteId.get(r.noteId) ?? [];
			list.push({
				id: r.id,
				signerName: r.signerName,
				signerEmail: r.signerEmail,
				signerIndex: r.signerIndex
			});
			signaturesByNoteId.set(r.noteId, list);
		}
	}

	const totalNotes = totalNotesResult[0].count;
	const totalPages = Math.ceil(totalNotes / PAGE_SIZE);

	return {
		// `titleHtml` is the title's inline markdown, rendered and allowlisted here
		// rather than in the component: it is injected with {@html}, so it must be
		// produced by the server-side sanitizer and never assembled on the client.
		// The raw `title` stays on the row for aria-labels and confirmation copy.
		//
		// `snippetHtml` is present only while searching — `content` is the whole
		// note body and has no business being shipped to the client for an
		// unfiltered list. Both HTML fields are built here, never on the client:
		// they are injected with {@html}, so escaping is this file's job.
		notes: notes.map(({ content, ...note }) => {
			const titleHtml = renderTitleMarkdown(note.title);
			const snippet = query ? buildSnippet(content, query) : null;
			return {
				...note,
				// Match highlighting is applied AFTER the allowlist pass, so the
				// <mark> tags are ours and a literal <mark> typed into a title is
				// still stripped.
				titleHtml: query ? highlightTitleHtml(titleHtml, query) : titleHtml,
				// Plain text in, HTML out: highlightText escapes the body itself and
				// emits only <mark>, which is what lets this be rendered with {@html}.
				snippetHtml: snippet === null ? null : highlightText(snippet.text, query),
				// Lets the row explain a snippet with no visible match — matched in
				// the title, or only in frontmatter/tags.
				snippetSource: snippet?.source ?? null,
				// Empty for the overwhelming majority of notes; a non-empty list is
				// what makes the row's Signatures menu appear.
				signatures: signaturesByNoteId.get(note.id) ?? []
			};
		}),
		query,
		currentPage: page,
		totalPages,
		totalNotes,
		activeOrg
	};
};

export const actions: Actions = {
	/**
	 * Create an empty note and redirect straight into the editor.
	 *
	 * Goes through NoteService.createNote (rather than a bare insert) so the free
	 * plan's note limit, publicId generation, and `mdpubs-company` org resolution
	 * all behave exactly as they do for an nvim sync. The starter body carries a
	 * `title:` frontmatter key because that is what the store reads the title back
	 * from on every update.
	 */
	create: async ({ locals, url, platform }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const bucket = platform?.env?.BUCKET;
		if (!bucket) {
			return fail(500, { message: 'Storage is not configured' });
		}

		// Create it in whichever workspace the sidebar is currently showing, so a
		// note started from a company view is filed there.
		const orgSlug = url.searchParams.get('org');
		let org: { slug: string } | null = null;
		if (orgSlug) {
			const [row] = await db
				.select({ slug: table.organization.slug })
				.from(table.orgMember)
				.innerJoin(table.organization, eq(table.orgMember.orgId, table.organization.id))
				.where(
					and(
						eq(table.orgMember.userId, locals.user.id),
						eq(table.organization.slug, orgSlug.toLowerCase())
					)
				)
				.limit(1);
			org = row ?? null;
		}

		const frontmatter = [
			'---',
			'title: Untitled',
			...(org ? [`mdpubs-company: ${org.slug}`] : []),
			'---',
			'',
			''
		].join('\n');

		let created;
		try {
			const { NoteService } = await import('$lib/server/api/services/note');
			created = await new NoteService().createNote(
				bucket,
				locals.user.id,
				locals.user.plan || 'free',
				{ title: 'Untitled', content: frontmatter, file_extension: 'md', tags: [] },
				locals.user.defaultOrgId
			);
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Could not create note';
			return fail(400, { message });
		}

		// Outside the try: SvelteKit signals redirects by throwing, so redirecting
		// inside it would be caught as a creation failure.
		return redirect(303, `/notes/${created.publicId}/edit`);
	},

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

	/**
	 * Bulk re-file. Same rules as `move`, applied per note: membership in the
	 * destination, plus author-only when the destination is Personal. Notes the
	 * caller may not move are skipped rather than failing the whole batch, so one
	 * colleague's note in a selection doesn't block the rest; the count of skips
	 * comes back for the toast.
	 */
	bulkMove: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const publicIds = formData
			.getAll('ids')
			.filter((v): v is string => typeof v === 'string' && v !== '');
		const targetOrgId = formData.get('orgId');

		if (publicIds.length === 0) {
			return fail(400, { message: 'No notes selected' });
		}
		if (typeof targetOrgId !== 'string') {
			return fail(400, { message: 'Invalid destination' });
		}
		const destOrgId = targetOrgId === '' ? null : targetOrgId;

		// Verify the destination once — it's the same for every note in the batch.
		if (destOrgId !== null && !(await getOrgRole(destOrgId, locals.user.id))) {
			return fail(403, { message: 'You are not a member of that company.' });
		}

		const targets = await db
			.select({ id: table.note.id, userId: table.note.userId, orgId: table.note.orgId })
			.from(table.note)
			.where(and(inArray(table.note.publicId, publicIds), isNull(table.note.deletedAt)));

		const movable: number[] = [];
		let skipped = 0;
		for (const target of targets) {
			const isAuthor = target.userId === locals.user.id;
			// Access to the note: author, or a member of its current org.
			if (!isAuthor && (!target.orgId || !(await getOrgRole(target.orgId, locals.user.id)))) {
				skipped++;
				continue;
			}
			// Only the author may pull a note out into Personal.
			if (destOrgId === null && !isAuthor) {
				skipped++;
				continue;
			}
			if (destOrgId === target.orgId) continue; // already there; not a skip
			movable.push(target.id);
		}

		if (movable.length > 0) {
			await db
				.update(table.note)
				.set({ orgId: destOrgId, updatedAt: new Date() })
				.where(inArray(table.note.id, movable));
		}

		return { success: true, moved: movable.length, skipped };
	},

	/**
	 * Bulk delete. `hard=true` purges rows and R2 images; otherwise it's the
	 * restorable soft delete.
	 *
	 * Batched rather than one request per note: ownership is resolved in a single
	 * query and the writes go out as set-based statements, so cost is a handful of
	 * round trips regardless of selection size. Deleting is author-only, matching
	 * noteService.deleteNote/hardDeleteNote — a company library is shared for
	 * reading and moving, but only the author can destroy a note. Notes the caller
	 * doesn't own are skipped, so one such note can't fail the whole batch.
	 */
	bulkDelete: async ({ request, locals, platform }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const publicIds = formData
			.getAll('ids')
			.filter((v): v is string => typeof v === 'string' && v !== '');
		const hard = formData.get('hard') === 'true';

		if (publicIds.length === 0) {
			return fail(400, { message: 'No notes selected' });
		}

		// Soft delete only applies to live notes; a hard delete also works on
		// already-soft-deleted ones, matching hardDeleteNote.
		const scope = [inArray(table.note.publicId, publicIds), eq(table.note.userId, locals.user.id)];
		if (!hard) scope.push(isNull(table.note.deletedAt));

		const targets = await db
			.select({ id: table.note.id })
			.from(table.note)
			.where(and(...scope));

		const ids = targets.map((t) => t.id);
		const skipped = publicIds.length - ids.length;

		if (ids.length === 0) {
			return fail(403, { message: 'None of those notes are yours to delete.' });
		}

		if (!hard) {
			await db.update(table.note).set({ deletedAt: new Date() }).where(inArray(table.note.id, ids));
			return { success: true, deleted: ids.length, failed: skipped, hard };
		}

		// Purge R2 assets first, concurrently — each note's images live under its
		// own prefix. Best-effort, exactly as hardDeleteNote treats it: a storage
		// failure must not leave the rows half-deleted, so log and continue.
		const bucket = platform?.env?.BUCKET;
		if (bucket) {
			await Promise.all(
				ids.map((id) =>
					deleteFolder(bucket, `users/${locals.user!.id}/notes/${id}/`).catch((error) => {
						console.error(`[bulkDelete] Failed to purge R2 objects for note ${id}:`, error);
					})
				)
			);
		}

		// Children first, note rows last — libSQL doesn't enforce the cascade over
		// the remote protocol (see db.hardDeleteNote).
		await db.delete(table.signatureEvent).where(inArray(table.signatureEvent.noteId, ids));
		await db.delete(table.signature).where(inArray(table.signature.noteId, ids));
		await db.delete(table.signatureRequest).where(inArray(table.signatureRequest.noteId, ids));
		await db.delete(table.noteVersion).where(inArray(table.noteVersion.noteId, ids));
		await db.delete(table.note).where(inArray(table.note.id, ids));

		return { success: true, deleted: ids.length, failed: skipped, hard };
	},

	/**
	 * Void signatures on a note so it can be signed again.
	 *
	 * `signerIndex` reopens one slot; omitting it reopens the whole document
	 * (which also unlocks it for editing). See SignService.reopen for why the
	 * signing request survives a single-slot reopen but not a full one.
	 *
	 * Author-only, matching delete: a signed agreement is the author's to
	 * withdraw, not any company-library member's. The reason string is optional
	 * but ends up in the append-only audit trail, so the UI asks for it.
	 */
	reopenSignature: async ({ request, locals, platform }) => {
		if (!locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const publicId = formData.get('id');
		const rawIndex = formData.get('signerIndex');
		const reason = String(formData.get('reason') || '').trim();

		if (typeof publicId !== 'string' || publicId === '') {
			return fail(400, { message: 'Invalid note ID' });
		}

		// '' / absent = reopen for everyone.
		let signerIndex: number | undefined;
		if (typeof rawIndex === 'string' && rawIndex !== '') {
			const parsed = Number(rawIndex);
			if (!Number.isInteger(parsed) || parsed < 0) {
				return fail(400, { message: 'Invalid signer' });
			}
			signerIndex = parsed;
		}

		const [target] = await db
			.select()
			.from(table.note)
			.where(and(eq(table.note.publicId, publicId), isNull(table.note.deletedAt)))
			.limit(1);

		if (!target) {
			return fail(404, { message: 'Note not found' });
		}
		if (target.userId !== locals.user.id) {
			return fail(403, { message: 'Only the note’s author can reopen signing.' });
		}

		const { signService, SignError } = await import('$lib/server/api/services/sign');
		try {
			const { voided } = await signService.reopen({
				note: target,
				signerIndex,
				reason: reason || undefined,
				actorEmail: locals.user.email ?? undefined,
				// Purges the voided marks from storage. Optional — a missing binding
				// just leaves them orphaned rather than failing the reopen.
				bucket: platform?.env?.BUCKET
			});
			return { success: true, reopened: voided, all: signerIndex === undefined };
		} catch (e) {
			// SignError carries a message written for the signer/owner; anything else
			// is ours and shouldn't leak.
			if (e instanceof SignError) return fail(400, { message: e.message });
			console.error('[reopenSignature]', e);
			return fail(500, { message: 'Could not reopen signing for this note.' });
		}
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
