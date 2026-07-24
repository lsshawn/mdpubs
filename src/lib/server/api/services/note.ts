/**
 * Note service — ported from mdpubs-api/src/services/note.ts.
 *
 * Changes from the original:
 *   - Storage: `r2Service.*` (S3 SDK + sharp) is replaced with the binding-based
 *     `$lib/server/storage`. Methods that touch storage take an `R2Bucket`
 *     explicitly (threaded from the route via `c.env.BUCKET`).
 *   - Images are NO LONGER presigned. `imageMap` stores PLAIN PUBLIC URLs.
 *     `convertNoteFilesToPresignedUrls` has been REMOVED and every read path
 *     returns `imageMap` as-is.
 *   - `uploadFile` no longer compresses (no sharp); adapted to the new signature.
 *   - Org resolution uses `$lib/server/org` (destination copy of the rule).
 *   - `db` access goes through `../db` (destination lazy proxy), not process.env.
 *
 * The signing lock (updateNote's body-hash check), stripLeadingFrontmatter, and
 * all content canonicalization are kept BYTE-FAITHFUL.
 */
import {
	database,
	NotFoundError,
	NoteLimitReachedError,
	NoteNotOwnedError,
	NoteLockedError
} from '../db';
import type { Note, NoteVersion } from '$lib/server/db/schema';
import { uploadFile, deleteFiles } from '$lib/server/storage';
import type { R2Bucket } from '@cloudflare/workers-types';
import { config } from '../config';
import { resolveNoteOrg } from '$lib/server/org';
import matter from 'gray-matter';
import { marked } from 'marked';
import GithubSlugger from 'github-slugger';
import * as diff from 'diff';
import { createHash } from 'node:crypto';

export class InvalidFrontmatterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidFrontmatterError';
	}
}

/**
 * Thrown when a note's `mdpubs-company` frontmatter names an org the syncing
 * user can't publish to (unknown slug, or not a member). Surfaced to the client
 * as a 403 so the mistake is visible rather than silently mis-filed.
 */
export class InvalidAccountError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidAccountError';
	}
}

export interface CreateNoteRequest {
	title: string;
	content?: string;
	file_extension?: string;
	tags?: string[];
	isPrivate?: boolean;
	files?: Record<string, { data: ArrayBuffer; type: string }>;
}

export interface UpdateNoteRequest {
	title?: string;
	content?: string;
	file_extension?: string;
	tags?: string[];
	isPrivate?: boolean;
	files?: Record<string, { data: ArrayBuffer; type: string }>;
}

export interface NoteVersionWithDiff extends NoteVersion {
	diff: string;
}

export interface TocItem {
	title: string;
	link: string;
	children: TocItem[];
}

export interface ParsedMarkdownResponse extends Note {
	frontmatter?: Record<string, unknown>;
	markdownBody?: string;
	html?: string;
	toc?: TocItem[];
}

export class NoteService {
	private db = database;

	private async uploadAndMapFiles(
		bucket: R2Bucket,
		noteId: number,
		userId: string,
		files: Record<string, { data: ArrayBuffer; type: string }>
	): Promise<Record<string, string>> {
		const imageMap: Record<string, string> = {}; // Keep name `imageMap` for frontmatter/DB

		for (const path in files) {
			if (Object.prototype.hasOwnProperty.call(files, path)) {
				const file = files[path];
				if (file) {
					try {
						// Duck-type check if file.data is a File/Blob-like object.
						const fileData =
							typeof (file.data as unknown as { arrayBuffer?: unknown })?.arrayBuffer === 'function'
								? await (file.data as unknown as Blob).arrayBuffer()
								: file.data;
						// Binding-based upload — no compression (originals stored as-is).
						const uploadResult = await uploadFile(
							bucket,
							userId,
							noteId,
							path,
							fileData,
							file.type
						);

						if (uploadResult.success) {
							imageMap[path] = uploadResult.url;
						} else {
							console.error(`[NoteService] Failed to upload file "${path}": ${uploadResult.error}`);
							throw new Error(`Failed to upload file "${path}": ${uploadResult.error}`);
						}
					} catch (error: unknown) {
						console.error(`[NoteService] Error uploading file "${path}":`, error);
						const message = error instanceof Error ? error.message : String(error);
						// Re-throw with more context
						if (message.includes('too large')) {
							throw new Error(
								`File "${path}" is too large.\nMaximum file size is ${config.limits.fileSize.mb}MB.`
							);
						}
						throw new Error(`Failed to upload file "${path}": ${message}`);
					}
				}
			}
		}
		return imageMap;
	}

