import type { Handle, HandleServerError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import * as auth from '$lib/server/auth.js';
import { reportError } from '$lib/server/errorReporter.js';

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

	return resolve(event);
};

export const handle: Handle = handleAuth;

/**
 * Unhandled server errors → Hermes auto-fix loop (errorReporter.ts).
 * Returns the message SvelteKit shows the client; reporting is side-effect
 * only and never blocks or alters the response.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	// 404s and other expected client errors aren't worth a Kanban card.
	if (status >= 500) {
		reportError({
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			route: event.route.id,
			method: event.request.method,
			status
		});
	}
	return { message };
};
