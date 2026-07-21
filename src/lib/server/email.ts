import { serverConfig } from '$lib/server/config';

/**
 * Send a transactional email via the Cloudflare Email Sending binding.
 *
 * The `EMAIL` binding lives on `platform.env` and is only available inside a
 * request, so callers must pass `event.platform` through. The `from` address
 * must use a domain onboarded to Email Sending (see wrangler.jsonc).
 *
 * On success the binding resolves; on failure it throws an Error with a `.code`
 * (e.g. E_SENDER_NOT_VERIFIED). Returns true when the send was accepted.
 */
export async function sendEmail(
	platform: App.Platform | undefined,
	to: string,
	subject: string,
	body: string,
	isHtml = false
): Promise<boolean> {
	const email = platform?.env?.EMAIL;
	if (!email) {
		throw new Error('EMAIL binding is not available on platform.env');
	}

	await email.send({
		from: { email: serverConfig.email.from, name: serverConfig.email.fromName },
		to,
		subject,
		...(isHtml ? { html: body } : { text: body })
	});

	return true;
}
