import { defineConfig } from 'drizzle-kit';

if (!process.env.FEEDBACK_DATABASE_URL) throw new Error('FEEDBACK_DATABASE_URL is not set');

export default defineConfig({
	schema: './src/lib/server/db/feedback.schema.ts',
	out: './drizzle/feedback',
	dialect: 'turso',
	dbCredentials: {
		authToken: process.env.FEEDBACK_DATABASE_AUTH_TOKEN,
		url: process.env.FEEDBACK_DATABASE_URL
	},
	verbose: true,
	strict: true
});