	private injectImageMapIntoContent(
		content: string,
		imageMap: Record<string, string>
	): { content: string; imageMap: Record<string, string> } {
		// gray-matter will fail if the opening '---' is not on its own line.
		// We'll add a check to provide a clearer error message.
		if (
			content.startsWith('---') &&
			!content.startsWith('---\n') &&
			!content.startsWith('---\r\n')
		) {
			throw new InvalidFrontmatterError(
				"Invalid frontmatter format: The opening '---' must be on its own line, followed by a newline."
			);
		}

		const { content: body, data: frontmatter } = matter(content);

		if (Object.keys(imageMap).length === 0 && !frontmatter.imageMap) {
			return { content, imageMap: {} };
		}

		frontmatter.imageMap = { ...(frontmatter.imageMap || {}), ...imageMap };

		return {
			content: matter.stringify(body, frontmatter),
			imageMap: frontmatter.imageMap
		};
	}

	/**
	 * Read `mdpubs-company` from the content's frontmatter and resolve it (with
	 * the user's default org) to an org id. Returns null for personal notes.
	 * Throws InvalidAccountError on an explicit but unauthorized/unknown account.
	 */
	private async resolveOrgForContent(
		content: string,
		userId: string,
		defaultOrgId?: string | null
	): Promise<string | null> {
		let slug: string | null = null;
		try {
			const { data } = matter(content || '');
			const raw = data?.['mdpubs-company'];
			if (raw != null) slug = String(raw);
		} catch {
			// Malformed frontmatter is reported elsewhere; treat as no account here.
		}

		const result = await resolveNoteOrg(slug, userId, defaultOrgId);
		if (!result.ok) throw new InvalidAccountError(result.error);
		return result.orgId;
	}

	// Create a new note
	async createNote(
		bucket: R2Bucket,
		userId: string,
		userPlan: string,
		noteData: CreateNoteRequest,
		defaultOrgId?: string | null
	): Promise<Note> {
		// Check note limit for free users
		if (userPlan === 'free') {
			const noteCount = await this.db.countNotesByUserId(userId);
			if (noteCount >= config.limits.freeNotes) {
				const msg = `Note limit reached for free plan ${noteCount}/${config.limits.freeNotes}`;
				console.error(msg);
				throw new NoteLimitReachedError(msg);
			}
		}

		const content = noteData.content || '';

		// Resolve which org this note belongs to (mdpubs-company frontmatter →
		// user default → personal), verifying membership. Throws on an explicit
		// but unauthorized/unknown account.
		const orgId = await this.resolveOrgForContent(content, userId, defaultOrgId);

		// Create main note record first to get an ID
		const newNote = await this.db.createNote({
			userId,
			orgId,
			title: noteData.title,
			content: '', // Temp content, will be updated
			fileExtension: noteData.file_extension,
			version: 1,
			tags: noteData.tags || [],
			isPrivate: noteData.isPrivate ?? false
		});

		let finalContent = content;
		let finalImageMap: Record<string, string> | undefined = undefined;

		if (noteData.files && Object.keys(noteData.files).length > 0) {
			const newImageMap = await this.uploadAndMapFiles(bucket, newNote.id, userId, noteData.files);
			const result = this.injectImageMapIntoContent(content, newImageMap);
			finalContent = result.content;
			finalImageMap = result.imageMap;
		}

		const now = new Date();
		// Update note with final content and image map
		await this.db.updateNote(newNote.id, {
			content: finalContent,
			imageMap: finalImageMap,
			updatedAt: now
		});
		newNote.content = finalContent;
		newNote.imageMap = finalImageMap || null;

		// Create first version record
		await this.db.createNoteVersion({
			noteId: newNote.id,
			version: 1,
			title: noteData.title,
			content: finalContent,
			fileExtension: noteData.file_extension,
			userId,
			createdAt: now
		});

		return newNote;
	}

