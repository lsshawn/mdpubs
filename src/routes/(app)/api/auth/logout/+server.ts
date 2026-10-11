import { fail } from '@sveltejs/kit';
import { deleteSessionTokenCookie, invalidateSession } from '#lib/server/auth.js';

import type { RequestEvent } from './$types';

export async function POST(event: RequestEvent) {
	if (event.locals.session === null) {
		return fail(401);
	}
	invalidateSession(event.locals.session.id);
	deleteSessionTokenCookie(event);
	return Response.json({ success: true });
}
