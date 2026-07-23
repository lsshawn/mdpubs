import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { organization } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env as publicEnv } from '$env/dynamic/public';
import { canManageOrg } from '$lib/server/org';
import {
	createCustomHostname,
	getCustomHostname,
	deleteCustomHostname,
	isHostnameLive
} from '$lib/server/cloudflare';
import type { RequestEvent } from './$types';

/**
 * Custom-domain lifecycle for an org, backed by Cloudflare for SaaS.
 *
 *   POST   { domain }  → register/replace the custom hostname; returns the CNAME
 *                        target the customer must add to their DNS.
 *   GET                → poll verification + certificate status (also flips the
 *                        org to 'active' once the cert is live).
 *   DELETE             → remove the custom hostname and clear the domain.
 *
 * All gated to org owners/admins.
 */

const domainSchema = z.object({
	// A single hostname like docs.108labs.ai. No scheme, no path, no wildcard.
	domain: z
		.string()
		.trim()
		.toLowerCase()
		.min(3)
		.max(253)
		.regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, 'Enter a valid domain, e.g. docs.example.com')
});

async function requireManagedOrg(event: RequestEvent) {
	const user = event.locals.user;
	if (!user) throw error(401, 'Unauthorized');
	const orgId = event.params.id;

	const [org] = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
	if (!org) throw error(404, 'Account not found');
	if (!(await canManageOrg(org.id, user.id))) throw error(403, 'Forbidden');
	return org;
}

/** The hostname customers CNAME to (their zone stays theirs). */
function cnameTarget(): string {
	return publicEnv.PUBLIC_CNAME_TARGET ?? `cname.${publicEnv.PUBLIC_DOMAIN ?? 'mdpubs.com'}`;
}

export async function POST(event: RequestEvent) {
	const org = await requireManagedOrg(event);

	const parsed = domainSchema.safeParse(await event.request.json());
	if (!parsed.success) {
		return json({ success: false, message: parsed.error.errors[0].message }, { status: 400 });
	}
	const { domain } = parsed.data;

	// Refuse domains under our own apex — those belong in wrangler.jsonc, not here.
	const base = (publicEnv.PUBLIC_DOMAIN ?? 'mdpubs.com').toLowerCase();
	if (domain === base || domain.endsWith(`.${base}`)) {
		return json({ success: false, message: 'Use a domain you own, not an mdpubs.com subdomain.' }, { status: 400 });
	}

	try {
		// Replacing an existing domain: retire the old custom hostname first.
		if (org.cfHostnameId) {
			await deleteCustomHostname(org.cfHostnameId).catch(() => {
				/* already gone — ignore */
			});
		}

		const created = await createCustomHostname(domain);

		await db
			.update(organization)
			.set({
				customDomain: domain,
				cfHostnameId: created.id,
				domainStatus: 'pending',
				updatedAt: new Date()
			})
			.where(eq(organization.id, org.id));

		return json({
			success: true,
			status: 'pending',
			domain,
			// The single instruction the customer follows in their own DNS.
			dns: { type: 'CNAME', name: domain, value: cnameTarget() }
		});
	} catch (e) {
		if (e instanceof Error && e.message.includes('UNIQUE constraint')) {
			return json({ success: false, message: 'That domain is already in use.' }, { status: 409 });
		}
		console.error('Domain provisioning failed:', e);
		return json(
			{ success: false, message: e instanceof Error ? e.message : 'Provisioning failed.' },
			{ status: 502 }
		);
	}
}

export async function GET(event: RequestEvent) {
	const org = await requireManagedOrg(event);

	if (!org.customDomain || !org.cfHostnameId) {
		return json({ success: true, status: 'none', domain: null });
	}

	try {
		const h = await getCustomHostname(org.cfHostnameId);
		const live = isHostnameLive(h);
		const status = live ? 'active' : h.status === 'blocked' ? 'failed' : 'pending';

		// Persist a terminal status change so routing/UI reflect it without a poll.
		if (status !== org.domainStatus) {
			await db
				.update(organization)
				.set({ domainStatus: status, updatedAt: new Date() })
				.where(eq(organization.id, org.id));
		}

		return json({
			success: true,
			status,
			domain: org.customDomain,
			ssl: h.ssl?.status ?? null,
			verificationErrors: h.verification_errors ?? [],
			dns: { type: 'CNAME', name: org.customDomain, value: cnameTarget() }
		});
	} catch (e) {
		console.error('Domain status check failed:', e);
		return json(
			{ success: false, message: e instanceof Error ? e.message : 'Status check failed.' },
			{ status: 502 }
		);
	}
}

export async function DELETE(event: RequestEvent) {
	const org = await requireManagedOrg(event);

	try {
		if (org.cfHostnameId) {
			await deleteCustomHostname(org.cfHostnameId).catch(() => {
				/* already gone — ignore */
			});
		}
		await db
			.update(organization)
			.set({ customDomain: null, cfHostnameId: null, domainStatus: 'none', updatedAt: new Date() })
			.where(eq(organization.id, org.id));

		return json({ success: true, status: 'none' });
	} catch (e) {
		console.error('Domain removal failed:', e);
		return json(
			{ success: false, message: e instanceof Error ? e.message : 'Removal failed.' },
			{ status: 502 }
		);
	}
}
