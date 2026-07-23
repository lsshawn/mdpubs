import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { organization, orgMember } from '$lib/server/db/schema';
import type { RequestEvent } from './$types';

/**
 * Create a new org. The creator becomes its owner. The slug is the value used in
 * `mdpubs-account:` frontmatter and must be URL-safe and unique.
 */
const createSchema = z.object({
	name: z.string().trim().min(1).max(80),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.min(2)
		.max(40)
		.regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug: lowercase letters, numbers and hyphens only.')
});

export async function POST(event: RequestEvent) {
	const user = event.locals.user;
	if (!user) throw error(401, 'Unauthorized');

	const parsed = createSchema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ success: false, message: parsed.error.errors[0].message }, { status: 400 });
	}
	const { name, slug } = parsed.data;

	try {
		const [org] = await db.insert(organization).values({ name, slug }).returning();
		await db.insert(orgMember).values({ orgId: org.id, userId: user.id, role: 'owner' });
		return json({ success: true, org: { id: org.id, slug: org.slug, name: org.name } });
	} catch (e) {
		if (e instanceof Error && e.message.includes('UNIQUE constraint')) {
			return json({ success: false, message: `The slug "${slug}" is already taken.` }, { status: 409 });
		}
		console.error('Org creation failed:', e);
		return json({ success: false, message: 'Could not create the account.' }, { status: 500 });
	}
}
