import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getOrgRole } from '$lib/server/org';
import type { RequestEvent } from './$types';

/**
 * Set (or clear) the caller's default org — the org their API key publishes to
 * when a synced note has no `mdpubs-company` frontmatter (hybrid resolution).
 *
 *   PUT { orgId: string }  → set default (must be a member of that org)
 *   PUT { orgId: null }    → clear default (notes default to personal)
 */
const schema = z.object({ orgId: z.string().min(1).nullable() });

export async function PUT(event: RequestEvent) {
	const currentUser = event.locals.user;
	if (!currentUser) throw error(401, 'Unauthorized');

	const parsed = schema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ success: false, message: 'Provide an orgId or null.' }, { status: 400 });
	}
	const { orgId } = parsed.data;

	// Only allow defaulting to an org you belong to.
	if (orgId) {
		const role = await getOrgRole(orgId, currentUser.id);
		if (!role) {
			return json({ success: false, message: 'You are not a member of that account.' }, { status: 403 });
		}
	}

	await db.update(user).set({ defaultOrgId: orgId }).where(eq(user.id, currentUser.id));
	return json({ success: true, defaultOrgId: orgId });
}
