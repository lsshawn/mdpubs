import { error, type RequestEvent } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.js';
import * as table from '#lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '#lib/config.js';
import { stripe } from '#lib/server/stripe.js';

export async function POST({ locals }: RequestEvent) {
	const currentUser = locals.user;
	if (!currentUser) {
		error(401, 'Unauthorized');
	}

	try {
		const [user] = await db
			.select({
				stripeCustomerId: table.user.stripeCustomerId
			})
			.from(table.user)
			.where(eq(table.user.id, currentUser.id));

		if (!user || !user.stripeCustomerId) {
			return Response.json(
				{ success: false, message: 'Stripe customer not found.' },
				{ status: 404 }
			);
		}

		const returnUrl = `${config.domain}/account`;

		const portalSession = await stripe.billingPortal.sessions.create({
			customer: user.stripeCustomerId,
			return_url: returnUrl
		});

		return Response.json({ success: true, url: portalSession.url });
	} catch (e) {
		console.error('Error creating stripe portal session', e);
		return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
	}
}
