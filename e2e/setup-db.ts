/**
 * Build the throwaway SQLite database the e2e dev server runs against:
 * the current Drizzle schema, two users with sessions, and the seed notes.
 * Run by playwright.config.ts before the server starts. Never touches a real DB.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { DB_FILE, DB_URL, MEMBER, NOTES, OWNER } from './fixtures.ts';

mkdirSync(dirname(DB_FILE), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(DB_FILE + suffix, { force: true });

// `export` prints the schema as SQL; it does not connect to or change any database.
const schema = execFileSync('npx', ['drizzle-kit', 'export', '--sql'], {
	env: { ...process.env, DATABASE_URL: DB_URL },
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'ignore']
});

const db = createClient({ url: DB_URL });
// WAL lets the specs read while the dev server writes.
await db.execute('PRAGMA journal_mode = WAL');
await db.executeMultiple(schema);

const now = Math.floor(Date.now() / 1000);
for (const u of [OWNER, MEMBER]) {
	await db.execute({
		sql: `insert into users (id, email, name, plan, is_verified, created_at) values (?, ?, ?, 'paid', 1, ?)`,
		args: [u.id, u.email, u.name, now]
	});
	await db.execute({
		sql: `insert into sessions (id, user_id, expires_at) values (?, ?, ?)`,
		args: [u.session, u.id, now + 86400 * 30]
	});
}
for (const [publicId, note] of Object.entries(NOTES)) {
	await db.execute({
		sql: `insert into notes (public_id, user_id, title, content, file_extension, version, created_at, updated_at, tags, is_private)
		      values (?, ?, 'Proposal', ?, 'md', 1, ?, ?, '[]', ?)`,
		args: [publicId, OWNER.id, note.content, now, now, note.isPrivate ? 1 : 0]
	});
}
db.close();
console.log(`e2e database ready: ${DB_FILE}`);
