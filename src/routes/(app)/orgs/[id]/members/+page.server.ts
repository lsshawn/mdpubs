import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { organization, orgMember, user as userTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getOrgRole, listPendingInvites } from '$lib/server/org';
import type { PageServerLoad } from './$types';

/**
 * Company members + pending invites. Any member can see the roster; only
 * owners/admins can invite or remove (enforced again in the API routes — this
 * flag only decides what the UI offers).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) redirect(307, '/login');

	const [org] = await db
		.select({ id: organization.id, slug: organization.slug, name: organization.name })
		.from(organization)
		.where(eq(organization.id, params.id))
		.limit(1);
	if (!org) throw error(404, 'Account not found');

	const role = await getOrgRole(org.id, locals.user.id);
	if (!role) throw error(403, 'You are not a member of this account.');

	const [members, invites] = await Promise.all([
		db
			.select({
				userId: orgMember.userId,
				role: orgMember.role,
				email: userTable.email,
				name: userTable.name
			})
			.from(orgMember)
			.innerJoin(userTable, eq(orgMember.userId, userTable.id))
			.where(eq(orgMember.orgId, org.id)),
		listPendingInvites(org.id)
	]);

	return {
		org,
		role,
		canManage: role === 'owner' || role === 'admin',
		members,
		invites,
		currentUserId: locals.user.id
	};
};
