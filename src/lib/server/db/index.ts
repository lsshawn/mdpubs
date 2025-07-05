import { dev } from '$app/environment';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import * as feedbackSchema from './feedback.schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!dev && !env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');

const client = createClient({
	url: env.DATABASE_URL,
	authToken: env.DATABASE_AUTH_TOKEN
});

export const db = drizzle(client, { schema });

// Feedback DB
if (!env.FEEDBACK_DATABASE_URL) throw new Error('FEEDBACK_DATABASE_URL is not set');
if (!dev && !env.FEEDBACK_DATABASE_AUTH_TOKEN)
	throw new Error('FEEDBACK_DATABASE_AUTH_TOKEN is not set');

const feedbackClient = createClient({
	url: env.FEEDBACK_DATABASE_URL,
	authToken: env.FEEDBACK_DATABASE_AUTH_TOKEN
});

export const feedbackDb = drizzle(feedbackClient, { schema: feedbackSchema });
