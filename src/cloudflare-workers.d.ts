// `cloudflare:workers` is a runtime module; this types the part we use.
// The bindings themselves are declared on `Cloudflare.Env` in app.d.ts.
declare module 'cloudflare:workers' {
	export const env: Cloudflare.Env;
	export function waitUntil(promise: Promise<unknown>): void;
}
