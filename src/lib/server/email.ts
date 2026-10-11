import { serverConfig } from '#lib/server/config.js';
import { env } from 'cloudflare:workers';

/**
 * Send a transactional email via the Cloudflare Email Sending binding.
 *
 * The `EMAIL` binding comes from `cloudflare:workers`. The `from` address
 * must use a domain onboarded to Email Sending (see wrangler.jsonc).
 *
 * On success the binding resolves; on failure it throws an Error with a `.code`
 * (e.g. E_SENDER_NOT_VERIFIED). Returns true when the send was accepted.
 */
export async function sendEmail(
	to: string,
	subject: string,
	body: string,
	isHtml = false
): Promise<boolean> {
	const email = env.EMAIL;
	if (!email) {
		throw new Error('EMAIL binding is not configured (wrangler.jsonc send_email)');
	}

	await email.send({
		from: { email: serverConfig.email.from, name: serverConfig.email.fromName },
		to,
		subject,
		...(isHtml ? { html: body } : { text: body })
	});

	return true;
}
