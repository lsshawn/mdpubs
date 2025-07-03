import { dev } from '$app/environment';

export const app = {
	appName: 'NeoNote',
	domain: 'neonote.sshawn.com',
	apiUrl: dev ? 'http://localhost:1323' : 'https://api-neonote.sshawn.com'
};

export const featureFlags = {
	discussionSidebar: false
};
