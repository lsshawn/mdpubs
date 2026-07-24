import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
		name: text('name'),
		username: text('username').unique(),
		picture: text('picture'),
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
		googleId: text('google_id').unique(),
		githubId: text('github_id').unique(),
		customDomain: text('custom_domain').unique(),
		// Default org for this user's API key (hybrid org resolution). When a synced
		// note has no `mdpubs-company` frontmatter, publishing falls back to this
		// org. Null = personal notes by default. Frontmatter always overrides. The
		// membership check still applies regardless, so this is only a convenience
		// default, never an authorization grant. Declared here (keys live on the
		// user today); moves onto a key row if keys become their own table.
		defaultOrgId: text('default_org_id').references(() => organization.id, {
			onDelete: 'set null'
		})
	},
	(users) => ({
		emailIdx: index('idx_users_email').on(users.email),
		apiKeyIdx: index('idx_users_api_key').on(users.apiKey),
		readOnlyApiKeyIdx: index('idx_users_read_only_api_key').on(users.readOnlyApiKey),
		deletedAtIdx: index('idx_users_deleted_at').on(users.deletedAt),
		stripeCustomerIdIdx: index('idx_users_stripe_customer_id').on(users.stripeCustomerId),
		githubIdIdx: index('idx_users_github_id').on(users.githubId),
		usernameIdx: index('idx_users_username').on(users.username),
		customDomainIdx: index('idx_users_custom_domain').on(users.customDomain),
		defaultOrgIdx: index('idx_users_default_org').on(users.defaultOrgId)
	})
);

/**
 * Organizations ("accounts"). A note's `mdpubs-company: <slug>` frontmatter
 * resolves to one of these by `slug`, and each org can own a custom domain
 * (e.g. docs.108labs.ai) served via Cloudflare for SaaS custom hostnames.
 *
 * The custom domain lives HERE (not on `users`) so a whole team shares one
 * branded domain. `users.customDomain` is the legacy per-user field and is
 * being superseded by this.
 */
export const organization = sqliteTable(
	'organizations',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => nanoid()),
		// The frontmatter value: `mdpubs-company: 108labs`. URL-safe, lowercase.
		slug: text('slug').notNull().unique(),
		name: text('name').notNull(),

		// --- Custom domain (Cloudflare for SaaS) ------------------------------
		// The hostname a customer points at us, e.g. "docs.108labs.ai".
		customDomain: text('custom_domain').unique(),
		// The custom-hostname id returned by the Cloudflare API. Needed to poll
		// certificate/verification status and to delete the hostname later.
		cfHostnameId: text('cf_hostname_id'),
		// Lifecycle: 'none' (no domain) | 'pending' (awaiting DNS + cert) |
		// 'active' (cert issued, serving) | 'failed'.
		domainStatus: text('domain_status').default('none'),

		createdAt: CreatedAt,
		updatedAt: UpdatedAt,
		deletedAt: DeletedAt
	},
	(orgs) => ({
		slugIdx: uniqueIndex('idx_orgs_slug').on(orgs.slug),
		customDomainIdx: index('idx_orgs_custom_domain').on(orgs.customDomain),
		cfHostnameIdx: index('idx_orgs_cf_hostname').on(orgs.cfHostnameId)
	})
);

/**
 * Membership: which users belong to which org, and their role. Publishing a
 * note into an org (via `mdpubs-company`) requires the syncing user to have a
 * row here; domain management requires role owner/admin.
 */
