/**
 * /api/stripe-webhook — Stripe webhook receiver. Native port of the old Hono
 * `/stripe-webhook`. Uses the RAW request body for signature verification (never
 * parse/re-serialize before verifying).
 *
 * NOTE: the Stripe dashboard webhook endpoint URL must be updated to
 * https://mdpubs.com/api/stripe-webhook (from the old api.mdpubs.com/stripe-webhook).
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { StripeService } from '$lib/server/api/services/stripe';

const stripeService = new StripeService();

export async function POST(event: RequestEvent): Promise<Response> {
	try {
		const body = await event.request.text(); // raw body — required for sig verify
		const signature = event.request.headers.get('stripe-signature');
		if (!signature) return json({ error: 'No stripe-signature header' }, { status: 400 });

		const result = await stripeService.processWebhook(body, signature);
		return json(result);
	} catch (error) {
		console.error('Stripe webhook error:', error);
		const message = error instanceof Error ? error.message : '';
		if (message === 'Invalid webhook signature') {
			return json({ error: 'Invalid webhook signature' }, { status: 400 });
		}
		if (message.includes('not configured')) return json({ error: message }, { status: 500 });
		return json({ error: 'Failed to process webhook' }, { status: 500 });
	}
}
