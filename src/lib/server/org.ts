/**
 * Organization ("account") server helpers.
 *
 * An org is the entity behind `mdpubs-account: <slug>` frontmatter. It owns a
 * custom domain (docs.108labs.ai) and a set of notes. These helpers back:
 *   - custom-domain request routing (hooks.server.ts): host -> org
 *   - the org landing page ((public)/o/[org])
 *   - domain-provisioning endpoints (membership/role checks)
 */
import { db } from '$lib/server/db';
import { organization, orgMember } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Organization } from '$lib/server/db/schema';

export type OrgRole = 'owner' | 'admin' | 'member';

/** Resolve an org by its `mdpubs-account` slug. */
export async function getOrgBySlug(slug: string): Promise<Organization | null> {
	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.slug, slug.toLowerCase()))
		.limit(1);
	return org ?? null;
}

/**
 * Resolve an org by an incoming request host (its custom domain).
 *
 * Hot path — called on every request to a custom domain. The lookup is a single
 * indexed row read; callers wrap it in the Cloudflare Cache API (see
 * hooks.server.ts) so a hostname only hits Turso on a cache miss.
 */
export async function getOrgByDomain(host: string): Promise<Organization | null> {
	const domain = host.toLowerCase().split(':')[0]; // strip any :port
	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.customDomain, domain))
		.limit(1);
	return org ?? null;
}

/** The caller's role in an org, or null if not a member. */
export async function getOrgRole(orgId: string, userId: string): Promise<OrgRole | null> {
	const [m] = await db
		.select({ role: orgMember.role })
		.from(orgMember)
		.where(and(eq(orgMember.orgId, orgId), eq(orgMember.userId, userId)))
		.limit(1);
	return (m?.role as OrgRole) ?? null;
}

/** True if the user may manage the org's domain/settings (owner or admin). */
export async function canManageOrg(orgId: string, userId: string): Promise<boolean> {
	const role = await getOrgRole(orgId, userId);
	return role === 'owner' || role === 'admin';
}

export type ResolveOrgResult =
	| { ok: true; orgId: string | null } // orgId null = personal note (no org)
	| { ok: false; error: string };

/**
 * Hybrid org resolution for a synced note. Used by the sync path to decide which
 * org a note belongs to. The precedence is:
 *
 *   1. `mdpubs-account` frontmatter (explicit per-file choice), unless it's a
 *      "personal" sentinel ('none' / '' / 'personal') which forces no org.
 *   2. the user's `defaultOrgId` (their API key's default).
 *   3. null — a personal note.
 *
 * Whichever org is chosen, the user MUST be a member of it, or resolution fails.
 * The default is a convenience only; membership is the actual authorization gate,
 * so revoking membership blocks publishing without rotating the key.
 *
 * NOTE: the live sync endpoint is in the mdpubs-api repo; this helper mirrors the
 * logic so both repos share one definition of the rule. `slug` is the raw
 * frontmatter value (may be undefined/null); `defaultOrgId` comes off the user.
 */
export async function resolveNoteOrg(
	slug: string | null | undefined,
	userId: string,
	defaultOrgId: string | null | undefined
): Promise<ResolveOrgResult> {
	const raw = (slug ?? '').trim().toLowerCase();

	// Explicit "no org" sentinels force a personal note even if a default exists.
	const PERSONAL = new Set(['none', 'personal', 'me']);
	if (raw && PERSONAL.has(raw)) return { ok: true, orgId: null };

	if (raw) {
		const org = await getOrgBySlug(raw);
		if (!org) return { ok: false, error: `Unknown account "${slug}".` };
		const role = await getOrgRole(org.id, userId);
		if (!role) return { ok: false, error: `You are not a member of "${org.slug}".` };
		return { ok: true, orgId: org.id };
	}

	// No frontmatter → fall back to the key's default org (if any).
	if (defaultOrgId) {
		// Still verify membership — the default could be stale after a removal.
		const role = await getOrgRole(defaultOrgId, userId);
		if (!role) return { ok: true, orgId: null }; // silently demote to personal
		return { ok: true, orgId: defaultOrgId };
	}

	return { ok: true, orgId: null };
}
