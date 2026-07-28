import type { Reroute } from '@sveltejs/kit';

/**
 * Custom-domain routing for Cloudflare for SaaS.
 *
 * A customer points e.g. doc.108labs.ai at our fallback origin
 * (PUBLIC_CNAME_TARGET). Cloudflare's wildcard zone route sends that hostname
 * into this Worker, so the request arrives with Host: doc.108labs.ai. We map the
 * host to an org and internally serve /o/<slug>/… — the URL bar is untouched.
 *
 * IMPORTANT: `reroute` is a UNIVERSAL hook and MUST live in src/hooks.ts. An
 * export of the same name in src/hooks.server.ts is silently ignored by
 * SvelteKit — the file is never consulted for it — which reads as "custom
 * domains serve the marketing page" with no error anywhere.
 *
 * Because it is universal it also runs in the browser, so it cannot touch the
 * DB directly; the host→slug lookup goes through /api/domain-slug.
 */

function isOwnHost(host: string): boolean {
	// PUBLIC_DOMAIN is not readable from a universal hook without pulling in
	// $env/dynamic/public (server-only at this point in the request), so the
	// base domain is matched literally here.
	const base = 'mdpubs.com';
	return (
		host === base ||
		host === `www.${base}` ||
		host.startsWith('localhost') ||
		host.startsWith('127.0.0.1') ||
		host.endsWith('.workers.dev')
	);
}

// Per-runtime memo so repeat navigations on the same host don't re-fetch.
const slugCache = new Map<string, string | null>();

export const reroute: Reroute = async ({ url, fetch }) => {
	const host = url.host.toLowerCase();
	if (isOwnHost(host)) return url.pathname;

	// Never reroute framework/asset/API requests — they must resolve verbatim.
	if (
		url.pathname.startsWith('/_app/') ||
		url.pathname.startsWith('/api/') ||
		url.pathname.startsWith('/o/')
	) {
		return url.pathname;
	}

	let slug: string | null;
	if (slugCache.has(host)) {
		slug = slugCache.get(host) ?? null;
	} else {
		try {
			const res = await fetch(`/api/domain-slug?host=${encodeURIComponent(host)}`);
			slug = res.ok ? (((await res.json()) as { slug: string | null }).slug ?? null) : null;
		} catch {
			slug = null; // never break routing on a lookup failure
		}
		slugCache.set(host, slug);
	}

	// Unknown host: leave the path alone; handleUnknownDomain returns the 404.
	if (!slug) return url.pathname;

	// Only the bare root maps to the org page. Every other path (note ids like
	// /f5vTJxecv1gZadpCOXw-l, /u/<user>, /login, …) already resolves at the root
	// on its own route, so prefixing it with /o/<slug> would 404.
	if (url.pathname === '/') return `/o/${slug}`;
	return url.pathname;
};
