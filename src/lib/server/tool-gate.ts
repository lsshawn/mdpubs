/**
 * Shared by the two pages that hand a token to an AI tool: /device (CLI login)
 * and /oauth/authorize (MCP connectors). Both need a logged-in, paying user.
 */
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { config } from '#lib/config.js';
import { isPaid } from '#lib/server/tokens.js';

/** The logged-in user, or a redirect to login that comes back to this exact URL. */
export function requireUser(event: RequestEvent) {
	const u = event.locals.user;
	if (!u) {
		const back = event.url.pathname + event.url.search;
		redirect(302, `/login?redirectTo=${encodeURIComponent(back)}`);
	}
	return u;
}

/** What the consent page needs to show a subscribe step to an unpaid user. */
export function billing(u: { email: string; plan: string | null }) {
	const withEmail = (link: string | undefined) =>
		link ? `${link}?prefilled_email=${encodeURIComponent(u.email)}` : null;
	return {
		paid: isPaid(u),
		email: u.email,
		monthlyLink: withEmail(config.stripePaymentLinks.monthly.link),
		yearlyLink: withEmail(config.stripePaymentLinks.yearly.link)
	};
}