	// Get notes by user ID
	async getNotesByUserId(userId: string): Promise<Note[]> {
		return await this.db.getNotesByUserId(userId);
	}

	// Get all notes (admin only)
	async getAllNotes(): Promise<Note[]> {
		return await this.db.getAllNotes();
	}

	// Get note by ID with user ownership check
	async getNoteById(noteId: number, userId?: string): Promise<Note> {
		const note = await this.db.getNoteById(noteId);

		if (!note || note.deletedAt) {
			throw new NotFoundError('Note not found');
		}

		if (!note.isPrivate) {
			return note;
		}

		if (!userId || note.userId !== userId) {
			throw new NoteNotOwnedError('Note does not belong to you or is not public');
		}

		return note;
	}

	// Get note by ID (admin only)
	async getNoteByIdAdmin(noteId: number): Promise<Note> {
		const note = await this.db.getNoteById(noteId);

		if (!note || note.deletedAt) {
			throw new NotFoundError('Note not found');
		}

		return note;
	}

	// Get specific version of a note
	async getNoteVersion(noteId: number, version: number, userId?: string): Promise<NoteVersion> {
		// First check if the note is accessible to the user (or public)
		await this.getNoteById(noteId, userId);

		const noteVersion = await this.db.getNoteVersionByNoteIdAndVersion(noteId, version);

		if (!noteVersion) {
			throw new NotFoundError('Note version not found');
		}

		return noteVersion;
	}

	// Get specific version of a note (admin only)
	async getNoteVersionAdmin(noteId: number, version: number): Promise<NoteVersion> {
		const noteVersion = await this.db.getNoteVersionByNoteIdAndVersion(noteId, version);

		if (!noteVersion) {
			throw new NotFoundError('Note version not found');
		}

		return noteVersion;
	}

	// Get all versions of a note
	async getNoteVersions(noteId: number, userId?: string): Promise<NoteVersion[]> {
		// First check if the note is accessible to the user (or public)
		await this.getNoteById(noteId, userId);

		return await this.db.getNoteVersionsByNoteId(noteId);
	}

	// Get all versions of a note (admin only)
	async getNoteVersionsAdmin(noteId: number): Promise<NoteVersion[]> {
		return await this.db.getNoteVersionsByNoteId(noteId);
	}

	private formatPatch(patch: ReturnType<typeof diff.structuredPatch>): string {
		if (!patch.hunks || patch.hunks.length === 0) {
			return '';
		}
		// We only want the lines, not the hunk headers.
		return patch.hunks.map((hunk) => hunk.lines.join('\n')).join('\n');
	}

	private async _generateVersionsWithDiffs(
		noteId: number,
		versions: NoteVersion[]
	): Promise<NoteVersionWithDiff[]> {
		if (versions.length === 0) {
			return [];
		}

		const versionsWithDiffs: NoteVersionWithDiff[] = [];

		for (let i = 0; i < versions.length; i++) {
			const currentVersion = versions[i];
			const previousVersion = versions[i + 1]; // versions are sorted desc

			const toContent = currentVersion.content || '';
			// For the oldest version in the (potentially sliced) list, we need to get its actual predecessor
			let fromContent = '';
			let fromVersionNumber = 0;
			if (previousVersion) {
				fromContent = previousVersion.content || '';
				fromVersionNumber = previousVersion.version;
			} else if (currentVersion.version > 1) {
				const predecessor = await this.db.getNoteVersionByNoteIdAndVersion(
					noteId,
					currentVersion.version - 1
				);
				if (predecessor) {
					fromContent = predecessor.content || '';
					fromVersionNumber = predecessor.version;
				}
			}

			const patch = diff.structuredPatch(
				`note-v${fromVersionNumber}`,
				`note-v${currentVersion.version}`,
				fromContent,
				toContent,
				`version ${fromVersionNumber}`,
				`version ${currentVersion.version}`
			);

			versionsWithDiffs.push({
				...currentVersion,
				diff: this.formatPatch(patch)
			});
		}

		return versionsWithDiffs;
	}

