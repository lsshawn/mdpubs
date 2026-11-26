/**
 * Margin comments on a published markdown note.
 *
 * A note opts in through frontmatter:
 *
 *   mdpubs-comments: true      signed-in MdPubs users can comment
 *   mdpubs-comments: public    anyone can comment; guests give a name
 *   mdpubs-comments-email: optional | required | off   (guests only, default optional)
 *
 * Who can read a note can read its comments. The note's author, and an owner or
 * admin of its org, can resolve and delete any comment and see guest emails.
 */
import matter from 'gray-matter';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	noteComment,
	noteCommentEdit,
	user as userTable,
	type Note,
	type NoteComment,
	type User
} from '#lib/server/db/schema.js';
import { canManageNote } from '#lib/server/org.js';
import { sha256Hex } from '#lib/server/tokens.js';
import { cleanAnchor, type CommentAnchor } from '#lib/helpers/comment-anchor.js';

export type CommentsConfig = {
	enabled: boolean;
	/** People without an MdPubs login may comment. */
	guests: boolean;
	email: 'optional' | 'required' | 'off';
};

export type CommentDto = {
	id: string;
	parentId: string | null;
	anchor: CommentAnchor | null;
	body: string;
	authorName: string;
	/** Same for every comment by one person on this note. Opaque; used to give each person a colour. */
	authorId: string;
	authorPicture: string | null;
	/** Written by the note's author. */
	byOwner: boolean;
	/** Only sent to people who can moderate. */
	authorEmail?: string | null;
	/** The viewer wrote it, so may delete it. */
	mine: boolean;
	resolvedAt: number | null;
	/** When its wording was last changed by its writer; null if never. */
	editedAt: number | null;
	createdAt: number;
};

export type CommentsState = CommentsConfig & {
	canComment: boolean;
	canModerate: boolean;
	/** The signed-in viewer, when there is one. */
	viewer: { name: string; picture: string | null } | null;
	comments: CommentDto[];
};

export class CommentError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.name = 'CommentError';
		this.status = status;
	}
}

const OFF: CommentsConfig = { enabled: false, guests: false, email: 'optional' };
const BODY_MAX = 4000;
const NAME_MAX = 60;
const PER_NOTE_MAX = 2000;
/** One address: at most this many comments on a note per window. */
const RATE_MAX = 12;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseCommentsConfig(note: Pick<Note, 'content' | 'fileExtension'>): CommentsConfig {
	const ext = (note.fileExtension || '').toLowerCase();
	if (ext === 'html' || ext === 'htm') return OFF;
	let data: Record<string, unknown>;
	try {
		data = matter(note.content || '').data;
	} catch {
		return OFF;
	}
	const raw = data['mdpubs-comments'];
	const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
	const guests = mode === 'public' || mode === 'anyone';
	if (!guests && mode !== true && mode !== 'true' && mode !== 'users') return OFF;

	const rawEmail = data['mdpubs-comments-email'];
	const e = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : rawEmail;
	const email =
		e === 'required' || e === true ? 'required' : e === 'off' || e === false ? 'off' : 'optional';
	return { enabled: true, guests, email };
}

function displayName(u: Pick<User, 'name' | 'username' | 'email'>): string {
	return (u.name || u.username || u.email.split('@')[0]).slice(0, NAME_MAX);
}

function millis(d: Date | null): number | null {
	return d ? d.getTime() : null;
}

export type Viewer = { user: User | null; key?: string | null };

async function moderates(note: Note, viewer: Viewer): Promise<boolean> {
	return !!viewer.user && (await canManageNote(note, viewer.user.id));
}

export async function getCommentsState(note: Note, viewer: Viewer): Promise<CommentsState> {
	const config = parseCommentsConfig(note);
	if (!config.enabled) {
		return { ...config, canComment: false, canModerate: false, viewer: null, comments: [] };
	}
	const canModerate = await moderates(note, viewer);
	const keyHash = viewer.key ? sha256Hex(viewer.key) : null;

	const rows = await db
		.select({ c: noteComment, picture: userTable.picture })
		.from(noteComment)
		.leftJoin(userTable, eq(noteComment.userId, userTable.id))
		.where(and(eq(noteComment.noteId, note.id), isNull(noteComment.deletedAt)))
		// created_at is in whole seconds; rowid keeps same-second comments in the order they were posted.
		.orderBy(asc(noteComment.createdAt), sql`${noteComment}.rowid`);

	const edits = await db
		.select({
			commentId: noteCommentEdit.commentId,
			at: sql<number>`max(${noteCommentEdit.createdAt})`
		})
		.from(noteCommentEdit)
		.where(eq(noteCommentEdit.noteId, note.id))
		.groupBy(noteCommentEdit.commentId);
	const editedAt = new Map(edits.map((e) => [e.commentId, new Date(e.at * 1000)]));

	// A reply whose thread was deleted goes with it.
	const roots = new Set(rows.filter((r) => !r.c.parentId).map((r) => r.c.id));
	const comments = rows
		.filter((r) => !r.c.parentId || roots.has(r.c.parentId))
		.map((r) =>
			toDto(r.c, r.picture, note, viewer.user, keyHash, canModerate, editedAt.get(r.c.id) ?? null)
		);

	return {
		...config,
		canComment: config.guests || !!viewer.user,
		canModerate,
		viewer: viewer.user
			? { name: displayName(viewer.user), picture: viewer.user.picture ?? null }
			: null,
		comments
	};
}

