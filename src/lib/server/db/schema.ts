import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const CreatedAt = integer('created_at', { mode: 'timestamp' }).default(sql`(current_timestamp)`);
const UpdatedAt = integer('updated_at', { mode: 'timestamp' }).default(sql`(current_timestamp)`);
const DeletedAt = integer('deleted_at', { mode: 'timestamp' });
const Id = integer('id').primaryKey({ autoIncrement: true });

export const user = sqliteTable(
	'users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => nanoid()),
		email: text('email').notNull().unique(),
		apiKey: text('api_key').unique(),
		readOnlyApiKey: text('read_only_api_key').unique(),
		plan: text('plan').default('free'),
		stripeCustomerId: text('stripe_customer_id'),
		subscriptionId: text('subscription_id'),
		createdAt: CreatedAt,
		deletedAt: DeletedAt,
		otp: text('otp'),
		isVerified: integer('is_verified', { mode: 'boolean' }).default(false),
		otpAttempts: integer('otp_attempts').default(0),
		otpExpiry: integer('otp_expiry', { mode: 'timestamp' }),
		googleId: text('google_id')
	},
	(users) => ({
		emailIdx: index('idx_users_email').on(users.email),
		apiKeyIdx: index('idx_users_api_key').on(users.apiKey),
		readOnlyApiKeyIdx: index('idx_users_read_only_api_key').on(users.readOnlyApiKey),
		deletedAtIdx: index('idx_users_deleted_at').on(users.deletedAt),
		stripeCustomerIdIdx: index('idx_users_stripe_customer_id').on(users.stripeCustomerId)
	})
);

export const session = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const note = sqliteTable(
	'notes',
	{
		id: Id,
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		content: text('content'),
		fileExtension: text('file_extension'),
		version: integer('version').default(1),
		createdAt: CreatedAt,
		updatedAt: UpdatedAt,
		deletedAt: DeletedAt,
		tags: text('tags', { mode: 'json' })
			.notNull()
			.$type<string[]>()
			.default(sql`'[]'`),
		isPublic: integer('is_public', { mode: 'boolean' }).default(false),
		imageMap: text('image_map', { mode: 'json' }).$type<Record<string, string>>()
	},
	(notes) => ({
		userIdIdx: index('idx_notes_user_id').on(notes.userId),
		updatedAtIdx: index('idx_notes_updated_at').on(notes.updatedAt),
		deletedAtIdx: index('idx_notes_deleted_at').on(notes.deletedAt)
	})
);

export const noteVersion = sqliteTable(
	'note_versions',
	{
		id: Id,
		noteId: integer('note_id')
			.notNull()
			.references(() => note.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		title: text('title').notNull(),
		content: text('content'),
		fileExtension: text('file_extension'),
		createdAt: CreatedAt,
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		deletedAt: DeletedAt
	},
	(noteVersions) => ({
		noteIdIdx: index('idx_note_versions_note_id').on(noteVersions.noteId),
		versionIdx: index('idx_note_versions_version').on(noteVersions.version)
	})
);

export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Note = typeof note.$inferSelect;
export type NewNote = typeof note.$inferInsert;
export type NoteVersion = typeof noteVersion.$inferSelect;
export type NewNoteVersion = typeof noteVersion.$inferInsert;