	// Get all versions of a note with diffs
	async getNoteVersionsWithDiffs(
		noteId: number,
		userId?: string,
		limit?: number
	): Promise<NoteVersionWithDiff[]> {
		let versions = await this.getNoteVersions(noteId, userId); // This already does ownership check

		if (limit) {
			versions = versions.slice(0, limit);
		}

		return this._generateVersionsWithDiffs(noteId, versions);
	}

	// Get all versions of a note with diffs (admin only)
	async getNoteVersionsWithDiffsAdmin(
		noteId: number,
		limit?: number
	): Promise<NoteVersionWithDiff[]> {
		let versions = await this.getNoteVersionsAdmin(noteId);

		if (limit) {
			versions = versions.slice(0, limit);
		}

		return this._generateVersionsWithDiffs(noteId, versions);
	}

	// Get diff between two versions of a note
	async getNoteDiff(
		noteId: number,
		fromVersion: number,
		toVersion: number,
		userId?: string
	): Promise<string> {
		const fromNoteVersion = await this.getNoteVersion(noteId, fromVersion, userId);
		const toNoteVersion = await this.getNoteVersion(noteId, toVersion, userId);

		const fromContent = fromNoteVersion.content || '';
		const toContent = toNoteVersion.content || '';

		const patch = diff.structuredPatch(
			`note-v${fromVersion}`,
			`note-v${toVersion}`,
			fromContent,
			toContent,
			`version ${fromVersion}`,
			`version ${toVersion}`
		);
		return this.formatPatch(patch);
	}

	// Get diff between two versions of a note (admin only)
	async getNoteDiffAdmin(noteId: number, fromVersion: number, toVersion: number): Promise<string> {
		const fromNoteVersion = await this.getNoteVersionAdmin(noteId, fromVersion);
		const toNoteVersion = await this.getNoteVersionAdmin(noteId, toVersion);

		const fromContent = fromNoteVersion.content || '';
		const toContent = toNoteVersion.content || '';

		const patch = diff.structuredPatch(
			`note-v${fromVersion}`,
			`note-v${toVersion}`,
			fromContent,
			toContent,
			`version ${fromVersion}`,
			`version ${toVersion}`
		);
		return this.formatPatch(patch);
	}

