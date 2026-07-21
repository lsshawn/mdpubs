import { Google, GitHub } from 'arctic';
import { config } from '$lib/config';
// $env/dynamic/private (runtime) rather than static/private (build-time inline).
// The Arctic clients are created LAZILY on first access: SvelteKit's postbuild
// `analyse` imports this module in the build container (no OAuth secrets), and
// constructing with undefined credentials there risks throwing and failing the
// build (as Stripe does). Deferring to first use means construction only happens
// at request time, where the env is present.
import { env } from '$env/dynamic/private';

export const githubRedirectURL = `${config.domain}/login/github/callback`;

function bindProxy<T extends object>(resolve: () => T): T {
	return new Proxy({} as T, {
		get(_t, prop) {
			const target = resolve() as Record<string | symbol, unknown>;
			const value = target[prop];
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

let _google: Google | undefined;
let _github: GitHub | undefined;

export const google: Google = bindProxy(() => {
	if (!_google) {
		_google = new Google(
			env.GOOGLE_CLIENT_ID,
			env.GOOGLE_CLIENT_SECRET,
			`${config.domain}/login/google/callback`
		);
	}
	return _google;
});

export const github: GitHub = bindProxy(() => {
	if (!_github) {
		_github = new GitHub(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, githubRedirectURL);
	}
	return _github;
});
