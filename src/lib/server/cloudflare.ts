/**
 * Cloudflare for SaaS — Custom Hostnames client.
 *
 * This is how we onboard customer-owned domains (e.g. docs.108labs.ai) WITHOUT
 * touching wrangler.jsonc or redeploying. Each customer domain becomes one
 * "custom hostname" on our zone; the customer points a CNAME at our fallback
 * origin (PUBLIC_CNAME_TARGET, e.g. cname.mdpubs.com) and Cloudflare issues +
 * auto-renews the edge TLS cert.
 *
 * One-time platform setup (done once in the Cloudflare dashboard/API, NOT here):
 *   1. Enable "Cloudflare for SaaS" on the zone.
 *   2. Set the Fallback Origin to the Worker hostname behind PUBLIC_CNAME_TARGET
 *      so every custom hostname routes into this Worker.
 *   3. Provision these Worker secrets:
 *        wrangler secret put CF_API_TOKEN   # token scoped: Zone > SSL and Certificates > Edit
 *        wrangler secret put CF_ZONE_ID     # the mdpubs.com zone id
 *
 * Docs: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
 *
 * Cost: first 100 custom hostnames free, then $0.10/hostname/mo. We use standard
 * DV certs (ssl.type 'dv') — do NOT switch to advanced/custom certs, that moves
 * to a much pricier metered tier.
 */
import { env } from '$env/dynamic/private';

const CF_API = 'https://api.cloudflare.com/client/v4';

export type CustomHostnameStatus =
	| 'pending'
	| 'pending_validation'
	| 'active'
	| 'active_redeploying'
	| 'moved'
	| 'deleted'
	| 'blocked';

export type CustomHostname = {
	id: string;
	hostname: string;
	status: CustomHostnameStatus;
	ssl: {
		status: string; // 'pending_validation' | 'active' | ...
		validation_records?: Array<{ txt_name?: string; txt_value?: string; http_url?: string }>;
	};
	// Present while ownership/DNS is still being verified.
	verification_errors?: string[];
};

function creds(): { token: string; zoneId: string } {
	const token = env.CF_API_TOKEN;
	const zoneId = env.CF_ZONE_ID;
	if (!token || !zoneId) {
		throw new Error(
			'Cloudflare for SaaS is not configured: set CF_API_TOKEN and CF_ZONE_ID secrets.'
		);
	}
	return { token, zoneId };
}

async function cfFetch(path: string, init?: RequestInit): Promise<unknown> {
	const { token } = creds();
	const res = await fetch(`${CF_API}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			...(init?.headers ?? {})
		}
	});
	const body = (await res.json().catch(() => null)) as {
		success?: boolean;
		result?: unknown;
		errors?: Array<{ message: string }>;
	} | null;
	if (!res.ok || !body?.success) {
		const msg = body?.errors?.map((e) => e.message).join('; ') || `Cloudflare API ${res.status}`;
		throw new Error(msg);
	}
	return body.result;
}

/**
 * Register a custom hostname. Cloudflare begins DV cert issuance immediately;
 * once the customer's CNAME resolves to our fallback origin, HTTP validation
 * completes automatically and the cert goes active — no further calls needed.
 */
export async function createCustomHostname(hostname: string): Promise<CustomHostname> {
	const { zoneId } = creds();
	return (await cfFetch(`/zones/${zoneId}/custom_hostnames`, {
		method: 'POST',
		body: JSON.stringify({
			hostname: hostname.toLowerCase(),
			ssl: {
				method: 'http', // validated over HTTP once the CNAME resolves
				type: 'dv', // standard domain-validated cert (free tier)
				settings: { min_tls_version: '1.2' }
			}
		})
	})) as CustomHostname;
}

/** Poll a custom hostname's verification + certificate status. */
export async function getCustomHostname(id: string): Promise<CustomHostname> {
	const { zoneId } = creds();
	return (await cfFetch(`/zones/${zoneId}/custom_hostnames/${id}`)) as CustomHostname;
}

/** Remove a custom hostname (on domain change or removal). Idempotent-ish. */
export async function deleteCustomHostname(id: string): Promise<void> {
	const { zoneId } = creds();
	await cfFetch(`/zones/${zoneId}/custom_hostnames/${id}`, { method: 'DELETE' });
}

/** A hostname is fully live when both the hostname and its cert are active. */
export function isHostnameLive(h: CustomHostname): boolean {
	return h.status === 'active' && h.ssl?.status === 'active';
}
