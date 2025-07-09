import {
	PUBLIC_API_URL,
	PUBLIC_DOMAIN,
	PUBLIC_STRIPE_MONTHLY_LINK,
	PUBLIC_STRIPE_YEARLY_LINK
} from '$env/static/public';

const APP_NAME = 'MdPubs';

export const config = {
	name: APP_NAME,
	description: 'Fastest way to publish markdown from Neovim',
	domain: PUBLIC_DOMAIN,
	apiUrl: PUBLIC_API_URL,
	git: 'https://github.com/lsshawn/mdpubs.nvim',
	stripePaymentLinks: {
		monthly: {
			link: PUBLIC_STRIPE_MONTHLY_LINK
		},
		yearly: {
			link: PUBLIC_STRIPE_YEARLY_LINK
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
