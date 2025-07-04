import { regenerateApiKeys } from '$lib/server/user';
import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from './$types';

export async function POST({ locals }: RequestEvent) {
	const currentUser = locals.user;
	if (!currentUser) {
		error(401, 'Unauthorized');
	}

	try {
		const { apiKey, readOnlyApiKey } = await regenerateApiKeys(currentUser.id);

		return json({
			success: true,
			data: {
				apiKey,
				readOnlyApiKey
			}
		});
	} catch (e) {
		console.error('Error regenerating API keys:', e);
		return json(
			{
				success: false,
				message: 'An error occurred while regenerating API keys.'
			},
			{ status: 500 }
		);
	}
}
