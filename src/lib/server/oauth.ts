import { Google, GitHub } from 'arctic';
import { config } from '$lib/config';
// $env/dynamic/private (runtime) rather than static/private (build-time inline),
// which fails the Cloudflare build when the secrets aren't in the build container.
import { env } from '$env/dynamic/private';

export const google = new Google(
	env.GOOGLE_CLIENT_ID,
	env.GOOGLE_CLIENT_SECRET,
	`${config.domain}/login/google/callback`
);

export const githubRedirectURL = `${config.domain}/login/github/callback`;

export const github = new GitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, githubRedirectURL);
