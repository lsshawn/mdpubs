import { Google } from 'arctic';
import { dev } from '$app/environment';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '$env/static/private';

export const google = new Google(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	`${dev ? 'http://localhost:5173' : 'https://bunchofaitools.com'}/login/google/callback`
);
