/**
 * API authentication for the native `/api/*` routes.
 *
 * Ported from the old Hono `middleware/auth.ts`. Instead of Hono middleware that
 * sets context vars, this is a plain resolver each `+server.ts` calls. It reads
 * the token from `X-API-Key` or `Authorization: Bearer`, and resolves auth in
 * the same precedence as before: admin key → API key (rw/ro) → session token.
 *
 * Returns an `ApiAuth` on success, or a `Response` (JSON error) the route should
 * return directly — mirroring the middleware's early-return behaviour so status
 * codes and messages are byte-identical to the old API.
 */
import { eq } from 'drizzle-orm';
import { json, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { session, user as userSchema, type User } from '$lib/server/db/schema';
import { UserService } from './services/user';
import { InvalidAPIKeyError } from './db';

const userService = new UserService();

export type ApiAuth = {
	user: User | null; // null only for the admin key
	isAdmin: boolean;
	isReadOnly: boolean;
};

function getToken(request: Request): string | undefined {
	const key = request.headers.get('x-api-key');
	if (key) return key;
	const authHeader = request.headers.get('authorization');
	if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7);
	return undefined;
}

/**
 * Resolve a token to auth. Returns `ApiAuth` or a `Response` (error) to return.
 * `method` is used to reject non-GET requests made with a read-only key.
 */
async function authenticate(token: string, method: string): Promise<ApiAuth | Response> {
	const adminAPIKey = env.ADMIN_API_KEY;
	if (adminAPIKey && token === adminAPIKey) {
		return { user: null, isAdmin: true, isReadOnly: false };
	}

	const isReadOnlyKey = token.startsWith('ro_');
	try {
		let user: User;
		if (isReadOnlyKey) {
			user = await userService.getUserByReadOnlyAPIKey(token);
			if (method !== 'GET') {
				return json({ error: 'Read-only API key can only be used for GET requests' }, { status: 403 });
			}
		} else {
			user = await userService.getUserByAPIKey(token);
		}
		return { user, isAdmin: false, isReadOnly: isReadOnlyKey };
	} catch (error) {
		if (!(error instanceof InvalidAPIKeyError)) {
			console.error('API key authentication error:', error);
			return json({ error: 'Authentication failed' }, { status: 500 });
		}
		// Fall through: maybe it's a session token.
	}

	try {
		const sessionResult = await db.select().from(session).where(eq(session.id, token)).limit(1);
		if (sessionResult.length > 0) {
			const sess = sessionResult[0];
			if (sess.expiresAt < new Date()) {
				return json({ error: 'Session expired' }, { status: 401 });
			}
			const userResult = await db
				.select()
				.from(userSchema)
				.where(eq(userSchema.id, sess.userId))
				.limit(1);
			if (userResult.length > 0) {
				return { user: userResult[0], isAdmin: false, isReadOnly: false };
			}
		}
	} catch (error) {
		console.error('Session authentication error:', error);
		return json({ error: 'Authentication failed' }, { status: 500 });
	}

	return json(
		{ error: isReadOnlyKey ? 'Invalid read-only API key' : 'Invalid API key or session token' },
		{ status: 401 }
	);
}

/**
 * Load the full User row for a cookie-authenticated session user. `locals.user`
 * is a narrowed projection; the API services need the full row.
 */
async function fullUserFromLocals(
	locals: RequestEvent['locals']
): Promise<User | null> {
	if (!locals.user) return null;
	const [row] = await db.select().from(userSchema).where(eq(userSchema.id, locals.user.id)).limit(1);
	return row ?? null;
}

/**
 * Required auth. Accepts (in precedence): X-API-Key / Bearer token, then the
 * session cookie already validated by hooks.server.ts (event.locals.user).
 * 401 if neither is present/valid. Returns ApiAuth or a Response to return.
 */
export async function requireApiAuth(event: RequestEvent): Promise<ApiAuth | Response> {
	const token = getToken(event.request);
	if (token) return authenticate(token, event.request.method);

	// Cookie-session fallback (same-origin browser requests, e.g. the dashboard).
	const user = await fullUserFromLocals(event.locals);
	if (user) return { user, isAdmin: false, isReadOnly: false };

	return json(
		{
			error:
				'API key or session token is required. Provide it via X-API-Key header or Authorization: Bearer <token>'
		},
		{ status: 401 }
	);
}

/**
 * Optional auth: no credential → anonymous ({user:null,...}). A PRESENT but
 * invalid token still errors (matches the old optionalAuthMiddleware). A valid
 * session cookie is honoured as the caller.
 */
export async function optionalApiAuth(event: RequestEvent): Promise<ApiAuth | Response> {
	const token = getToken(event.request);
	if (token) return authenticate(token, event.request.method);

	const user = await fullUserFromLocals(event.locals);
	if (user) return { user, isAdmin: false, isReadOnly: false };

	return { user: null, isAdmin: false, isReadOnly: false };
}

/** Type guard: did the resolver hand back an error Response? */
export function isAuthError(v: ApiAuth | Response): v is Response {
	return v instanceof Response;
}
