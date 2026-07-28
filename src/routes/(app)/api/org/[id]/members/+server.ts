import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { organization, orgMember, user as userTable } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { canManageOrg, getOrgRole, inviteToOrg, listPendingInvites } from '$lib/server/org';
import type { RequestEvent } from './$types';

/**
 * Org membership management (owner/admin only for writes).
 *   GET    → list members + pending invites
 *   POST   { email, role? }  → add by email; invites the address if it has no
 *                              account yet (claimed on their first login)
 *   DELETE { userId }        → remove a member
 *
 * Pending invites are withdrawn via ./invites (DELETE { inviteId }).
 */

async function requireOrg(event: RequestEvent) {
	const u = event.locals.user;
	if (!u) throw error(401, 'Unauthorized');
	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.id, event.params.id))
		.limit(1);
	if (!org) throw error(404, 'Account not found');
	return { org, user: u };
}

export async function GET(event: RequestEvent) {
	const { org, user } = await requireOrg(event);
	// Any member can view the roster.
	if (!(await getOrgRole(org.id, user.id))) throw error(403, 'Forbidden');

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

	return json({ success: true, members, invites });
}

const addSchema = z.object({
	email: z.string().trim().toLowerCase().email(),
	role: z.enum(['admin', 'member']).default('member')
});

export async function POST(event: RequestEvent) {
	const { org, user } = await requireOrg(event);
	if (!(await canManageOrg(org.id, user.id))) throw error(403, 'Forbidden');

	const parsed = addSchema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ success: false, message: parsed.error.errors[0].message }, { status: 400 });
	}
	const { email, role } = parsed.data;

	try {
		const result = await inviteToOrg(org.id, email, role, user.id);
		if (!result.ok) {
			return json({ success: false, message: result.error }, { status: 409 });
		}
		// 'added' → the email already had an account and is a member now.
		// 'invited' → no account yet; they join automatically on first login.
		return json({ success: true, status: result.status });
	} catch (e) {
		console.error('Invite/add member failed:', e);
		return json({ success: false, message: 'Could not add that person.' }, { status: 500 });
	}
}

const removeSchema = z.object({ userId: z.string().min(1) });

export async function DELETE(event: RequestEvent) {
	const { org, user } = await requireOrg(event);
	if (!(await canManageOrg(org.id, user.id))) throw error(403, 'Forbidden');

	const parsed = removeSchema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ success: false, message: 'Provide a userId.' }, { status: 400 });
	}
	const { userId } = parsed.data;

	// Never allow removing the last owner (would orphan the org).
	const owners = await db
		.select({ userId: orgMember.userId })
		.from(orgMember)
		.where(and(eq(orgMember.orgId, org.id), eq(orgMember.role, 'owner')));
	if (owners.length === 1 && owners[0].userId === userId) {
		return json(
			{ success: false, message: 'Cannot remove the only owner. Assign another owner first.' },
			{ status: 409 }
		);
	}

	await db.delete(orgMember).where(and(eq(orgMember.orgId, org.id), eq(orgMember.userId, userId)));
	return json({ success: true });
}
