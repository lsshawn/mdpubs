/**
 * Where a "Start for <price>/mo" button sends the visitor.
 *
 * The landing page's CTAs go straight to Stripe checkout instead of /login, so a
 * visitor who already wants it does not have to pick a login provider first.
 * Stripe collects the email, and the webhook attaches the subscription to the
 * account made at first login.
 *
 * PUBLIC_STRIPE_MONTHLY_LINK reads as the empty string when it is not set (see
 * src/env.ts), and an empty href re-loads the current page — a dead button on
 * the one element the page exists to get clicked. So fall back to /login, which
 * sends new users through checkout anyway.
 */
export const CHECKOUT_FALLBACK = '/login';

export function checkoutHref(stripeLink: string | undefined | null): string {
	const link = stripeLink?.trim();
	return link ? link : CHECKOUT_FALLBACK;
}
