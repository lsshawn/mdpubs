import { dev } from '$app/environment';

export const app = {
	name: 'NeoNote',
	description: 'Fastest way to publish markdown from Neovim',
	domain: dev ? 'localhost:5173' : 'neonote.sshawn.com',
	apiUrl: dev ? 'http://localhost:1323' : 'https://api-neonote.sshawn.com',
	git: 'https://github.com/lsshawn/neonote.nvim',
	stripePaymentLinks: {
		monthly: {
			link: dev
				? 'https://buy.stripe.com/test_eVqdRa3wQd7ifZj3RB0oM08'
				: 'https://buy.stripe.com/14A3cw7N6aZaaEZewf0oM0L'
		},
		yearly: {
			link: dev
				? 'https://buy.stripe.com/test_eVq5kE6J20kweVf4VF0oM09'
				: 'https://buy.stripe.com/9B6dRa9Ve0kw8wR5ZJ0oM0M'
		}
	},
	plans: {
		free: { maxNotes: '5' },
		paid: { maxNotes: 'unlimited' }
	}
};

export const featureFlags = {
	discussionSidebar: false
};