	// Update note
	async updateNote(
		bucket: R2Bucket,
		noteId: number,
		userId: string,
		updateData: UpdateNoteRequest,
		defaultOrgId?: string | null
	): Promise<Note> {
		// First check if the note exists and belongs to the user
		const existingNote = await this.db.getNoteById(noteId);

		if (!existingNote || existingNote.deletedAt) {
			throw new NotFoundError('Note not found');
		}

		if (existingNote.userId !== userId) {
			throw new NoteNotOwnedError('Note does not belong to you');
		}

		// Lock-on-first-signature: once any signature exists, the signed body is
		// frozen. Reject edits that would change the canonical body a signer signed.
		// A no-op re-publish (same body, e.g. nvim/CLI re-save) is allowed through.
		// Inlined (not via signService) to avoid a note<->sign import cycle.
		if (updateData.content !== undefined && (await this.db.noteHasSignatures(noteId))) {
			const oldBody = this.stripLeadingFrontmatter(existingNote.content || '');
			const newBody = this.stripLeadingFrontmatter(updateData.content);
			const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
			if (hash(oldBody) !== hash(newBody)) {
				throw new NoteLockedError(
					'This document has been signed and can no longer be edited. ' +
						'Duplicate it to make a new version.'
				);
			}
		}

		const oldImageMap = existingNote.imageMap || {};
		const content =
			updateData.content !== undefined ? updateData.content : existingNote.content || '';
		let finalContent = content;
		let finalImageMap: Record<string, string> | undefined;

		// Handle file uploads and/or content changes to determine the new imageMap
		if (updateData.files && Object.keys(updateData.files).length > 0) {
			const newUploadsMap = await this.uploadAndMapFiles(bucket, noteId, userId, updateData.files);
			const result = this.injectImageMapIntoContent(content, newUploadsMap);
			finalContent = result.content;
			finalImageMap = result.imageMap;
		} else {
			// No new files. The imageMap is defined by the content's frontmatter.
			const { data: frontmatter } = matter(content);
			finalImageMap = frontmatter.imageMap;
		}

		// Compare old and new image maps to find and delete unused R2 files
		const oldUrls = Object.values(oldImageMap as Record<string, string>);
		const newUrls = Object.values((finalImageMap || {}) as Record<string, string>);
		const urlsToDelete = oldUrls.filter((url) => !newUrls.includes(url));

		if (urlsToDelete.length > 0) {
			console.log(
				`[NoteService] Deleting ${urlsToDelete.length} unused R2 files for note ${noteId}.`
			);
			// Fire-and-forget; a failed file deletion shouldn't block a note update.
			deleteFiles(bucket, urlsToDelete).catch((error) => {
				console.error(
					`[NoteService] Error during background deletion of unused R2 files for note ${noteId}:`,
					error
				);
			});
		}

		const now = new Date();
		const newVersion = (existingNote.version || 1) + 1;

		// Update main note record
		const noteUpdateData: Record<string, unknown> = {
			updatedAt: now,
			version: newVersion
		};

		if (updateData.title !== undefined) noteUpdateData.title = updateData.title;
		noteUpdateData.content = finalContent;
		noteUpdateData.imageMap = finalImageMap;
		if (updateData.file_extension !== undefined)
			noteUpdateData.fileExtension = updateData.file_extension;
		if (updateData.tags !== undefined) noteUpdateData.tags = updateData.tags;
		if (updateData.isPrivate !== undefined) noteUpdateData.isPrivate = updateData.isPrivate;

		// Re-resolve the org from the (possibly edited) frontmatter every update so
		// changing `mdpubs-company` moves the note, and removing it demotes it.
		noteUpdateData.orgId = await this.resolveOrgForContent(finalContent, userId, defaultOrgId);

		const updatedNote = await this.db.updateNote(noteId, noteUpdateData);

		// Create new version record
		await this.db.createNoteVersion({
			noteId,
			version: newVersion,
			title: updatedNote.title,
			content: finalContent,
			fileExtension: updatedNote.fileExtension,
			userId,
			createdAt: now
		});

		return updatedNote;
	}

	// Delete note (soft delete)
	async deleteNote(bucket: R2Bucket, noteId: number, userId: string): Promise<void> {
		// First check if the note exists and belongs to the user
		const existingNote = await this.db.getNoteById(noteId);

		if (!existingNote || existingNote.deletedAt) {
			throw new NotFoundError('Note not found');
		}

		if (existingNote.userId !== userId) {
			throw new NoteNotOwnedError('Note does not belong to you');
		}

		// Delete associated R2 files
		if (existingNote.imageMap && Object.keys(existingNote.imageMap).length > 0) {
			const urlsToDelete = Object.values(existingNote.imageMap as Record<string, string>);
			try {
				await deleteFiles(bucket, urlsToDelete);
			} catch (error) {
				console.error(`[NoteService] Error deleting R2 files for note ${noteId}:`, error);
				// We'll log the error but proceed with soft-deleting the note
			}
		}

		await this.db.deleteNote(noteId);
	}

	// Get deleted notes by user ID
	async getDeletedNotesByUserId(userId: string): Promise<Note[]> {
		return await this.db.getDeletedNotesByUserId(userId);
	}

	// Restore note
	async restoreNote(noteId: number, userId: string): Promise<void> {
		// First check if the note exists and belongs to the user
		const existingNote = await this.db.getNoteById(noteId);

		if (!existingNote) {
			throw new NotFoundError('Note not found');
		}

		if (existingNote.userId !== userId) {
			throw new NoteNotOwnedError('Note does not belong to you');
		}

		if (!existingNote.deletedAt) {
			throw new Error('Note is not deleted');
		}

		await this.db.restoreNote(noteId);
	}

