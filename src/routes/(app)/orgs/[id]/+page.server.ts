import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { organization, orgMember, user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getOrgRole } from '$lib/server/org';
import { env as publicEnv } from '$env/dynamic/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(307, '/login');

	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.id, params.id))
		.limit(1);
	if (!org) throw error(404, 'Account not found');

	const role = await getOrgRole(org.id, locals.user.id);
	if (!role) throw error(403, 'You are not a member of this account.');

	const members = await db
		.select({
			userId: orgMember.userId,
			role: orgMember.role,
			email: userTable.email,
			name: userTable.name
		})
		.from(orgMember)
		.innerJoin(userTable, eq(orgMember.userId, userTable.id))
		.where(eq(orgMember.orgId, org.id));

	const cnameTarget =
		publicEnv.PUBLIC_CNAME_TARGET ?? `cname.${publicEnv.PUBLIC_DOMAIN ?? 'mdpubs.com'}`;

	return {
		org: {
			id: org.id,
			slug: org.slug,
			name: org.name,
			customDomain: org.customDomain,
			domainStatus: org.domainStatus
		},
		role,
		canManage: role === 'owner' || role === 'admin',
		members,
		currentUserId: locals.user.id,
		cnameTarget
	};
};
