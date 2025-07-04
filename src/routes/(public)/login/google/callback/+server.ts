import { google } from '$lib/server/oauth';
import { ObjectParser } from '@pilcrowjs/object-parser';
import { createUser, getUserFromGoogleId } from '$lib/server/user';
import { createSession, setSessionTokenCookie } from '$lib/server/auth';
import { decodeIdToken } from 'arctic';

import type { RequestEvent } from './$types';
import type { OAuth2Tokens } from 'arctic';

export async function GET(event: RequestEvent): Promise<Response> {
	const storedState = event.cookies.get('google_oauth_state') ?? null;
	const codeVerifier = event.cookies.get('google_code_verifier') ?? null;
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');

	if (storedState === null || codeVerifier === null || code === null || state === null) {
		return new Response('Please restart the process.', {
			status: 400
		});
	}
	if (storedState !== state) {
		return new Response('Please restart the process.', {
			status: 400
		});
	}

	let tokens: OAuth2Tokens;
	try {
		tokens = await google.validateAuthorizationCode(code, codeVerifier);
	} catch (e) {
		return new Response('Please restart the process.', {
			status: 400
		});
	}

	const claims = decodeIdToken(tokens.idToken());
	const claimsParser = new ObjectParser(claims);

	const googleId = claimsParser.getString('sub');
	const name = claimsParser.getString('name');
	const picture = claimsParser.getString('picture');
	const email = claimsParser.getString('email');

	const existingUser = await getUserFromGoogleId(googleId);
	if (existingUser) {
		const session = await createSession(existingUser.id);
		setSessionTokenCookie(event, session.id, session.expiresAt);
		return new Response(null, {
			status: 302,
			headers: {
				Location: '/'
			}
		});
	}

	const user = await createUser(googleId, email, name, picture);
	const session = await createSession(user.id);
	setSessionTokenCookie(event, session.id, session.expiresAt);
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/'
		}
	});
}
