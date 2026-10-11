import { regenerateApiKeys } from '#lib/server/user.js';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from './$types';

export async function POST({ locals }: RequestEvent) {
	const currentUser = locals.user;
	if (!currentUser) {
		error(401, 'Unauthorized');
	}

	try {
		const { apiKey, readOnlyApiKey } = await regenerateApiKeys(currentUser.id);

		return Response.json({
			success: true,
			data: {
				apiKey,
				readOnlyApiKey
			}
		});
	} catch (e) {
		console.error('Error regenerating API keys:', e);
		return Response.json(
			{
				success: false,
				message: 'An error occurred while regenerating API keys.'
			},
			{ status: 500 }
		);
	}
}
