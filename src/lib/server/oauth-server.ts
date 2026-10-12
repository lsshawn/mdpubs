/**
 * The OAuth 2.1 authorization server that lets Claude and ChatGPT connect to
 * /mcp. (src/lib/server/oauth.ts is the other direction: us logging users in
 * with Google and GitHub.)
 *
 * Public clients only, registered dynamically (RFC 7591), authorization code +
 * PKCE S256. The access token is a normal `mdp_` tool token (tokens.ts) with no
 * expiry: it lives until the user disconnects it on the account page or their
 * subscription lapses, so there is no refresh grant.
 */
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { oauthClient, oauthCode } from '#lib/server/db/schema.js';
import { issueToken, pkceS256, randomSecret, sha256Hex } from '#lib/server/tokens.js';

const CODE_TTL_MS = 5 * 60 * 1000;

export class OAuthError extends Error {
	constructor(
		public code: string,
		message: string
	) {
		super(message);
	}
}

/** https anywhere, http only to this machine, or an app's own scheme (e.g. cursor://). */
function allowedRedirect(uri: string): boolean {
	let u: URL;
	try {
		u = new URL(uri);
	} catch {
		return false;
	}
	if (u.hash) return false;
	if (u.protocol === 'https:') return true;
	if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
	return !['javascript:', 'data:', 'file:', 'blob:', 'vbscript:'].includes(u.protocol);
}

export async function registerClient(body: unknown) {
	const b = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
	const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
	if (uris.length === 0 || !uris.every((u) => typeof u === 'string' && allowedRedirect(u))) {
		throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https or loopback URLs');
	}
	const name =
		typeof b.client_name === 'string' && b.client_name.trim()
			? b.client_name.trim().slice(0, 80)
			: 'AI assistant';
	const [client] = await db
		.insert(oauthClient)
		.values({ name, redirectUris: uris as string[] })
		.returning();
	return client;
}

export async function getClient(id: string | null) {
	if (!id) return null;
	const [client] = await db.select().from(oauthClient).where(eq(oauthClient.id, id)).limit(1);
	return client ?? null;
}

export async function createAuthCode(opts: {
	clientId: string;
	userId: string;
	redirectUri: string;
	codeChallenge: string;
}): Promise<string> {
	const code = randomSecret();
	await db.insert(oauthCode).values({
		codeHash: sha256Hex(code),
		clientId: opts.clientId,
		userId: opts.userId,
		redirectUri: opts.redirectUri,
		codeChallenge: opts.codeChallenge,
		expiresAt: new Date(Date.now() + CODE_TTL_MS)
	});
	return code;
}

/** Exchange a code for an access token. Single use: a replayed code fails. */
export async function redeemAuthCode(p: {
	code: string;
	clientId: string;
	redirectUri: string;
	codeVerifier: string;
}): Promise<string> {
	const [claimed] = await db
		.update(oauthCode)
		.set({ usedAt: new Date() })
		.where(
			and(
				eq(oauthCode.codeHash, sha256Hex(p.code)),
				isNull(oauthCode.usedAt),
				gt(oauthCode.expiresAt, new Date())
			)
		)
		.returning();
	if (!claimed) throw new OAuthError('invalid_grant', 'code is invalid, expired or already used');
	if (claimed.clientId !== p.clientId || claimed.redirectUri !== p.redirectUri) {
		throw new OAuthError('invalid_grant', 'client_id or redirect_uri does not match');
	}
	if (pkceS256(p.codeVerifier) !== claimed.codeChallenge) {
		throw new OAuthError('invalid_grant', 'code_verifier does not match');
	}
	const client = await getClient(claimed.clientId);
	return issueToken({
		userId: claimed.userId,
		kind: 'mcp',
		name: client?.name ?? 'AI assistant',
		clientId: claimed.clientId
	});
}

export const corsHeaders = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
	'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
	'access-control-expose-headers': 'www-authenticate'
};

export function oauthJson(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: { ...corsHeaders, 'cache-control': 'no-store' }
	});
}

export function preflight(): Response {
	return new Response(null, { status: 204, headers: corsHeaders });
}
