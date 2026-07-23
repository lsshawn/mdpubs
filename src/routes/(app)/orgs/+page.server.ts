import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { organization, orgMember } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

/**
 * Lists the orgs the current user belongs to (with their role) plus which one is
 * their publishing default. The create/join actions POST to /api/org.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(307, '/login');

	const rows = await db
		.select({
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			customDomain: organization.customDomain,
			domainStatus: organization.domainStatus,
			role: orgMember.role
		})
		.from(orgMember)
		.innerJoin(organization, eq(orgMember.orgId, organization.id))
		.where(eq(orgMember.userId, locals.user.id));

	return {
		orgs: rows,
		defaultOrgId: locals.user.defaultOrgId ?? null
	};
};
