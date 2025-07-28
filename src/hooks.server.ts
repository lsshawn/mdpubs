import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import * as auth from '$lib/server/auth.js';
import { db } from '$lib/server/db';
import { user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(auth.sessionCookieName);
	if (!sessionId) {
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}

	const { session, user } = await auth.validateSession(sessionId);
	if (session) {
		event.cookies.set(auth.sessionCookieName, session.id, {
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			expires: session.expiresAt,
			secure: !dev
		});
	} else {
		event.cookies.delete(auth.sessionCookieName, { path: '/' });
	}

	event.locals.user = user;
	event.locals.session = session;

	// Handle custom domains that map directly to a user's public note pages
	const host = event.request.headers.get('host') ?? '';
	const isDefaultHost = dev || host.endsWith('mdpubs.com') || host.startsWith('localhost');

	if (!isDefaultHost) {
		const [domainUser] = await db
			.select({ username: userTable.username })
			.from(userTable)
			.where(eq(userTable.customDomain, host));

		if (domainUser) {
			if (event.url.pathname === '/') {
				throw redirect(307, `/u/${domainUser.username}`);
			}
			const originalPath = event.url.pathname === '/' ? '' : event.url.pathname;
			event.url.pathname = `/u/${domainUser.username}${originalPath}`;
		}
	}

	return resolve(event);
};

export const handle: Handle = handleAuth;
