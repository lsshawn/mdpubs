import { eq } from 'drizzle-orm';
import { config } from '$lib/config';
import { github } from '$lib/server/oauth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { createUser, getUserFromGithubId, getUserByEmail } from '$lib/server/user';
import { createSession, setSessionTokenCookie } from '$lib/server/auth';

import type { RequestEvent } from './$types';

export async function GET(event: RequestEvent): Promise<Response> {
	const storedState = event.cookies.get('github_oauth_state') ?? null;
	const code = event.url.searchParams.get('code');
	const state = event.url.searchParams.get('state');

	if (storedState === null || code === null || state === null) {
		return new Response('Please restart the process.', {
			status: 400
		});
	}
	if (storedState !== state) {
		return new Response('Please restart the process.', {
			status: 400
		});
	}

	try {
		const tokens = await github.validateAuthorizationCode(code);
		const githubUserResponse = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `Bearer ${tokens.accessToken()}`,
				'User-Agent': config.name
			}
		});
		const githubUser: GitHubUser = await githubUserResponse.json();
		const existingUser = await getUserFromGithubId(String(githubUser.id));

		if (existingUser) {
			const session = await createSession(existingUser.id);
			setSessionTokenCookie(event, session.id, session.expiresAt);
			return new Response(null, {
				status: 302,
				headers: {
					Location: '/account'
				}
			});
		}

		let userEmail: string | null = githubUser.email;

		// if user has no public email, we try to get it from the emails endpoint
		if (!userEmail) {
			const githubUserEmailsResponse = await fetch('https://api.github.com/user/emails', {
				headers: {
					Authorization: `Bearer ${tokens.accessToken()}`,
					'X-GitHub-Api-Version': '2022-11-28',
					Accept: 'application/vnd.github+json',
					'User-Agent': config.name
				}
			});

			if (githubUserEmailsResponse.ok) {
				const githubEmails: GitHubEmail[] = await githubUserEmailsResponse.json();
				const primaryEmail = githubEmails.find((email) => email.primary && email.verified);
				if (primaryEmail) {
					userEmail = primaryEmail.email;
				}
			}
		}

		if (!userEmail) {
			return new Response('No verified email found on GitHub account.', {
				status: 400
			});
		}

		const existingUserByEmail = await getUserByEmail(userEmail);
		if (existingUserByEmail) {
			// user already exists, link github id
			await db
				.update(table.user)
				.set({ githubId: String(githubUser.id) })
				.where(eq(table.user.id, existingUserByEmail.id));

			const session = await createSession(existingUserByEmail.id);
			setSessionTokenCookie(event, session.id, session.expiresAt);
			return new Response(null, {
				status: 302,
				headers: {
					Location: '/account'
				}
			});
		}

		const user = await createUser({
			githubId: String(githubUser.id),
			email: userEmail,
			name: githubUser.name,
			picture: githubUser.avatar_url
		});
		const session = await createSession(user.id);
		setSessionTokenCookie(event, session.id, session.expiresAt);
		return new Response(null, {
			status: 302,
			headers: {
				Location: '/account'
			}
		});
	} catch (e) {
		console.log('[LS] -> src/routes/(public)/login/github/callback/+server.ts:85 -> e: ', e);
		// the specific error can be logged here
		return new Response('Authentication failed.', {
			status: 500
		});
	}
}

interface GitHubUser {
	id: number;
	name: string;
	avatar_url: string;
	email: string | null;
}

interface GitHubEmail {
	email: string;
	primary: boolean;
	verified: boolean;
	visibility: 'public' | 'private' | null;
}
