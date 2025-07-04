import { eq } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';
import type { Session } from '$lib/server/db/schema';
import type { RequestEvent } from '@sveltejs/kit';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'auth-session';

function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	const token = encodeBase32LowerCaseNoPadding(bytes);
	return token;
}

export async function createSession(userId: string): Promise<Session> {
	const token = generateSessionToken();
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const expiresAt = Math.floor((Date.now() + DAY_IN_MS * 30) / 1000);
	const session = {
		id: sessionId,
		userId,
		expiresAt
	};

	try {
		await db.insert(table.session).values({
			...session,
			expiresAt: sql`${expiresAt}`
		});
		return session;
	} catch (error) {
		console.error('Session creation error:', error);
		throw error;
	}
}

export async function invalidateSession(sessionId: string): Promise<void> {
	await db.delete(table.session).where(eq(table.session.id, sessionId));
}

export async function validateSession(sessionId: string) {
	const [result] = await db
		.select({
			user: { id: table.user.id, email: table.user.email },
			session: table.session
		})
		.from(table.session)
		.innerJoin(table.user, eq(table.session.userId, table.user.id))
		.where(eq(table.session.id, sessionId));

	if (!result) {
		return { session: null, user: null };
	}
	const { session, user } = result;

	const sessionExpired = Date.now() / 1000 >= session.expiresAt;
	if (sessionExpired) {
		await db.delete(table.session).where(eq(table.session.id, session.id));
		return { session: null, user: null };
	}

	const renewSession = Date.now() / 1000 >= session.expiresAt - (DAY_IN_MS / 1000) * 15;
	if (renewSession) {
		const newExpiresAt = Math.floor(Date.now() / 1000 + (DAY_IN_MS / 1000) * 30);
		await db
			.update(table.session)
			.set({ expiresAt: sql`${newExpiresAt}` })
			.where(eq(table.session.id, session.id));
		session.expiresAt = newExpiresAt;
	}

	return { session, user };
}

export function setSessionTokenCookie(event: RequestEvent, token: string, expiresAt: number): void {
	event.cookies.set(sessionCookieName, token, {
		httpOnly: true,
		path: '/',
		secure: import.meta.env.PROD,
		sameSite: 'lax',
		// convert back to date for cookie
		expires: new Date(expiresAt * 1000)
	});
}

export function deleteSessionTokenCookie(event: RequestEvent): void {
	event.cookies.set(sessionCookieName, '', {
		httpOnly: true,
		path: '/',
		secure: import.meta.env.PROD,
		sameSite: 'lax',
		maxAge: 0
	});
}

export type SessionValidationResult = Awaited<ReturnType<typeof validateSession>>;
