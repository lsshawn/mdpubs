import { env } from '$env/dynamic/private';
import { config as publicConfig } from '$lib/config';

const APP_NAME = publicConfig.name;
const OTP_EXPIRATION_MINS = 15;

export const serverConfig = {
	email: {
		// Cloudflare Email Sending. `from` must use a domain onboarded to Email
		// Sending and match the binding's allowed_sender_addresses (wrangler.jsonc).
		from: env.EMAIL_FROM ?? 'noreply@mdpubs.com',
		fromName: APP_NAME
	},
	otp: {
		expirationMinutes: OTP_EXPIRATION_MINS,
		expirationMs: 1000 * 60 * OTP_EXPIRATION_MINS
	}
} as const;
