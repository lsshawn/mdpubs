// See https://svelte.dev/docs/kit/types#app
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user: import('$lib/server/auth').SessionValidationResult['user'];
			session: import('$lib/server/auth').SessionValidationResult['session'];
		}
		interface Platform {
			env: {
				// Cloudflare Email Sending binding (see wrangler.jsonc).
				EMAIL: import('@cloudflare/workers-types').SendEmail;
				// R2 bucket for note images/assets.
				BUCKET: import('@cloudflare/workers-types').R2Bucket;
				// Cloudflare Images binding (resize/format transforms).
				IMAGES: import('@cloudflare/workers-types').ImagesBinding;
			};
			cf: import('@cloudflare/workers-types').CfProperties;
			ctx: import('@cloudflare/workers-types').ExecutionContext;
		}
	}
}

export {};