	// Count active notes by user ID
	async countActiveNotesByUserId(userId: string): Promise<number> {
		return await this.db.countNotesByUserId(userId);
	}

	// Parse markdown content
	parseMarkdownContent(
		content: string,
		imageMap?: Record<string, string> | null
	): {
		frontmatter: Record<string, unknown>;
		markdownBody: string;
		html: string;
		toc: TocItem[];
	} {
		let toc: TocItem[] = [];
		let contentWithoutToc = content;
		const slugger = new GithubSlugger();

		const tocRegex =
			/<!--\s*(?:vim-markdown-)?toc.*?-->([\s\S]*?)<!--\s*(?:vim-markdown-)?toc\s*-->/;
		const tocMatch = content.match(tocRegex);

		if (tocMatch && tocMatch[1]) {
			const tocLines = tocMatch[1].split('\n');

			const items = tocLines
				.map((line) => {
					const match = line.match(/^(\s*)[-*]\s+\[(.*?)\]/);
					if (!match) return null;

					const level = match[1].length;
					const title = match[2];
					return {
						title,
						link: '#' + slugger.slug(title),
						level
					};
				})
				.filter((item): item is { title: string; link: string; level: number } => item !== null);

			const root: TocItem[] = [];
			const stack: TocItem[] = [];
			const levelStack: number[] = [];

			items.forEach((item) => {
				const tocItem: TocItem = {
					title: item.title,
					link: item.link,
					children: []
				};

				while (levelStack.length > 0 && item.level <= levelStack[levelStack.length - 1]) {
					stack.pop();
					levelStack.pop();
				}

				if (stack.length > 0) {
					stack[stack.length - 1].children.push(tocItem);
				} else {
					root.push(tocItem);
				}

				stack.push(tocItem);
				levelStack.push(item.level);
			});
			toc = root;

			slugger.reset();

			// Also remove the toc from the content
			contentWithoutToc = content.replace(tocRegex, '').trim();
		}
		const parsed = matter(contentWithoutToc);
		// Prioritize the passed imageMap over frontmatter imageMap
		const mapForRendering = imageMap || parsed.data.imageMap;

		let markdownToRender = parsed.content;

		if (mapForRendering && Object.keys(mapForRendering).length > 0) {
			// Replace all markdown file syntax with the mapped URLs
			for (const [localPath, mappedUrl] of Object.entries(
				mapForRendering as Record<string, string>
			)) {
				// Escape special regex characters in the local path
				const escapedPath = localPath.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

				// Create regex to match markdown file syntax: ![alt](localPath "title") or [text](localPath "title")
				// This now handles paths that are optionally enclosed in <> and preserves the optional title.
				// It also matches if the path in markdown ends with the localPath from the imageMap.
				const fileRegex = new RegExp(
					`(!?\\[[^\\]]*\\]\\()\\s*<?[^\\s>)]*?${escapedPath}>?\\s*([^)]*)(\\))`,
					'g'
				);

				// Replace with mapped URL, preserving the title (group 2) and closing paren (group 3)
				markdownToRender = markdownToRender.replace(fileRegex, `$1${mappedUrl}$2$3`);
			}
		}

		const renderer = new marked.Renderer();
		const originalImageRenderer = renderer.image.bind(renderer);
		renderer.image = (href: unknown, title?: string | null, text?: string): string => {
			// The renderer might be called with the full token object as the first argument.
			const token = href as { href?: string; title?: string; text?: string } | null;
			const isToken = typeof href === 'object' && href !== null && !!token?.href;
			const realHref = isToken ? token!.href : (href as string);
			const realTitle = isToken ? token!.title : title;
			const realText = isToken ? token!.text : text;

			if (realHref) {
				try {
					// Use URL parsing to robustly check the path extension, ignoring query strings.
					const url = new URL(realHref, 'http://dummy.base'); // A base is needed for relative URLs
					if (/\.(mp4|webm|ogv|ogg)$/i.test(url.pathname)) {
						return `<video controls src="${realHref}"${
							realTitle ? ` title="${realTitle}"` : ''
						}>${realText}</video>`;
					}
				} catch {
					// if href is not a valid URL/path, it will fail, and we'll fall through.
				}
			}
			// If not a video, fall back to original renderer with original arguments.
			return (originalImageRenderer as (...a: unknown[]) => string)(href, title, text);
		};

		const originalLinkRenderer = renderer.link.bind(renderer);
		renderer.link = (href: unknown, title?: string | null, text?: string): string => {
			// The renderer might be called with the full token object as the first argument.
			const token = href as { href?: string; title?: string; text?: string } | null;
			const isToken = typeof href === 'object' && href !== null && !!token?.href;
			const realHref = isToken ? token!.href : (href as string);
			const realTitle = isToken ? token!.title : title;
			const realText = isToken ? token!.text : text;

			if (realHref) {
				try {
					// Use URL parsing to robustly check the path extension, ignoring query strings.
					const url = new URL(realHref, 'http://dummy.base'); // A base is needed for relative URLs
					if (/\.(mp4|webm|ogv|ogg)$/i.test(url.pathname)) {
						return `<video controls src="${realHref}"${
							realTitle ? ` title="${realTitle}"` : ''
						}>${realText}</video>`;
					}
				} catch {
					// if href is not a valid URL/path, it will fail, and we'll fall through.
				}
			}
			// If not a video, fall back to original renderer with original arguments.
			return (originalLinkRenderer as (...a: unknown[]) => string)(href, title, text);
		};

		renderer.heading = (text: unknown, level?: number): string => {
			// Workaround for environments where marked's renderer is called with the token object
			let realText = text as string;
			let realLevel = level as number;
			if (realLevel === undefined && typeof text === 'object' && text !== null) {
				const token = text as { depth: number; text: string };
				realLevel = token.depth;
				realText = token.text;
			}

			const slug = slugger.slug(realText || '');
			return `<h${realLevel} id="${slug}">${realText || ''}</h${realLevel}>`;
		};

		// breaks: true — single newlines render as <br> so contact/signature
		// blocks written on consecutive lines don't collapse onto one line.
		const html = marked(markdownToRender, { renderer, gfm: true, breaks: true }) as string;

		return {
			frontmatter: parsed.data,
			markdownBody: parsed.content,
			html,
			toc
		};
	}

