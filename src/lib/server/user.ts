import { db } from './db';
import { eq } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';

export async function createUser(values: {
	googleId?: string;
	githubId?: string;
	email: string;
	name: string | null;
	picture: string | null;
}): Promise<{ id: string }> {
	const [user] = await db.insert(table.user).values(values).returning({ id: table.user.id });
	return user;
}

export async function getUserFromGoogleId(googleId: string): Promise<User | null> {
	const rows = await db.select().from(table.user).where(eq(table.user.googleId, googleId));
	console.log('LS -> src/lib/server/user.ts:26 -> rows: ', rows);
	if (!rows.length) {
		return null;
	}
	return rows[0];
}

export async function getUserFromGithubId(githubId: string): Promise<User | null> {
	const rows = await db.select().from(table.user).where(eq(table.user.githubId, githubId));
	if (!rows.length) {
		return null;
	}
	return rows[0] as User;
}

export async function getUserByEmail(email: string): Promise<User | null> {
	const rows = await db.select().from(table.user).where(eq(table.user.email, email));
	if (!rows.length) {
		return null;
	}
	return rows[0] as User;
}

export interface User {
	id: string;
	email: string;
	googleId?: string | null;
	githubId?: string | null;
	name?: string | null;
	picture?: string | null;
}
