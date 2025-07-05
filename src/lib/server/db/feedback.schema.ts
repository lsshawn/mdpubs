import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const CreatedAt = integer('created_at', { mode: 'timestamp' }).default(sql`(current_timestamp)`);
const UpdatedAt = integer('updated_at', { mode: 'timestamp' }).default(sql`(current_timestamp)`);
const DeletedAt = integer('deleted_at', { mode: 'timestamp' });
const Id = integer('id').primaryKey({ autoIncrement: true });

// Feedback table - stores all feedback submissions
export const feedback = sqliteTable(
	'feedback',
	{
		id: Id,
		userId: text('user_id'), // Optional user ID if the user is logged in
		message: text('message'), // Optional feedback message
		email: text('email'), // Optional email for follow-up
		page: text('page'), // URL where feedback was submitted
		userAgent: text('user_agent'), // Browser info
		ipAddress: text('ip_address'), // For analytics (anonymized)
		metadata: text('metadata', { mode: 'json' }), // JSON for additional data
		createdAt: CreatedAt,
		updatedAt: UpdatedAt,
		deletedAt: DeletedAt
	},
	(table) => ({
		userIdIdx: index('user_id_idx').on(table.userId),
		createdAtIdx: index('created_at_idx').on(table.createdAt)
	})
);

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
