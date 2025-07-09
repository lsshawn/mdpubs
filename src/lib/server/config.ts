import { env } from '$env/dynamic/private';
import { config as publicConfig } from '$lib/config';

const APP_NAME = publicConfig.name;

export const serverConfig = {
	email: {
		from: `${APP_NAME} <${env.MAILGUN_FROM_EMAIL}>`,
		domain: env.MAILGUN_DOMAIN,
		otp: {
			subject: `Your ${APP_NAME} Login OTP`,
			expirationMinutes: 5
		}
	}
} as const;
