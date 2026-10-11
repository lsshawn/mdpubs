/**
 * /api/stripe-webhook — Stripe webhook receiver. Native port of the old Hono
 * `/stripe-webhook`. Uses the RAW request body for signature verification (never
 * parse/re-serialize before verifying).
 *
 * NOTE: the Stripe dashboard webhook endpoint URL must be updated to
 * https://mdpubs.com/api/stripe-webhook (from the old api.mdpubs.com/stripe-webhook).
 */
import { type RequestEvent } from '@sveltejs/kit';
import { StripeService } from '#lib/server/api/services/stripe.js';

const stripeService = new StripeService();

export async function POST(event: RequestEvent): Promise<Response> {
	try {
		const body = await event.request.text(); // raw body — required for sig verify
		const signature = event.request.headers.get('stripe-signature');
		if (!signature) return Response.json({ error: 'No stripe-signature header' }, { status: 400 });

		const result = await stripeService.processWebhook(body, signature);
		return Response.json(result);
	} catch (error) {
		console.error('Stripe webhook error:', error);
		const message = error instanceof Error ? error.message : '';
		if (message === 'Invalid webhook signature') {
			return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
		}
		if (message.includes('not configured'))
			return Response.json({ error: message }, { status: 500 });
		return Response.json({ error: 'Failed to process webhook' }, { status: 500 });
	}
}
