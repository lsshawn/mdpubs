import { env } from '$env/dynamic/private';
import { config as publicConfig } from '$lib/config';

const APP_NAME = publicConfig.name;
const OTP_EXPIRATION_MINS = 15;

export const serverConfig = {
	email: {
		from: `${APP_NAME} <${env.MAILGUN_FROM_EMAIL}>`,
		domain: env.MAILGUN_DOMAIN
	},
	otp: {
		expirationMinutes: OTP_EXPIRATION_MINS,
		expirationMs: 1000 * 60 * OTP_EXPIRATION_MINS
	}
} as const;