function toDto(
	c: NoteComment,
	picture: string | null,
	note: Note,
	user: User | null,
	keyHash: string | null,
	canModerate: boolean,
	editedAt: Date | null = null
): CommentDto {
	const dto: CommentDto = {
		id: c.id,
		parentId: c.parentId,
		anchor: c.anchor as CommentAnchor | null,
		body: c.body,
		authorName: c.authorName,
		authorId: sha256Hex(`${note.id}:${c.userId ?? c.authorKeyHash ?? c.authorName}`).slice(0, 12),
		authorPicture: picture,
		byOwner: !!c.userId && c.userId === note.userId,
		mine:
			(!!user && c.userId === user.id) || (!c.userId && !!keyHash && c.authorKeyHash === keyHash),
		resolvedAt: millis(c.resolvedAt),
		editedAt: millis(editedAt),
		createdAt: c.createdAt.getTime()
	};
	if (canModerate) dto.authorEmail = c.authorEmail;
	return dto;
}

export type NewCommentInput = {
	body?: unknown;
	anchor?: unknown;
	parentId?: unknown;
	name?: unknown;
	email?: unknown;
	key?: unknown;
	/** Honeypot: a field people never see. Bots fill it in. */
	website?: unknown;
};

export async function addComment(
	note: Note,
	viewer: Viewer,
	input: NewCommentInput,
	ipAddress: string | null
): Promise<CommentDto> {
	const config = parseCommentsConfig(note);
	if (!config.enabled) throw new CommentError('Comments are off for this document.', 403);
	if (!viewer.user && !config.guests) {
		throw new CommentError('Log in to comment on this document.', 401);
	}
	if (typeof input.website === 'string' && input.website) {
		throw new CommentError('Could not post the comment.');
	}

	const body = typeof input.body === 'string' ? input.body.trim() : '';
	if (!body) throw new CommentError('Write a comment first.');
	if (body.length > BODY_MAX) {
		throw new CommentError(`Keep the comment under ${BODY_MAX} characters.`);
	}

	let authorName: string;
	let authorEmail: string | null = null;
	let authorKeyHash: string | null = null;
	if (viewer.user) {
		authorName = displayName(viewer.user);
		authorEmail = viewer.user.email;
	} else {
		authorName = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
		if (!authorName) throw new CommentError('Add your name.');
		if (authorName.length > NAME_MAX) throw new CommentError('That name is too long.');
		const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
		if (config.email === 'required' && !email) throw new CommentError('Add your email.');
		if (email && config.email !== 'off') {
			if (email.length > 200 || !EMAIL_RE.test(email)) {
				throw new CommentError('That email does not look right.');
			}
			authorEmail = email;
		}
		if (typeof input.key === 'string' && input.key.length >= 16 && input.key.length <= 200) {
			authorKeyHash = sha256Hex(input.key);
		}
	}

	let parentId: string | null = null;
	let anchor: CommentAnchor | null = null;
	if (typeof input.parentId === 'string' && input.parentId) {
		const [parent] = await db
			.select()
			.from(noteComment)
			.where(
				and(
					eq(noteComment.id, input.parentId),
					eq(noteComment.noteId, note.id),
					isNull(noteComment.deletedAt)
				)
			)
			.limit(1);
		if (!parent) throw new CommentError('That comment was removed.', 404);
		// Threads are one level deep: a reply to a reply joins the same thread.
		parentId = parent.parentId ?? parent.id;
	} else {
		anchor = cleanAnchor(input.anchor);
		if (!anchor) throw new CommentError('Pick a line or select some text to comment on.');
	}

	const [{ total }] = await db
		.select({ total: sql<number>`count(*)` })
		.from(noteComment)
		.where(eq(noteComment.noteId, note.id));
	if (total >= PER_NOTE_MAX) throw new CommentError('This document has too many comments.', 429);

	if (ipAddress) {
		const since = new Date(Date.now() - RATE_WINDOW_MS);
		const who = viewer.user
			? or(eq(noteComment.userId, viewer.user.id), eq(noteComment.ipAddress, ipAddress))
			: eq(noteComment.ipAddress, ipAddress);
		const [{ recent }] = await db
			.select({ recent: sql<number>`count(*)` })
			.from(noteComment)
			.where(and(eq(noteComment.noteId, note.id), gt(noteComment.createdAt, since), who));
		if (recent >= RATE_MAX) {
			throw new CommentError('You are commenting very fast. Try again in a few minutes.', 429);
		}
	}

	const [row] = await db
		.insert(noteComment)
		.values({
			noteId: note.id,
			parentId,
			anchor,
			body,
			userId: viewer.user?.id ?? null,
			authorName,
			authorEmail,
			authorKeyHash,
			ipAddress
		})
		.returning();

	const canModerate = await moderates(note, viewer);
	return toDto(row, viewer.user?.picture ?? null, note, viewer.user, authorKeyHash, canModerate);
}

