import { fail } from '@sveltejs/kit';
import { listTokens, revokeToken } from '#lib/server/tokens.js';
import type { Actions, PageServerLoad } from './$types';

// The AI tools connected through /install (CLI) or the MCP connector.
export const load: PageServerLoad = async ({ locals }) => ({
	tools: locals.user ? await listTokens(locals.user.id) : []
});

export const actions: Actions = {
	disconnect: async ({ locals, request }) => {
		if (!locals.user) return fail(401);
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string') return fail(400);
		await revokeToken(locals.user.id, id);
	}
};
