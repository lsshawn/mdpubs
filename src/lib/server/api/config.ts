/**
 * Config for the ported Hono API (mounted at /api). Only the parts the routes /
 * services actually use are ported from mdpubs-api's `src/config.ts`. Everything
 * env-derived reads `$env/dynamic/private` (Workers-safe), never `process.env`.
 */
import { env } from '$env/dynamic/private';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

const APP_NAME = 'MdPubs';

export const config = {
	appName: APP_NAME,
	limits: {
		fileSize: {
			bytes: MAX_FILE_SIZE_BYTES,
			mb: MAX_FILE_SIZE_BYTES / (1024 * 1024)
		},
		freeNotes: 5
	},
	htmlPub: {
		// Origins allowed to frame raw HTML pubs (CSP frame-ancestors). Override via
		// PUBLIC_UI_ORIGIN (space-separated) per-env.
		get frameAncestor(): string {
			return env.PUBLIC_UI_ORIGIN || 'https://mdpubs.com https://www.mdpubs.com';
		}
	}
} as const;
