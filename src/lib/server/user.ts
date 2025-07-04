import { db } from './db';
import { eq } from 'drizzle-orm';
import * as table from '$lib/server/db/schema';

export async function createUser(
	googleId: string,
	email: string,
	name: string,
	picture: string
): Promise<User> {
	const rows = await db
		.insert(table.user)
		.values({ googleId, email, name, picture })
		.returning({ id: table.user.id });
	const user: User = {
		id: rows[0].id,
		googleId,
		email,
		name,
		picture
	};
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

export interface User {
	id: string;
	email: string;
	googleId: string;
	name: string;
}
