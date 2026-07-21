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
	apiUrl: env.PUBLIC_API_URL,
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
