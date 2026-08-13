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
		//
		// An HTML pub renders as an iframe pointing at /api/notes/:id/raw, so every
		// origin a pub can be VIEWED on must be listed here or the browser refuses
		// to display the frame (blank iframe + a console CSP error, no server error).
		// That includes each branded custom domain, which is why the house domains
		// are in the default rather than only on mdpubs.com.
		//
		// Adding a new tenant domain is a manual step: extend PUBLIC_UI_ORIGIN in
		// wrangler.jsonc and redeploy. Until that happens, HTML pubs on the new
		// domain render blank while markdown pubs (no iframe) look fine.
		get frameAncestor(): string {
			return (
				env.PUBLIC_UI_ORIGIN ||
				[
					'https://mdpubs.com',
					'https://www.mdpubs.com',
					// Branded customer domains (Cloudflare for SaaS custom hostnames).
					'https://doc.carbongpt.ai',
					'https://doc.108labs.ai'
				].join(' ')
			);
		}
	}
} as const;
