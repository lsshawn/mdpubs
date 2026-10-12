import { PUBLIC_DOMAIN, PUBLIC_CNAME_TARGET } from '$app/env/public';

/**
 * True when this note is being served on an org's custom domain rather than on
 * mdpubs.com. Note paths are not rerouted (see src/hooks.ts), so the only signal
 * is the host itself: anything that isn't one of our own hostnames only reaches
 * the Worker because handleUnknownDomain resolved it to an org.
 *
 * Custom-domain pubs are whitelabelled — no "Powered by MdPubs" footer.
 */
export function isCustomDomainHost(host: string): boolean {
	const base = (PUBLIC_DOMAIN || 'mdpubs.com').toLowerCase();
	const cnameTarget = (PUBLIC_CNAME_TARGET || `origin.${base}`).toLowerCase();
	const h = host.toLowerCase();
	return !(
		h === base ||
		h === `www.${base}` ||
		h === cnameTarget ||
		h.startsWith('localhost') ||
		h.startsWith('127.0.0.1') ||
		h.endsWith('.workers.dev')
	);
}
