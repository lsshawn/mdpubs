import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { organization, orgMember } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';

/**
 * Data for the dashboard shell (src/routes/(app)/+layout.svelte).
 *
 * The org list feeds the sidebar's company switcher, so it is loaded once here
 * rather than per-page. `activeOrgId` is the *switcher's* selection and is
 * distinct from `defaultOrgId`: the default is the publishing fallback used when
 * a note carries no `mdpubs-company` frontmatter, while the active org is just
 * which workspace the UI is currently showing. Selecting "Personal" leaves the
 * default untouched.
 */
export const load: LayoutServerLoad = async (event) => {
	if (!event.locals.session || !event.locals.user) {
		redirect(307, '/login');
	}

	const orgs = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			role: orgMember.role
		})
		.from(orgMember)
		.innerJoin(organization, eq(orgMember.orgId, organization.id))
		.where(eq(orgMember.userId, event.locals.user.id));

	return {
		user: event.locals.user,
		session: event.locals.session,
		orgs,
		defaultOrgId: event.locals.user.defaultOrgId ?? null
	};
};