	// Check if file is markdown
	isMarkdownFile(fileExtension?: string): boolean {
		return fileExtension === 'md' || fileExtension === 'markdown';
	}

	// Check if file is raw HTML (rendered in a sandboxed iframe, not via marked)
	isHtmlFile(fileExtension?: string): boolean {
		return fileExtension === 'html' || fileExtension === 'htm';
	}

	/**
	 * Strip a leading YAML frontmatter block (--- ... ---) from raw content.
	 *
	 * The store injects an `imageMap` frontmatter block into note content. For
	 * markdown that is invisible (gray-matter strips it before rendering), but for
	 * an HTML pub we serve the content verbatim, so the block would show as literal
	 * text at the top of the page. The imageMap also lives in its own DB column, so
	 * stripping it here is safe: asset rewriting uses the column, not the block.
	 */
	stripLeadingFrontmatter(content: string): string {
		// Only strip when the very first line is a `---` fence.
		if (!/^---\r?\n/.test(content)) return content;
		const closing = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
		return closing ? content.slice(closing[0].length) : content;
	}

	/**
	 * Rewrite local asset references in raw HTML to the mapped public URLs.
	 *
	 * The imageMap is { localName: publicUrl }, the same structure produced for
	 * markdown. Here we rewrite src="localName" / href="localName" (single or double
	 * quoted) when the attribute value ends with a mapped local name. Remote URLs
	 * (http(s):, data:, //, #, mailto:) are left untouched.
	 */
	rewriteHtmlAssetUrls(html: string, imageMap?: Record<string, string> | null): string {
		if (!imageMap || Object.keys(imageMap).length === 0) return html;

		let out = html;
		for (const [localPath, mappedUrl] of Object.entries(imageMap)) {
			const escapedPath = localPath.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
			// Match src= or href= whose quoted value ends with the local name and is
			// not an absolute/remote reference. Group 1 = attr + opening quote.
			const attrRegex = new RegExp(
				`((?:src|href)\\s*=\\s*["'])(?!https?:|data:|//|#|mailto:)[^"']*?${escapedPath}(["'])`,
				'gi'
			);
			out = out.replace(attrRegex, `$1${mappedUrl}$2`);
		}
		return out;
	}

