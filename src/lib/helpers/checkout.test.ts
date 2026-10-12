import { test } from 'node:test';
import assert from 'node:assert/strict';
// `.ts` extension: under `node --test` with type stripping, Node resolves the
// specifier literally, so an extensionless import is ERR_MODULE_NOT_FOUND.
import { checkoutHref, CHECKOUT_FALLBACK } from './checkout.ts';

const LINK = 'https://buy.stripe.com/test_eVqdRa3wQd7ifZj3RB0oM08';

test('a configured Stripe link is used as-is', () => {
	assert.equal(checkoutHref(LINK), LINK);
});

test('an unset link falls back to login instead of a dead href', () => {
	// PUBLIC_STRIPE_MONTHLY_LINK reads as '' when the Worker var is missing.
	assert.equal(checkoutHref(''), CHECKOUT_FALLBACK);
	assert.equal(checkoutHref(undefined), CHECKOUT_FALLBACK);
	assert.equal(checkoutHref(null), CHECKOUT_FALLBACK);
});

test('whitespace-only config is treated as unset', () => {
	assert.equal(checkoutHref('   '), CHECKOUT_FALLBACK);
});
