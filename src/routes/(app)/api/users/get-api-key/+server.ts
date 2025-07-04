import { error, json, type RequestEvent } from '@sveltejs/kit';
import * as table from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export async function GET({ locals }: RequestEvent) {
	const currentUser = locals.user;
	if (!currentUser) {
		error(401, 'Unauthorized');
	}

	try {
		const [user] = await db
			.select({
				apiKey: table.user.apiKey,
				readOnlyApiKey: table.user.readOnlyApiKey
			})
			.from(table.user)
			.where(eq(table.user.id, currentUser.id));

		if (!user) {
			return json({ success: false, message: 'User not found' }, { status: 404 });
		}

		return json({
			success: true,
			data: {
				apiKey: user.apiKey,
				readOnlyApiKey: user.readOnlyApiKey
			}
		});
	} catch (err) {
		console.error('Error fetching api keys:', err);
		return json({ success: false, message: 'Failed to fetch api keys' }, { status: 500 });
	}
}
