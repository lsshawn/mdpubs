import { pricingFor } from '#lib/pricing.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	// Cloudflare sets cf-ipcountry on every request and overwrites any the client
	// sends, so it can't be spoofed. platform.cf is the same value, for when the
	// header is missing.
	const country =
		event.request.headers.get('cf-ipcountry') ??
		(event.platform as { cf?: { country?: string } } | undefined)?.cf?.country;
	return {
		user: event.locals.user,
		session: event.locals.session,
		pricing: pricingFor(country)
	};
};
