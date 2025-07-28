import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from './$types';
import { z } from 'zod';

const usernameSchema = z.object({
	username: z
		.string()
		.min(3, 'Username must be at least 3 characters long.')
		.max(20, 'Username must be at most 20 characters long.')
		.regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores.')
});

export async function POST(event: RequestEvent) {
	const currentUser = event.locals.user;
	if (!currentUser) {
		throw error(401, 'Unauthorized');
	}

	const body = await event.request.json();
	const validation = usernameSchema.safeParse(body);

	if (!validation.success) {
		return json(
			{ success: false, message: validation.error.errors[0].message },
			{ status: 400 }
		);
	}
	const { username } = validation.data;

	try {
		await db.update(table.user).set({ username }).where(eq(table.user.id, currentUser.id));

		return json({ success: true, message: 'Username updated successfully.' });
	} catch (e: any) {
		if (e.message?.includes('UNIQUE constraint failed: users.username')) {
			return json({ success: false, message: 'Username is already taken.' }, { status: 409 });
		}
		console.error('Error updating username:', e);
		return json({ success: false, message: 'An internal error occurred.' }, { status: 500 });
	}
}
