import { dev } from '$app/environment';

export const app = {
	name: 'NeoNote',
	description: 'Fastest way to publish markdown from Neovim',
	domain: dev ? 'localhost:5173' : 'neonote.sshawn.com',
	apiUrl: dev ? 'http://localhost:1323' : 'https://api-neonote.sshawn.com',
	git: 'https://github.com/lsshawn/neonote.nvim'
};

export const featureFlags = {
	discussionSidebar: false
};
