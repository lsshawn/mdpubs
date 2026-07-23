/**
 * Stripe webhook handling — ported from mdpubs-api/src/services/stripe.ts.
 *
 * PORT NOTES:
 *   - Reads `$env/dynamic/private` (Workers-safe) instead of `process.env`.
 *   - The Stripe client is created LAZILY on first use, matching the destination
 *     repo's `$lib/server/stripe` pattern (eager construction fails the build-time
 *     analyse pass, which has no STRIPE_SECRET_KEY).
 *   - Webhook signature verification uses `constructEventAsync` (async crypto),
 *     required on Workers where the sync verifier isn't available.
 */
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { UserService } from './user';

export class StripeService {
	private _stripe: Stripe | undefined;
	private userService: UserService;
	private productIds: string[] = ['prod_SYF8x4YNPDAw4z', 'prod_SYFKVsSFGOPzUc']; // 2nd is test

	constructor() {
		this.userService = new UserService();
	}

	private get stripe(): Stripe | undefined {
		if (this._stripe) return this._stripe;
		const stripeKey = env.STRIPE_SECRET_KEY;
		if (!stripeKey) {
			console.warn('⚠️  Stripe not configured. Set STRIPE_SECRET_KEY environment variable.');
			return undefined;
		}
		// No pinned apiVersion — use the SDK default (matches $lib/server/stripe.ts).
		this._stripe = new Stripe(stripeKey);
		return this._stripe;
	}

	// Process Stripe webhook
	async processWebhook(
		body: string,
		signature: string
	): Promise<{ status: string; message?: string }> {
		const stripe = this.stripe;
		if (!stripe) {
			throw new Error('Stripe service not initialized');
		}

		const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
		if (!webhookSecret) {
			throw new Error('STRIPE_WEBHOOK_SECRET not configured');
		}

		let event: Stripe.Event;

		try {
			// Verify webhook signature
			event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
		} catch (error) {
			console.error('Webhook signature verification failed:', error);
			throw new Error('Invalid webhook signature');
		}

		console.log('Stripe event type:', event.type);

		try {
			switch (event.type) {
				case 'customer.subscription.created':
				case 'customer.subscription.updated':
				case 'customer.subscription.deleted':
					return await this.handleSubscriptionEvent(event);

				case 'checkout.session.completed':
					return { status: 'ignored', message: 'Checkout session completed event ignored' };

				default:
					console.log(`Unhandled event type: ${event.type}`);
					return { status: 'ignored', message: `Unhandled event type: ${event.type}` };
			}
		} catch (error) {
			console.error('Error processing webhook:', error);
			throw error;
		}
	}

	private async handleSubscriptionEvent(
		event: Stripe.Event
	): Promise<{ status: string; message?: string }> {
		const subscription = event.data.object as Stripe.Subscription;

		// Check if subscription has items and get product ID
		if (!subscription.items || subscription.items.data.length === 0) {
			console.log('No subscription items found');
			return { status: 'ignored', message: 'No subscription items found' };
		}

		let planProductID: string | undefined;
		for (const item of subscription.items.data) {
			if (item.price?.product) {
				planProductID =
					typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
				break;
			}
		}

		if (!planProductID) {
			console.log('No plan product found');
			return { status: 'ignored', message: 'No plan product found' };
		}

		// Check if product ID is supported
		if (!this.productIds.includes(planProductID)) {
			console.log(`Product ID ${planProductID} is not supported`);
			return { status: 'ignored', message: `Product ID ${planProductID} is not supported` };
		}

		const customerId =
			typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

		try {
			const stripe = this.stripe!;
			// Retrieve customer to get email
			const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
			console.log('Customer retrieved:', customer.email);

			if (!customer.email) {
				throw new Error('Customer email not found');
			}

			const email = customer.email.toLowerCase();

			// Handle different subscription events
			switch (event.type) {
				case 'customer.subscription.deleted':
					await this.updateUserSubscription(email, customerId, '', '', 'free');
					return { status: 'success', message: 'Subscription deleted' };

				case 'customer.subscription.created':
				case 'customer.subscription.updated':
					await this.updateUserSubscription(
						email,
						customerId,
						subscription.id,
						subscription.status,
						'paid'
					);
					return { status: 'success', message: 'Subscription updated' };

				default:
					return { status: 'ignored', message: 'Unhandled subscription event' };
			}
		} catch (error) {
			console.error('Error handling subscription event:', error);
			throw new Error('Failed to process subscription event');
		}
	}

	private async updateUserSubscription(
		email: string,
		stripeCustomerId: string,
		subscriptionId: string,
		subscriptionStatus: string,
		plan: string
	): Promise<void> {
		try {
			// Get or create user
			const { user } = await this.userService.getOrCreateUser(email);

			// Update user's subscription information
			await this.userService.updateUserSubscription(
				user.id,
				stripeCustomerId,
				subscriptionId,
				plan
			);

			console.log(
				`Updated user ${email} with plan ${plan}, customer ${stripeCustomerId}, subscription ${subscriptionId} (status ${subscriptionStatus})`
			);
		} catch (error) {
			console.error('Error updating user subscription:', error);
			throw new Error('Failed to update user subscription');
		}
	}
}
