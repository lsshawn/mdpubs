import { github } from '$lib/server/oauth';
import { generateState } from 'arctic';

import type { RequestEvent } from './$types';

export async function GET(event: RequestEvent): Promise<Response> {
	const state = generateState();
	const url = github.createAuthorizationURL(state, ['user:email']);

	event.cookies.set('github_oauth_state', state, {
		httpOnly: true,
		maxAge: 60 * 10,
		secure: import.meta.env.PROD,
		path: '/',
		sameSite: 'lax'
	});

	// Carry the post-login destination across the OAuth round-trip. Only
	// same-site absolute paths are stored; anything else falls through to the
	// callback's `/account` default.
	const redirectTo = event.url.searchParams.get('redirectTo');
	if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
		event.cookies.set('github_oauth_redirect', redirectTo, {
			httpOnly: true,
			maxAge: 60 * 10,
			secure: import.meta.env.PROD,
			path: '/',
			sameSite: 'lax'
		});
	}

	return new Response(null, {
		status: 302,
		headers: {
			Location: url.toString()
		}
	});
}
