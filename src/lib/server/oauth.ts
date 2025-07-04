import { Google, GitHub } from 'arctic';
import { app } from '$lib/config';
import {
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET
} from '$env/static/private';

export const google = new Google(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	`https://${app.domain}/login/google/callback`
);

export const githubRedirectURL = `http://${app.domain}/login/github/callback`;

export const github = new GitHub(GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, githubRedirectURL);
