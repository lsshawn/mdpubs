import { defineEnvVars } from '@sveltejs/kit/env';

// Unset variables read as the empty string, so fallbacks use `||`, not `??`.
export const variables = defineEnvVars({
	PUBLIC_IMG_BASE: { public: true, schema: (input) => input ?? '' },
	PUBLIC_DOMAIN: { public: true, schema: (input) => input ?? '' },
	PUBLIC_CNAME_TARGET: { public: true, schema: (input) => input ?? '' },
	PUBLIC_API_URL: { public: true, schema: (input) => input ?? '' },
	PUBLIC_STRIPE_MONTHLY_LINK: { public: true, schema: (input) => input ?? '' },
	PUBLIC_STRIPE_YEARLY_LINK: { public: true, schema: (input) => input ?? '' },
	CF_SAAS_API_TOKEN: { schema: (input) => input ?? '' },
	CF_ZONE_ID: { schema: (input) => input ?? '' },
	EMAIL_FROM: { schema: (input) => input ?? '' },
	HERMES_WEBHOOK_URL: { schema: (input) => input ?? '' },
	HERMES_WEBHOOK_SECRET: { schema: (input) => input ?? '' },
	HERMES_APP_TOKEN: { schema: (input) => input ?? '' },
	VERCEL_GIT_COMMIT_SHA: { schema: (input) => input ?? '' },
	VERCEL_URL: { schema: (input) => input ?? '' },
	GOOGLE_CLIENT_ID: { schema: (input) => input ?? '' },
	GOOGLE_CLIENT_SECRET: { schema: (input) => input ?? '' },
	GITHUB_CLIENT_ID: { schema: (input) => input ?? '' },
	GITHUB_CLIENT_SECRET: { schema: (input) => input ?? '' },
	STRIPE_SECRET_KEY: { schema: (input) => input ?? '' },
	DATABASE_URL: { schema: (input) => input ?? '' },
	DATABASE_AUTH_TOKEN: { schema: (input) => input ?? '' },
	FEEDBACK_DATABASE_URL: { schema: (input) => input ?? '' },
	FEEDBACK_DATABASE_AUTH_TOKEN: { schema: (input) => input ?? '' },
	ADMIN_API_KEY: { schema: (input) => input ?? '' },
	PUBLIC_UI_ORIGIN: { schema: (input) => input ?? '' },
	STRIPE_WEBHOOK_SECRET: { schema: (input) => input ?? '' }
});
