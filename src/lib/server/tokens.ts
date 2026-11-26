/**
 * Tokens for AI tools: the `mdpubs` CLI and MCP connectors.
 *
 * Both flows (device login in src/routes/api/cli, OAuth in src/routes/oauth)
 * end by calling `issueToken`, and both kinds authenticate through the same
 * `mdp_` prefix check in src/lib/server/api/auth.ts. Only hashes are stored.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64urlNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { db } from '#lib/server/db/index.js';
import { apiToken, organization, user, type User } from '#lib/server/db/schema.js';

export const TOKEN_PREFIX = 'mdp_';

export function randomSecret(bytes = 32): string {
	return encodeBase64urlNoPadding(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function sha256Hex(value: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(value)));
}

/** SHA-256 then base64url, the PKCE S256 transform (RFC 7636). */
export function pkceS256(verifier: string): string {
	return encodeBase64urlNoPadding(sha256(new TextEncoder().encode(verifier)));
}

/** No free tier: a tool only gets a token, and only keeps working, on a paid plan. */
export function isPaid(u: Pick<User, 'plan'>): boolean {
	return !!u.plan && u.plan !== 'free';
}

export async function issueToken(opts: {
	userId: string;
	kind: 'cli' | 'mcp' | 'org';
	name: string;
	/** For 'mcp' the OAuth client; for 'org' the organization the key is limited to. */
	clientId?: string;
}): Promise<string> {
	const raw = TOKEN_PREFIX + randomSecret();
	await db.insert(apiToken).values({
		userId: opts.userId,
		tokenHash: sha256Hex(raw),
		kind: opts.kind,
		name: opts.name,
		clientId: opts.clientId ?? null
	});
	return raw;
}

/**
 * The user behind a live token, and the one organization it is limited to
 * (null: everything of the user's). Null if the token is unknown or revoked.
 */
export async function resolveToken(
	raw: string
): Promise<{ user: User; orgScope: string | null } | null> {
	const [row] = await db
		.select({ tokenId: apiToken.id, kind: apiToken.kind, clientId: apiToken.clientId, user })
		.from(apiToken)
		.innerJoin(user, eq(apiToken.userId, user.id))
		.where(and(eq(apiToken.tokenHash, sha256Hex(raw)), isNull(apiToken.revokedAt)))
		.limit(1);
	if (!row) return null;
	// An org key with no org on record is broken, not unlimited.
	if (row.kind === 'org' && !row.clientId) return null;
	await db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.tokenId));
	return { user: row.user, orgScope: row.kind === 'org' ? row.clientId : null };
}

/** The user behind a live, unlimited token. An org-limited key is not one: it gets null here. */
export async function userForToken(raw: string): Promise<User | null> {
	const found = await resolveToken(raw);
	return found && !found.orgScope ? found.user : null;
}

export async function listTokens(userId: string) {
	return db
		.select({
			id: apiToken.id,
			kind: apiToken.kind,
			name: apiToken.name,
			createdAt: apiToken.createdAt,
			lastUsedAt: apiToken.lastUsedAt
		})
		.from(apiToken)
		.where(and(eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
		.orderBy(desc(apiToken.createdAt));
}

export async function revokeToken(userId: string, id: string): Promise<void> {
	await db
		.update(apiToken)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiToken.id, id), eq(apiToken.userId, userId)));
}

/**
 * Where a client opens a note: the org's branded domain once it is live,
 * otherwise this site.
 */
export async function noteUrl(
	n: { publicId: string; orgId: string | null },
	origin: string
): Promise<string> {
	if (n.orgId) {
		const [org] = await db
			.select({ customDomain: organization.customDomain, status: organization.domainStatus })
			.from(organization)
			.where(eq(organization.id, n.orgId))
			.limit(1);
		if (org?.customDomain && org.status === 'active') {
			return `https://${org.customDomain}/${n.publicId}`;
		}
	}
	return `${origin}/${n.publicId}`;
}
