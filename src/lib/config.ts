// Read PUBLIC_* from the runtime environment (not $env/static/public, which
// inlines at build time and hard-fails the build if a var is absent — the
// Cloudflare build container did not expose them). $env/dynamic/public resolves
// at runtime from the Worker's environment, so these must be provided as Worker
// runtime vars ([vars] in wrangler.jsonc or `wrangler secret put`).
import { env } from '$env/dynamic/public';

const APP_NAME = 'MdPubs';

export const config = {
	name: APP_NAME,
	description: 'Fastest way to publish markdown',
	domain: env.PUBLIC_DOMAIN,
	// The notes API now lives in THIS app under /api (ported from the old
	// standalone api.mdpubs.com). Default to the same-origin relative base so
	// server loads (event.fetch) and browser fetches both resolve to the in-repo
	// +server.ts routes. PUBLIC_API_URL can still override (e.g. to point back at
	// the old host during cutover).
	apiUrl: env.PUBLIC_API_URL || '/api',
	git: 'https://github.com/lsshawn/mdpubs.nvim',
	stripePaymentLinks: {
		monthly: {
			link: env.PUBLIC_STRIPE_MONTHLY_LINK
		},
		yearly: {
			link: env.PUBLIC_STRIPE_YEARLY_LINK
		}
	},
	plans: {
		free: { maxNotes: '5' },
		paid: { maxNotes: 'unlimited' }
	},
	feedbackProjectId: 1,
	featureFlags: {
		discussionSidebar: false
	}
} as const;
