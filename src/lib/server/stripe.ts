// $env/dynamic/private (runtime) rather than static/private (build-time inline),
// which fails the Cloudflare build when the secret isn't in the build container.
// Matches the pattern already used in db/index.ts, config.ts, errorReporter.ts.
import { env } from '$env/dynamic/private';
import Stripe from 'stripe';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