export const orgMember = sqliteTable(
	'org_members',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => nanoid()),
		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		// 'owner' | 'admin' | 'member'. owner/admin may manage the custom domain.
		role: text('role').notNull().default('member'),
		createdAt: CreatedAt
	},
	(m) => ({
		orgUserIdx: uniqueIndex('idx_org_members_org_user').on(m.orgId, m.userId),
		userIdx: index('idx_org_members_user').on(m.userId),
		orgIdx: index('idx_org_members_org').on(m.orgId)
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
		// Unguessable public identifier used in all public URLs and public API
		// reads. The autoincrement `id` is enumerable and must never be exposed
		// publicly. Mirrors the same column in mdpubs-api's schema.
		//
		// .notNull() keeps the app-facing type a non-null string. The LIVE DB column
		// is actually nullable (backfilled + always written by the API); we do NOT
		// run db:push to enforce NOT NULL (it forces a SQLite/Turso table rebuild for
		// no benefit — the unique index guarantees uniqueness). A db:push data-loss
		// warning about this column is a false positive; do not approve it.
		publicId: text('public_id')
			.notNull()
			.$defaultFn(() => nanoid()),
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
		isPrivate: integer('is_private', { mode: 'boolean' }).default(false),
		imageMap: text('image_map', { mode: 'json' }).$type<Record<string, string>>(),
		// The org this note is published under, from `mdpubs-company` frontmatter.
		// Null for personal notes. Set by mdpubs-api during sync, after verifying
		// the syncing user is a member of the org. Custom-domain routing serves a
		// note only if its org owns the requesting host.
		orgId: text('org_id').references(() => organization.id, { onDelete: 'set null' })
	},
	(notes) => ({
		publicIdIdx: uniqueIndex('idx_notes_public_id').on(notes.publicId),
		userIdIdx: index('idx_notes_user_id').on(notes.userId),
		updatedAtIdx: index('idx_notes_updated_at').on(notes.updatedAt),
		deletedAtIdx: index('idx_notes_deleted_at').on(notes.deletedAt),
		orgIdIdx: index('idx_notes_org_id').on(notes.orgId)
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

/**
 * E-signing (mdpubs-sign). MIRROR of mdpubs-api/src/db/schema.ts — both repos
 * share one Turso DB, so their schemas MUST stay identical (otherwise `db:push`
 * from the repo missing a table proposes to DROP it). Signing is written by
 * mdpubs-api; declared here only so `db:push` from this repo is a no-op for these
 * tables and Drizzle types are complete.
 *
 * A pub becomes signable when its content declares `mdpubs-sign: true` plus a
 * `signers:` list (markdown frontmatter or HTML comments). The first time anyone
 * signs, we snapshot the exact signed bytes and their SHA-256 into a
 * `signature_request` row — the signature binds to that hash, not to the pub. If
 * the underlying content later changes, the hash no longer matches and the pub is
 * flagged "altered after signing". We also LOCK the note against edits once the
 * first signature exists (enforced in the update path), so the happy path never
 * reaches that mismatch state.
 */
export const signatureRequest = sqliteTable(
	'signature_requests',
	{
		id: Id,
		noteId: integer('note_id')
			.notNull()
			.references(() => note.id, { onDelete: 'cascade' }),
		// SHA-256 (hex) of the canonical signed body: stripLeadingFrontmatter(content).
		// Snapshotted on the first signature; all signatures on this request bind to it.
		contentHash: text('content_hash').notNull(),
		// The exact bytes that were hashed, kept verbatim for the audit trail /
		// dispute evidence even if the live note is later edited.
		signedContent: text('signed_content').notNull(),
		// 'sequential' (array order) | 'parallel' (any order).
		signOrder: text('sign_order').notNull().default('sequential'),
		// The signer list as declared in content at snapshot time: [{name,email}].
		signers: text('signers', { mode: 'json' })
			.notNull()
			.$type<{ name: string; email: string }[]>()
			.default(sql`'[]'`),
		createdAt: CreatedAt
	},
	(t) => ({
		noteIdIdx: index('idx_signature_requests_note_id').on(t.noteId),
		// One live signing request per note.
		noteIdUnique: index('idx_signature_requests_note_id_unique').on(t.noteId)
	})
);

export const signature = sqliteTable(
	'signatures',
	{
		id: Id,
		requestId: integer('request_id')
			.notNull()
			.references(() => signatureRequest.id, { onDelete: 'cascade' }),
		noteId: integer('note_id')
			.notNull()
			.references(() => note.id, { onDelete: 'cascade' }),
		signerName: text('signer_name').notNull(),
		signerEmail: text('signer_email').notNull(),
		// Position in the signers array — fixes the signing order for 'sequential'.
		signerIndex: integer('signer_index').notNull(),
		// The hash the signer actually signed (== request.contentHash at sign time).
		contentHash: text('content_hash').notNull(),
		// Presigned-able R2 key for the drawn signature PNG.
		signatureImageKey: text('signature_image_key'),
		// Custom field values the signer entered (e.g. {"Title":"Partner"}), keyed
		// by the field labels declared in the pub's mdpubs-signer-fields config.
		fields: text('fields', { mode: 'json' }).$type<Record<string, string>>(),
		ipAddress: text('ip_address'),
		// Approximate signer location from Cloudflare geo at signing time (e.g.
		// "Kuala Lumpur, 14, MY"). Best-effort; null when geo is unavailable.
		location: text('location'),
		userAgent: text('user_agent'),
		signedAt: integer('signed_at', { mode: 'timestamp' }).default(sql`(current_timestamp)`)
	},
	(t) => ({
		requestIdIdx: index('idx_signatures_request_id').on(t.requestId),
		noteIdIdx: index('idx_signatures_note_id').on(t.noteId)
	})
);

/** Append-only audit trail: every signing-related action, never mutated. */
export const signatureEvent = sqliteTable(
	'signature_events',
	{
		id: Id,
		noteId: integer('note_id')
			.notNull()
			.references(() => note.id, { onDelete: 'cascade' }),
		requestId: integer('request_id'),
		// 'request_created' | 'viewed' | 'signed' | 'completed' | 'edit_blocked'
		action: text('action').notNull(),
		signerEmail: text('signer_email'),
		contentHash: text('content_hash'),
		ipAddress: text('ip_address'),
		location: text('location'),
		userAgent: text('user_agent'),
		detail: text('detail'),
		createdAt: CreatedAt
	},
	(t) => ({
		noteIdIdx: index('idx_signature_events_note_id').on(t.noteId)
	})
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type OrgMember = typeof orgMember.$inferSelect;
export type NewOrgMember = typeof orgMember.$inferInsert;
export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Note = typeof note.$inferSelect;
export type NewNote = typeof note.$inferInsert;
export type NoteVersion = typeof noteVersion.$inferSelect;
export type NewNoteVersion = typeof noteVersion.$inferInsert;
export type SignatureRequest = typeof signatureRequest.$inferSelect;
export type NewSignatureRequest = typeof signatureRequest.$inferInsert;
export type Signature = typeof signature.$inferSelect;
export type NewSignature = typeof signature.$inferInsert;
export type SignatureEvent = typeof signatureEvent.$inferSelect;
export type NewSignatureEvent = typeof signatureEvent.$inferInsert;
