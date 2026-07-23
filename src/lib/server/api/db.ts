/**
 * DB-access layer for the ported Hono API.
 *
 * This replaces mdpubs-api's `src/lib/database.ts` singleton. The original read
 * `process.env` to build its own Drizzle client — impossible on Workers. Here we
 * reuse the destination's lazy, request-safe `db` proxy
 * (`$lib/server/db` → `$env/dynamic/private`). Method names/signatures are kept
 * IDENTICAL to the original `DatabaseConnection` so the ported services call
 * `this.db.<method>()` unchanged.
 */
import { db } from '$lib/server/db';
import {
	user,
	note,
	noteVersion,
	signatureRequest,
	signature,
	signatureEvent,
	type User,
	type NewUser,
	type Note,
	type NewNote,
	type NoteVersion,
	type NewNoteVersion,
	type SignatureRequest,
	type NewSignatureRequest,
	type Signature,
	type NewSignature,
	type NewSignatureEvent
} from '$lib/server/db/schema';
import { eq, and, isNull, isNotNull, desc, count, asc } from 'drizzle-orm';

// Database errors
export class DatabaseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DatabaseError';
	}
}

export class NotFoundError extends DatabaseError {
	constructor(message: string = 'Record not found') {
		super(message);
		this.name = 'NotFoundError';
	}
}

export class InvalidAPIKeyError extends DatabaseError {
	constructor(message: string = 'Invalid API key') {
		super(message);
		this.name = 'InvalidAPIKeyError';
	}
}

export class NoteLimitReachedError extends DatabaseError {
	constructor(message: string = 'Note limit reached for free plan') {
		super(message);
		this.name = 'NoteLimitReachedError';
	}
}

export class NoteNotOwnedError extends DatabaseError {
	constructor(message: string = "Note doesn't belong to you") {
		super(message);
		this.name = 'NoteNotOwnedError';
	}
}

/** Thrown when an edit is attempted on a note that has been signed (locked). */
export class NoteLockedError extends DatabaseError {
	constructor(message: string = 'Note is locked because it has been signed') {
		super(message);
		this.name = 'NoteLockedError';
	}
}

class DatabaseConnection {
	// User operations
	async createUser(userData: NewUser): Promise<User> {
		try {
			const result = await db.insert(user).values(userData).returning();
			return result[0];
		} catch (error) {
			throw new DatabaseError(`Failed to create user: ${error}`);
		}
	}

