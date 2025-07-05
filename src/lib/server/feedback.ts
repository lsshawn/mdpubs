import { feedbackDb } from '$lib/server/db';
import * as table from '$lib/server/db/feedback.schema';
import { desc, eq, isNull } from 'drizzle-orm';

/**
 * Retrieves all non-deleted feedback entries from the database, ordered by creation date.
 * @returns A promise that resolves to an array of feedback entries.
 */
export async function getAllFeedback(): Promise<table.Feedback[]> {
	return await feedbackDb
		.select()
		.from(table.feedback)
		.where(isNull(table.feedback.deletedAt))
		.orderBy(desc(table.feedback.createdAt));
}

/**
 * Retrieves a single feedback entry by its ID.
 * @param id The ID of the feedback entry to retrieve.
 * @returns A promise that resolves to the feedback entry, or null if not found.
 */
export async function getFeedbackById(id: number): Promise<table.Feedback | null> {
	const [item] = await feedbackDb.select().from(table.feedback).where(eq(table.feedback.id, id));

	if (!item) {
		return null;
	}
	return item;
}

/**
 * Soft-deletes a feedback entry by setting its `deletedAt` timestamp.
 * @param id The ID of the feedback entry to delete.
 * @returns A promise that resolves when the operation is complete.
 */
export async function deleteFeedback(id: number): Promise<void> {
	await feedbackDb
		.update(table.feedback)
		.set({ deletedAt: new Date() })
		.where(eq(table.feedback.id, id));
}
