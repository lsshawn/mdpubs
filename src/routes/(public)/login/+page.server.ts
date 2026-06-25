import { redirect } from '@sveltejs/kit';

import type { RequestEvent } from './$types';

/**
 * Only allow same-site, absolute-path redirects (e.g. `/123`) so a crafted
 * `redirectTo` can't bounce users to another origin after login.
 */
function safeRedirect(target: string | null): string {
	if (target && target.startsWith('/') && !target.startsWith('//')) {
		return target;
	}
	return '/account';
}

export async function load(event: RequestEvent) {
	const redirectTo = safeRedirect(event.url.searchParams.get('redirectTo'));

	if (event.locals.session !== null && event.locals.user !== null) {
		return redirect(302, redirectTo);
	}
	return { redirectTo };
}
