import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The landing page is marketing copy for signed-out visitors. Anyone with a live
 * session has already read it, so send them straight to their notes — the same
 * place every in-app link points at.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		return redirect(302, '/notes');
	}
	return {};
};
