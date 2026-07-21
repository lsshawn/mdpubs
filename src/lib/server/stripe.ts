// $env/dynamic/private (runtime) rather than static/private (build-time inline).
// The Stripe client is created LAZILY on first access: `new Stripe(undefined)`
// throws ("Neither apiKey nor config.authenticator provided"), and SvelteKit's
// postbuild `analyse` imports this module in the build container (no
// STRIPE_SECRET_KEY) — so eager construction fails the build. Deferring to first
// use means the client is only built at request time, where the env is present.
import { env } from '$env/dynamic/private';
import Stripe from 'stripe';

let _stripe: Stripe | undefined;

function getStripe(): Stripe {
	if (!_stripe) {
		if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
		_stripe = new Stripe(env.STRIPE_SECRET_KEY);
	}
	return _stripe;
}

// Proxy so existing `import { stripe }` / `stripe.x.y(...)` call sites work
// unchanged, but construction is deferred to first property access. Methods are
// bound to the real instance so Stripe's internal `this` is preserved.
export const stripe: Stripe = new Proxy({} as Stripe, {
	get(_t, prop) {
		const target = getStripe() as unknown as Record<string | symbol, unknown>;
		const value = target[prop];
		return typeof value === 'function' ? value.bind(target) : value;
	}
});
