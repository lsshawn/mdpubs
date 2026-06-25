/**
 * Production error reporter → Hermes auto-fix loop.
 *
 * On an unhandled server error, fire a signed webhook to Hermes. Hermes
 * dedupes by error signature, creates a Kanban card, and its codex-lane
 * worker attempts a fix and opens a PR. See `handleError` in hooks.server.ts.
 *
 * Design constraints:
 *  - Fire-and-forget: must NEVER throw or delay the response to the user.
 *  - Prod-only + opt-in: no-op unless HERMES_WEBHOOK_URL is set.
 *  - Signed: GitHub-style X-Hub-Signature-256 over the raw JSON body.
 *  - Idempotent: a stable signature lets Hermes drop duplicate errors.
 */
import { createHmac, createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';

interface ErrorContext {
	message: string;
	stack?: string;
	route: string | null;
	method: string;
	status: number;
}

/**
 * Stable signature for an error: normalizes the message (strips numbers,
 * hex ids, uuids) so the "same" error from different requests dedupes to
 * one Kanban card. Hermes uses this as the idempotency_key.
 */
function errorSignature(ctx: ErrorContext): string {
	const normalized = ctx.message
		.replace(/0x[0-9a-f]+/gi, '0xN')
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
		.replace(/\d+/g, 'N')
		.trim();
	const top = (ctx.stack ?? '').split('\n')[1]?.trim() ?? '';
	return createHash('sha256')
		.update(`${ctx.route}|${normalized}|${top}`)
		.digest('hex')
		.slice(0, 16);
}

export function reportError(ctx: ErrorContext): void {
	const url = env.HERMES_WEBHOOK_URL;
	const secret = env.HERMES_WEBHOOK_SECRET;
	if (!url || !secret) return; // opt-in: no config → no-op (dev, previews)

	const signature = errorSignature(ctx);
	const payload = JSON.stringify({
		app: 'mdpubs',
		app_token: env.HERMES_APP_TOKEN ?? null, // per-app secret, checked against Hermes registry
		signature,
		message: ctx.message,
		route: ctx.route,
		method: ctx.method,
		status: ctx.status,
		stack: ctx.stack?.split('\n').slice(0, 30).join('\n'), // cap stack size
		commit: env.VERCEL_GIT_COMMIT_SHA ?? null,
		deployment: env.VERCEL_URL ?? null,
		ts: new Date().toISOString()
	});

	const hmac = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

	// Fire-and-forget. Swallow every failure — reporting must never break a
	// response or surface a second error. No await on the caller's path.
	void fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hub-signature-256': hmac,
			'x-request-id': signature // Hermes idempotency: drop webhook retries
		},
		body: payload,
		signal: AbortSignal.timeout(3000)
	}).catch(() => {});
}
