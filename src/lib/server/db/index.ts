import { dev } from '$app/environment';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import * as feedbackSchema from './feedback.schema';
import { env } from '$env/dynamic/private';

// The DB clients are created LAZILY, on first access — not at module load.
// SvelteKit's postbuild `analyse` step imports every server module in the build
// container (which has no DATABASE_URL), so any top-level env read / client
// creation would throw and fail the build. Deferring to first use means the
// connection is only established at request time, where the Worker env has the
// vars. `db` / `feedbackDb` remain importable values via getters.

type DB = ReturnType<typeof drizzle<typeof schema>>;
type FeedbackDB = ReturnType<typeof drizzle<typeof feedbackSchema>>;

let _db: DB | undefined;
let _feedbackDb: FeedbackDB | undefined;

function getDb(): DB {
	if (!_db) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
		if (!dev && !env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');
		_db = drizzle(createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN }), {
			schema
		});
	}
	return _db;
}

function getFeedbackDb(): FeedbackDB {
	if (!_feedbackDb) {
		if (!env.FEEDBACK_DATABASE_URL) throw new Error('FEEDBACK_DATABASE_URL is not set');
		if (!dev && !env.FEEDBACK_DATABASE_AUTH_TOKEN)
			throw new Error('FEEDBACK_DATABASE_AUTH_TOKEN is not set');
		_feedbackDb = drizzle(
			createClient({
				url: env.FEEDBACK_DATABASE_URL,
				authToken: env.FEEDBACK_DATABASE_AUTH_TOKEN
			}),
			{ schema: feedbackSchema }
		);
	}
	return _feedbackDb;
}

// Exported as proxies so existing `import { db }` / `db.select(...)` call sites
// work unchanged, but the client is only built on first property access. Methods
// are bound to the real instance so Drizzle's internal `this` is preserved.
function lazyProxy<T extends object>(resolve: () => T): T {
	return new Proxy({} as T, {
		get(_t, prop) {
			const target = resolve() as Record<string | symbol, unknown>;
			const value = target[prop];
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

export const db: DB = lazyProxy(getDb);
export const feedbackDb: FeedbackDB = lazyProxy(getFeedbackDb);
