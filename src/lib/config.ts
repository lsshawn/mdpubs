import { dev } from '$app/environment';

export const app = {
	name: 'NeoNote',
	description: 'Fastest way to publish markdown Neovim',
	domain: 'neonote.sshawn.com',
	apiUrl: dev ? 'http://localhost:1323' : 'https://api-neonote.sshawn.com'
};

export const featureFlags = {
	discussionSidebar: false
};
