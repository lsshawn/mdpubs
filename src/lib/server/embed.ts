/**
 * Embed tokens: how another app shows a note inside its own pages.
 *
 * The host app's server asks for a token with the API key it already holds
 * (POST /api/notes/[id]/embed), naming the person who is logged in over there.
 * It then loads `https://mdpubs.com/<id>?embed=<token>` in an iframe. The token:
 *
 * - opens that one note, private or not, until it expires;
 * - says who is reading, so their comments carry their name and stay theirs
 *   across visits, with no mdpubs account and no name prompt.
 *
 * It grants reading and commenting only. It is signed with the note owner's
 * stored API-key hash, so there is no extra secret to configure, and rotating
 * the API key cancels every token made with it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user as userTable } from '#lib/server/db/schema.js';

export const EMBED_PREFIX = 'mde_';
const DEFAULT_TTL = 60 * 60;
const MAX_TTL = 24 * 60 * 60;

export type EmbedGrant = {
	/** The note's public id. */
	n: string;
	/** The note owner's user id: whose key signed this. */
	o: string;
	/** The reader's id in the host app. */
	u: string;
	/** The reader's name, shown on their comments. */
	m: string;
	/** Comments on, even when the note's frontmatter does not ask for them. */
	c: boolean;
	/** The history button shown. */
	h: boolean;
	/** Expiry, in seconds since 1970. */
	e: number;
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

async function signingKey(ownerId: string): Promise<string | null> {
	const [row] = await db
		.select({ apiKey: userTable.apiKey })
		.from(userTable)
		.where(eq(userTable.id, ownerId))
		.limit(1);
	return row?.apiKey ? `mdpubs-embed:${row.apiKey}` : null;
}

const sign = (key: string, payload: string) =>
	createHmac('sha256', key).update(payload).digest('base64url');

export type EmbedRequest = {
	viewer?: { id?: unknown; name?: unknown };
	comments?: unknown;
	history?: unknown;
	ttl?: unknown;
};

/** A token for `publicId`, owned by `ownerId`. Null when the owner has no API key to sign with. */
export async function mintEmbedToken(
	publicId: string,
	ownerId: string,
	input: EmbedRequest
): Promise<{ token: string; expiresAt: number } | { error: string }> {
	const id = input.viewer?.id;
	const name = input.viewer?.name;
	const u = typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '';
	const m = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
	if (!u || u.length > 200) return { error: 'viewer.id is required (up to 200 characters).' };
	if (!m || m.length > 60) return { error: 'viewer.name is required (up to 60 characters).' };
	const ttl =
		typeof input.ttl === 'number' && input.ttl > 0
			? Math.min(Math.floor(input.ttl), MAX_TTL)
			: DEFAULT_TTL;
	const key = await signingKey(ownerId);
	if (!key) return { error: 'The owner of this note has no API key to sign with.' };
	const grant: EmbedGrant = {
		n: publicId,
		o: ownerId,
		u,
		m,
		c: input.comments !== false,
		h: input.history !== false,
		e: Math.floor(Date.now() / 1000) + ttl
	};
	const payload = b64(JSON.stringify(grant));
	return { token: `${EMBED_PREFIX}${payload}.${sign(key, payload)}`, expiresAt: grant.e * 1000 };
}

/** The token on a request: the `x-embed-token` header, or `?embed=` for URLs a browser loads itself. */
export function embedTokenOf(request: Request, url: URL): string | null {
	return request.headers.get('x-embed-token') || url.searchParams.get('embed') || null;
}

/**
 * What a token grants for note `publicId`, or null when it is missing, forged,
 * expired or for another note. The caller must still check that the note's
 * owner is `grant.o` (see `embedAllows`): a token is only as good as the key
 * that signed it.
 */
export async function readEmbedGrant(
	token: string | null,
	publicId: string | undefined
): Promise<EmbedGrant | null> {
	if (!token || !publicId || !token.startsWith(EMBED_PREFIX)) return null;
	const [payload, sig, extra] = token.slice(EMBED_PREFIX.length).split('.');
	if (!payload || !sig || extra !== undefined) return null;
	let grant: EmbedGrant;
	try {
		grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
	if (
		!grant ||
		typeof grant.n !== 'string' ||
		typeof grant.o !== 'string' ||
		typeof grant.u !== 'string' ||
		typeof grant.m !== 'string' ||
		typeof grant.e !== 'number'
	) {
		return null;
	}
	if (grant.n !== publicId || grant.e * 1000 < Date.now()) return null;
	const key = await signingKey(grant.o);
	if (!key) return null;
	const want = Buffer.from(sign(key, payload));
	const got = Buffer.from(sig);
	if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
	return grant;
}

/** The grant, if it was signed by this note's owner. */
export function embedAllows(grant: EmbedGrant | null, note: { userId: string }): EmbedGrant | null {
	return grant && grant.o === note.userId ? grant : null;
}

/** The secret that marks a host-app reader's comments as theirs, visit after visit. */
export function embedCommentKey(grant: EmbedGrant): string {
	return `embed:${grant.o}:${grant.u}`;
}
