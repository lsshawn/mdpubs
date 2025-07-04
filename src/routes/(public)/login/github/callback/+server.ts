import { github, githubRedirectURL } from '$lib/server/oauth';
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
				Authorization: `Bearer ${tokens.accessToken}`
			}
		});
		const githubUser: GitHubUser = await githubUserResponse.json();
		console.log(
			'[LS] -> src/routes/(public)/login/github/callback/+server.ts:30 -> githubUser: ',
			githubUser
		);

		const existingUser = await getUserFromGithubId(String(githubUser.id));

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

		const githubUserEmailsResponse = await fetch('https://api.github.com/user/emails', {
			headers: {
				Authorization: `Bearer ${tokens.accessToken}`
			}
		});
		const githubEmails: GitHubEmail[] = await githubUserEmailsResponse.json();

		const primaryEmail = githubEmails.find((email) => email.primary && email.verified);

		if (!primaryEmail) {
			return new Response('No primary verified email found on GitHub account.', {
				status: 400
			});
		}

		const existingUserByEmail = await getUserByEmail(primaryEmail.email);
		if (existingUserByEmail) {
			return new Response(
				'User with this email already exists. Please log in with your original method.',
				{
					status: 409
				}
			);
		}

		const user = await createUser({
			githubId: String(githubUser.id),
			email: primaryEmail.email,
			name: githubUser.name,
			picture: githubUser.avatar_url
		});
		const session = await createSession(user.id);
		setSessionTokenCookie(event, session.id, session.expiresAt);
		return new Response(null, {
			status: 302,
			headers: {
				Location: '/'
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
}

interface GitHubEmail {
	email: string;
	primary: boolean;
	verified: boolean;
	visibility: 'public' | 'private' | null;
}