	/**
	 * The ONLY script we ever allow into a raw HTML pub: a print trigger, served
	 * only when ?print=1 is requested. It is mdpubs-controlled and pinned by exact
	 * CSP hash, so user-supplied HTML still cannot execute any script. Print on
	 * load so fonts/layout are ready before the dialog opens.
	 */
	readonly PRINT_SCRIPT = `window.addEventListener('load',function(){window.print()})`;

	/** SHA-256 of PRINT_SCRIPT contents, base64, for CSP script-src 'sha256-...'. */
	private printScriptHash(): string {
		const hash = createHash('sha256').update(this.PRINT_SCRIPT).digest('base64');
		return `'sha256-${hash}'`;
	}

	/**
	 * Content Security Policy for raw HTML pubs served into a sandboxed iframe.
	 * No script execution; styles inline + Google Fonts; images over https/data;
	 * framing limited to the mdpubs origin. Keep this strict.
	 *
	 * `script-src 'none'` is explicit (not just inherited from default-src) so a
	 * future default-src change can't silently re-enable scripts in user HTML.
	 * When allowPrint is set, script-src additionally allows ONLY the exact
	 * hash-pinned print trigger.
	 */
	htmlPubCsp(frameAncestor: string, allowPrint = false): string {
		const scriptSrc = allowPrint ? `script-src ${this.printScriptHash()}` : `script-src 'none'`;
		return [
			`default-src 'none'`,
			scriptSrc,
			`img-src https: data:`,
			`style-src 'unsafe-inline' https://fonts.googleapis.com`,
			`font-src https://fonts.gstatic.com data:`,
			`frame-ancestors ${frameAncestor}`
		].join('; ');
	}

	// Get parsed markdown note
	async getParsedMarkdownNote(
		noteId: number,
		userId?: string,
		version?: number
	): Promise<ParsedMarkdownResponse> {
		let note: Note;
		let noteContent: string | null;
		let noteImageMap: Record<string, string> | null | undefined;

		if (version) {
			const noteVersion = await this.getNoteVersion(noteId, version, userId);
			// A specific version doesn't have an imageMap, we have to get it from the main note
			const mainNote = await this.getNoteById(noteId, userId);
			noteImageMap = mainNote.imageMap;

			note = {
				id: noteVersion.noteId,
				publicId: mainNote.publicId,
				userId: noteVersion.userId,
				orgId: mainNote.orgId,
				title: noteVersion.title,
				content: noteVersion.content,
				fileExtension: noteVersion.fileExtension,
				version: noteVersion.version,
				createdAt: noteVersion.createdAt,
				updatedAt: noteVersion.createdAt,
				deletedAt: noteVersion.deletedAt,
				tags: [],
				isPrivate: mainNote.isPrivate,
				imageMap: noteImageMap ?? null
			};
			noteContent = noteVersion.content;
		} else {
			note = await this.getNoteById(noteId, userId);
			noteContent = note.content;
			noteImageMap = note.imageMap;
		}

		if (!this.isMarkdownFile(note.fileExtension || undefined)) {
			throw new Error('Note is not a markdown file');
		}

		const parsed = this.parseMarkdownContent(noteContent || '', noteImageMap);

		return {
			...note,
			frontmatter: parsed.frontmatter,
			markdownBody: parsed.markdownBody,
			html: parsed.html,
			toc: parsed.toc
		};
	}
}
