import { Google, GitHub } from 'arctic';
import { config } from '$lib/config';
import {
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET
} from '$env/static/private';

export const google = new Google(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	`${config.domain}/login/google/callback`
);

export const githubRedirectURL = `${config.domain}/login/github/callback`;

export const github = new GitHub(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, githubRedirectURL);