	async getUserByEmail(email: string): Promise<User | null> {
		try {
			const result = await db.select().from(user).where(eq(user.email, email)).limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get user by email: ${error}`);
		}
	}

	async getUserByApiKey(apiKey: string): Promise<User | null> {
		try {
			const result = await db
				.select()
				.from(user)
				.where(and(eq(user.apiKey, apiKey), isNull(user.deletedAt)))
				.limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get user by API key: ${error}`);
		}
	}

	async getUserByReadOnlyApiKey(apiKey: string): Promise<User | null> {
		try {
			const result = await db
				.select()
				.from(user)
				.where(and(eq(user.readOnlyApiKey, apiKey), isNull(user.deletedAt)))
				.limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get user by read-only API key: ${error}`);
		}
	}

	async getUserById(id: string): Promise<User | null> {
		try {
			const result = await db.select().from(user).where(eq(user.id, id)).limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get user by ID: ${error}`);
		}
	}

	async updateUser(id: string, updates: Partial<NewUser>): Promise<User> {
		try {
			const result = await db.update(user).set(updates).where(eq(user.id, id)).returning();
			if (!result[0]) {
				throw new NotFoundError('User not found');
			}
			return result[0];
		} catch (error) {
			if (error instanceof NotFoundError) throw error;
			throw new DatabaseError(`Failed to update user: ${error}`);
		}
	}

	async getAllUsers(): Promise<User[]> {
		try {
			return await db.select().from(user).where(isNull(user.deletedAt));
		} catch (error) {
			throw new DatabaseError(`Failed to get all user: ${error}`);
		}
	}

	async getAllNotes(): Promise<Note[]> {
		try {
			return await db
				.select()
				.from(note)
				.where(isNull(note.deletedAt))
				.orderBy(desc(note.updatedAt));
		} catch (error) {
			throw new DatabaseError(`Failed to get all note: ${error}`);
		}
	}

	// Note operations
	async createNote(noteData: NewNote): Promise<Note> {
		try {
			const result = await db.insert(note).values(noteData).returning();
			return result[0];
		} catch (error) {
			throw new DatabaseError(`Failed to create note: ${error}`);
		}
	}

	async getNoteById(id: number): Promise<Note | null> {
		try {
			const result = await db.select().from(note).where(eq(note.id, id)).limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get note by ID: ${error}`);
		}
	}

	async getNoteByPublicId(publicId: string): Promise<Note | null> {
		try {
			const result = await db.select().from(note).where(eq(note.publicId, publicId)).limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get note by public ID: ${error}`);
		}
	}

	async getNotesByUserId(userId: string): Promise<Note[]> {
		try {
			return await db
				.select()
				.from(note)
				.where(and(eq(note.userId, userId), isNull(note.deletedAt)))
				.orderBy(desc(note.updatedAt));
		} catch (error) {
			throw new DatabaseError(`Failed to get note by user ID: ${error}`);
		}
	}

	async getDeletedNotesByUserId(userId: string): Promise<Note[]> {
		try {
			return await db
				.select()
				.from(note)
				.where(and(eq(note.userId, userId), isNotNull(note.deletedAt)))
				.orderBy(desc(note.updatedAt));
		} catch (error) {
			throw new DatabaseError(`Failed to get deleted note by user ID: ${error}`);
		}
	}

	async updateNote(id: number, updates: Partial<NewNote>): Promise<Note> {
		try {
			const result = await db
				.update(note)
				.set({
					...updates,
					updatedAt: new Date()
				})
				.where(eq(note.id, id))
				.returning();

			if (!result[0]) {
				throw new NotFoundError('Note not found');
			}
			return result[0];
		} catch (error) {
			if (error instanceof NotFoundError) throw error;
			throw new DatabaseError(`Failed to update note: ${error}`);
		}
	}

	async deleteNote(id: number): Promise<void> {
		try {
			const result = await db
				.update(note)
				.set({
					deletedAt: new Date()
				})
				.where(eq(note.id, id))
				.returning();

			if (!result[0]) {
				throw new NotFoundError('Note not found');
			}
		} catch (error) {
			if (error instanceof NotFoundError) throw error;
			throw new DatabaseError(`Failed to delete note: ${error}`);
		}
	}

	async restoreNote(id: number): Promise<void> {
		try {
			const result = await db
				.update(note)
				.set({
					deletedAt: null
				})
				.where(eq(note.id, id))
				.returning();

			if (!result[0]) {
				throw new NotFoundError('Note not found');
			}
		} catch (error) {
			if (error instanceof NotFoundError) throw error;
			throw new DatabaseError(`Failed to restore note: ${error}`);
		}
	}

	async countNotesByUserId(userId: string): Promise<number> {
		try {
			const result = await db
				.select({ count: count() })
				.from(note)
				.where(and(eq(note.userId, userId), isNull(note.deletedAt)));
			return result[0].count;
		} catch (error) {
			throw new DatabaseError(`Failed to count note by user ID: ${error}`);
		}
	}

	// Note version operations
	async createNoteVersion(versionData: NewNoteVersion): Promise<NoteVersion> {
		try {
			const result = await db.insert(noteVersion).values(versionData).returning();
			return result[0];
		} catch (error) {
			throw new DatabaseError(`Failed to create note version: ${error}`);
		}
	}

	async getNoteVersionsByNoteId(noteId: number): Promise<NoteVersion[]> {
		try {
			return await db
				.select()
				.from(noteVersion)
				.where(and(eq(noteVersion.noteId, noteId), isNull(noteVersion.deletedAt)))
				.orderBy(desc(noteVersion.version));
		} catch (error) {
			throw new DatabaseError(`Failed to get note versions by note ID: ${error}`);
		}
	}

	async getNoteVersionByNoteIdAndVersion(
		noteId: number,
		version: number
	): Promise<NoteVersion | null> {
		try {
			const result = await db
				.select()
				.from(noteVersion)
				.where(
					and(
						eq(noteVersion.noteId, noteId),
						eq(noteVersion.version, version),
						isNull(noteVersion.deletedAt)
					)
				)
				.limit(1);
			return result[0] || null;
		} catch (error) {
			throw new DatabaseError(`Failed to get note version: ${error}`);
		}
	}

	// ─── Signing ────────────────────────────────────────────────────────────

	/** The live signing request for a note, or null if nobody has started signing. */
	async getSignatureRequestByNoteId(noteId: number): Promise<SignatureRequest | null> {
		const result = await db
			.select()
			.from(signatureRequest)
			.where(eq(signatureRequest.noteId, noteId))
			.limit(1);
		return result[0] || null;
	}

	async createSignatureRequest(data: NewSignatureRequest): Promise<SignatureRequest> {
		const result = await db.insert(signatureRequest).values(data).returning();
		return result[0];
	}

	/** All signatures on a note, ordered by signer position (signing order). */
	async getSignaturesByNoteId(noteId: number): Promise<Signature[]> {
		return await db
			.select()
			.from(signature)
			.where(eq(signature.noteId, noteId))
			.orderBy(asc(signature.signerIndex));
	}

	async createSignature(data: NewSignature): Promise<Signature> {
		const result = await db.insert(signature).values(data).returning();
		return result[0];
	}

	/** True if any signature exists for the note — the lock-on-first-signature gate. */
	async noteHasSignatures(noteId: number): Promise<boolean> {
		const result = await db
			.select({ count: count() })
			.from(signature)
			.where(eq(signature.noteId, noteId));
		return (result[0]?.count ?? 0) > 0;
	}

	/** Append an audit-trail event. Never updated or deleted. */
	async recordSignatureEvent(data: NewSignatureEvent): Promise<void> {
		// Set createdAt explicitly — the timestamp-mode column's SQL default writes
		// text that Drizzle reads back as null (same issue as signatures.signedAt).
		await db.insert(signatureEvent).values({ createdAt: new Date(), ...data });
	}

	/** The full append-only audit trail for a note, oldest first. */
	async getSignatureEvents(noteId: number) {
		return await db
			.select()
			.from(signatureEvent)
			.where(eq(signatureEvent.noteId, noteId))
			.orderBy(asc(signatureEvent.id));
	}

	getDB() {
		return db;
	}
}

// Export singleton instance
export const database = new DatabaseConnection();

// Export types
export type { User, NewUser, Note, NewNote, NoteVersion, NewNoteVersion };
