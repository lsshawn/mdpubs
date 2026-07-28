import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { organization } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { canManageOrg, getOrgRole, listPendingInvites, revokeInvite } from '$lib/server/org';
import type { RequestEvent } from './$types';

/**
 * Pending org invites.
 *   GET    → list pending invites (any member)
 *   DELETE { inviteId } → withdraw a pending invite (owner/admin)
 *
 * Sending an invite lives on ../members (POST), which decides between "add
 * existing user" and "invite a new email" based on whether the address already
 * has an account.
 */

async function requireOrg(event: RequestEvent) {
	const u = event.locals.user;
	if (!u) throw error(401, 'Unauthorized');
	const [org] = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.id, event.params.id))
		.limit(1);
	if (!org) throw error(404, 'Account not found');
	return { org, user: u };
}

export async function GET(event: RequestEvent) {
	const { org, user } = await requireOrg(event);
	if (!(await getOrgRole(org.id, user.id))) throw error(403, 'Forbidden');
	return json({ success: true, invites: await listPendingInvites(org.id) });
}

const revokeSchema = z.object({ inviteId: z.string().min(1) });

export async function DELETE(event: RequestEvent) {
	const { org, user } = await requireOrg(event);
	if (!(await canManageOrg(org.id, user.id))) throw error(403, 'Forbidden');

	const parsed = revokeSchema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ success: false, message: 'Provide an inviteId.' }, { status: 400 });
	}

	// Scoped to this org inside revokeInvite, so an id from another org is a no-op
	// rather than a cross-tenant delete.
	await revokeInvite(org.id, parsed.data.inviteId);
	return json({ success: true });
}
