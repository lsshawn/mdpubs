// See https://svelte.dev/docs/kit/types#app
// for information about these interfaces
declare global {
	// Bindings read via `import { env } from 'cloudflare:workers'` (see wrangler.jsonc).
	namespace Cloudflare {
		interface Env {
			// Cloudflare Email Sending binding.
			EMAIL: import('@cloudflare/workers-types').SendEmail;
			// R2 bucket for note images/assets.
			BUCKET: import('@cloudflare/workers-types').R2Bucket;
			// Cloudflare Images binding (resize/format transforms).
			IMAGES: import('@cloudflare/workers-types').ImagesBinding;
			// Static assets (static/), e.g. the TTF fonts the OG cards read.
			ASSETS: import('@cloudflare/workers-types').Fetcher;
		}
	}

	namespace App {
		interface Locals {
			user: import('#lib/server/auth').SessionValidationResult['user'];
			session: import('#lib/server/auth').SessionValidationResult['session'];
		}
	}
}

export {};
