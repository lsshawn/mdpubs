import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			inspector: { toggleKeyCombo: 'alt-g' },
			adapter: adapter(),
			// CSRF is enforced in hooks.server.ts (handleCsrf), which exempts API-key
			// requests from the CLI and Neovim plugin.
			csrf: { trustedOrigins: ['*'] }
		}),
		devtoolsJson()
	],
	server: {
		// Bind to all interfaces so the dev server is reachable over the LAN /
		// Tailscale (e.g. http://beelink:5173), not just localhost.
		host: true,
		// SvelteKit/Vite rejects requests whose Host header isn't localhost; allow
		// the Tailscale hostname so beelink:5173 isn't blocked as an invalid host.
		allowedHosts: ['beelink']
	}
});
