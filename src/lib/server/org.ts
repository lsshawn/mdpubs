/**
 * Organization ("account") server helpers.
 *
 * An org is the entity behind `mdpubs-company: <slug>` frontmatter. It owns a
 * custom domain (docs.108labs.ai) and a set of notes. These helpers back:
 *   - custom-domain request routing (hooks.server.ts): host -> org
 *   - the org landing page ((public)/o/[org])
 *   - domain-provisioning endpoints (membership/role checks)
 */
import { db } from '$lib/server/db';
import { organization, orgInvite, orgMember, user as userTable } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { Organization } from '$lib/server/db/schema';

export type OrgRole = 'owner' | 'admin' | 'member';

/** Resolve an org by its `mdpubs-company` slug. */
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
 *   1. `mdpubs-company` frontmatter (explicit per-file choice), unless it's a
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

// --- Invitations -----------------------------------------------------------

export type InviteRole = 'admin' | 'member';

export type InviteResult =
	| { ok: true; status: 'added' } // invitee already had an account → member now
	| { ok: true; status: 'invited' } // no account yet → pending invite
	| { ok: false; error: string };

/**
 * Invite an email to an org.
 *
 * If the email already belongs to an MdPubs user we skip the invite entirely and
 * add the membership row directly — there is nothing to wait for. Otherwise we
 * record a pending invite that is claimed the first time that email logs in
 * (acceptPendingInvites, wired into createSession).
 *
 * Re-inviting a pending email is idempotent: it refreshes the role rather than
 * erroring, so fixing a mis-typed role doesn't require a revoke first.
 */
export async function inviteToOrg(
	orgId: string,
	email: string,
	role: InviteRole,
	invitedByUserId: string
): Promise<InviteResult> {
	const normalized = email.trim().toLowerCase();

	const [existing] = await db
		.select({ id: userTable.id })
		.from(userTable)
		.where(eq(userTable.email, normalized))
		.limit(1);

	if (existing) {
		if (await getOrgRole(orgId, existing.id)) {
			return { ok: false, error: 'That user is already a member.' };
		}
		await db.insert(orgMember).values({ orgId, userId: existing.id, role });
		return { ok: true, status: 'added' };
	}

	// No account yet — upsert a pending invite. onConflictDoUpdate keeps the
	// (orgId, email) unique index authoritative instead of racing a select+insert.
	await db
		.insert(orgInvite)
		.values({ orgId, email: normalized, role, invitedByUserId })
		.onConflictDoUpdate({
			target: [orgInvite.orgId, orgInvite.email],
			set: { role, invitedByUserId, acceptedAt: null }
		});
	return { ok: true, status: 'invited' };
}

/** Pending (unaccepted) invites for an org, for the members UI. */
export async function listPendingInvites(orgId: string) {
	return db
		.select({
			id: orgInvite.id,
			email: orgInvite.email,
			role: orgInvite.role,
			createdAt: orgInvite.createdAt
		})
		.from(orgInvite)
		.where(and(eq(orgInvite.orgId, orgId), isNull(orgInvite.acceptedAt)));
}

/** Withdraw a pending invite. Accepted invites are audit rows and are left alone. */
export async function revokeInvite(orgId: string, inviteId: string): Promise<void> {
	await db
		.delete(orgInvite)
		.where(
			and(eq(orgInvite.id, inviteId), eq(orgInvite.orgId, orgId), isNull(orgInvite.acceptedAt))
		);
}

/**
 * Claim every pending invite addressed to this user's email.
 *
 * Called from createSession, so it runs on ANY successful login (OAuth signup,
 * OAuth login, OTP) — one hook instead of five. Best-effort by design: a failure
 * here must never block a login, so callers swallow errors and the invite simply
 * stays pending until the next login.
 *
 * Returns the number of orgs joined.
 */
export async function acceptPendingInvites(userId: string): Promise<number> {
	const [u] = await db
		.select({ email: userTable.email })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.limit(1);
	if (!u?.email) return 0;

	const email = u.email.toLowerCase();
	const pending = await db
		.select({ id: orgInvite.id, orgId: orgInvite.orgId, role: orgInvite.role })
		.from(orgInvite)
		.where(and(eq(orgInvite.email, email), isNull(orgInvite.acceptedAt)));
	if (!pending.length) return 0;

	let joined = 0;
	for (const invite of pending) {
		// Ignore a conflict on (orgId, userId): the user may already be a member if
		// they were added directly after the invite was sent. Either way the invite
		// is settled, so it still gets stamped below.
		await db
			.insert(orgMember)
			.values({ orgId: invite.orgId, userId, role: invite.role })
			.onConflictDoNothing();
		await db.update(orgInvite).set({ acceptedAt: new Date() }).where(eq(orgInvite.id, invite.id));
		joined++;
	}
	return joined;
}
