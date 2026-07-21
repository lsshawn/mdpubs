import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter() },
	vitePlugin: {
		inspector: {
			toggleKeyCombo: 'alt-g'
		}
	}
};

export default config;