async function getComment(note: Note, commentId: string): Promise<NoteComment> {
	const [row] = await db
		.select()
		.from(noteComment)
		.where(
			and(
				eq(noteComment.id, commentId),
				eq(noteComment.noteId, note.id),
				isNull(noteComment.deletedAt)
			)
		)
		.limit(1);
	if (!row) throw new CommentError('Comment not found.', 404);
	return row;
}

/**
 * Resolve / reopen a thread, or move its anchor. Moderators only.
 *
 * The anchor update is how a comment keeps up with a document that is edited
 * again and again: when the author's browser finds a comment by a near match,
 * it sends back a fresh description of where the comment is now.
 */
export async function updateComment(
	note: Note,
	viewer: Viewer,
	commentId: string,
	input: { resolved?: unknown; anchor?: unknown }
): Promise<void> {
	if (!(await moderates(note, viewer))) {
		throw new CommentError('Only the document owner can do that.', 403);
	}
	const row = await getComment(note, commentId);
	if (row.parentId) throw new CommentError('Resolve the first comment of the thread.');

	const set: Partial<typeof noteComment.$inferInsert> = {};
	if (typeof input.resolved === 'boolean') {
		set.resolvedAt = input.resolved ? new Date() : null;
		set.resolvedByUserId = input.resolved ? viewer.user!.id : null;
	}
	if (input.anchor !== undefined) {
		const anchor = cleanAnchor(input.anchor);
		if (!anchor) throw new CommentError('Bad anchor.');
		set.anchor = anchor;
	}
	if (!Object.keys(set).length) return;
	await db.update(noteComment).set(set).where(eq(noteComment.id, row.id));
}

/** Delete a comment: its writer, or a moderator. Deleting the first comment removes the thread. */
export async function deleteComment(note: Note, viewer: Viewer, commentId: string): Promise<void> {
	const row = await getComment(note, commentId);
	const keyHash = viewer.key ? sha256Hex(viewer.key) : null;
	const mine =
		(!!viewer.user && row.userId === viewer.user.id) ||
		(!row.userId && !!keyHash && row.authorKeyHash === keyHash);
	if (!mine && !(await moderates(note, viewer))) {
		throw new CommentError('You can only delete your own comments.', 403);
	}
	await db.update(noteComment).set({ deletedAt: new Date() }).where(eq(noteComment.id, row.id));
}

function isMine(row: NoteComment, viewer: Viewer): boolean {
	const keyHash = viewer.key ? sha256Hex(viewer.key) : null;
	return (
		(!!viewer.user && row.userId === viewer.user.id) ||
		(!row.userId && !!keyHash && row.authorKeyHash === keyHash)
	);
}

/**
 * Change a comment's wording. Only its writer may: the owner can resolve or
 * delete someone's comment but never put words in their mouth. The wording
 * before and after goes into note_comment_edits.
 */
export async function editComment(
	note: Note,
	viewer: Viewer,
	commentId: string,
	input: unknown,
	ipAddress: string | null
): Promise<{ body: string; editedAt: number | null }> {
	const row = await getComment(note, commentId);
	if (!isMine(row, viewer)) throw new CommentError('You can only edit your own comments.', 403);
	const body = typeof input === 'string' ? input.trim() : '';
	if (!body) throw new CommentError('Write a comment first.');
	if (body.length > BODY_MAX) {
		throw new CommentError(`Keep the comment under ${BODY_MAX} characters.`);
	}
	if (body === row.body) return { body, editedAt: null };

	const at = new Date();
	// The audit row first: an edit must never land without its record.
	await db.insert(noteCommentEdit).values({
		commentId: row.id,
		noteId: note.id,
		bodyBefore: row.body,
		bodyAfter: body,
		editedByUserId: viewer.user?.id ?? null,
		ipAddress,
		createdAt: at
	});
	await db.update(noteComment).set({ body }).where(eq(noteComment.id, row.id));
	return { body, editedAt: Math.floor(at.getTime() / 1000) * 1000 };
}

export type CommentEditDto = { before: string; after: string; at: number };

/** Every earlier wording of a comment, newest first. For its writer and for moderators. */
export async function getCommentEdits(
	note: Note,
	viewer: Viewer,
	commentId: string
): Promise<CommentEditDto[]> {
	const row = await getComment(note, commentId);
	if (!isMine(row, viewer) && !(await moderates(note, viewer))) {
		throw new CommentError('Only the writer and the document owner can see earlier wording.', 403);
	}
	const rows = await db
		.select()
		.from(noteCommentEdit)
		.where(eq(noteCommentEdit.commentId, row.id))
		.orderBy(desc(noteCommentEdit.createdAt), desc(noteCommentEdit.id));
	return rows.map((r) => ({ before: r.bodyBefore, after: r.bodyAfter, at: r.createdAt.getTime() }));
}
