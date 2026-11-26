/**
 * POST /api/orgs/[slug]/keys — make an API key limited to one company.
 *
 * The key acts as the person who made it, but only on notes filed under this
 * company (`mdpubs-company: <slug>`): it lists, reads, writes and embeds those
 * and nothing else of theirs. For handing to an app that should see one
 * company's documents, not the whole account. Owners and admins of the company
 * only. The key is shown once, here; it is listed and revoked on the account
 * page like any other.
 *
 * Body: { name?: string }   Returns: { key, company, name }
 */
import { type RequestEvent } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { requireApiAuth, isAuthError } from '#lib/server/api/auth.js';
import { db } from '#lib/server/db/index.js';
import { organization } from '#lib/server/db/schema.js';
import { canManageOrg } from '#lib/server/org.js';
import { issueToken } from '#lib/server/tokens.js';

export async function POST(event: RequestEvent): Promise<Response> {
	const auth = await requireApiAuth(event);
	if (isAuthError(auth)) return auth;
	const notFound = () =>
		Response.json({ error: 'Company not found, or you do not manage it.' }, { status: 404 });
	if (!auth.user || auth.isReadOnly) return notFound();

	const slug = (event.params.slug || '').toLowerCase();
	const [org] = await db
		.select({ id: organization.id, slug: organization.slug, name: organization.name })
		.from(organization)
		.where(and(eq(organization.slug, slug), isNull(organization.deletedAt)))
		.limit(1);
	if (!org || !(await canManageOrg(org.id, auth.user.id))) return notFound();

	const input = (await event.request.json().catch(() => null)) as { name?: unknown } | null;
	const name =
		typeof input?.name === 'string' && input.name.trim()
			? input.name.trim().slice(0, 80)
			: `${org.name} key`;
	const key = await issueToken({ userId: auth.user.id, kind: 'org', name, clientId: org.id });
	return Response.json(
		{ key, company: org.slug, name },
		{ status: 201, headers: { 'cache-control': 'private, no-store' } }
	);
}
