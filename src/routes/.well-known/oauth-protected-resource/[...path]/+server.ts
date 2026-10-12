/**
 * Protected resource metadata (RFC 9728) for /mcp. Clients find it from the
 * WWW-Authenticate header on a 401 from /mcp, or by trying both
 * /.well-known/oauth-protected-resource and …/mcp, so the rest param catches both.
 */
import { oauthJson, preflight } from '#lib/server/oauth-server.js';
import type { RequestEvent } from './$types';

export function GET({ url }: RequestEvent): Response {
	return oauthJson({
		resource: `${url.origin}/mcp`,
		authorization_servers: [url.origin],
		bearer_methods_supported: ['header'],
		resource_name: 'mdpubs'
	});
}

export const OPTIONS = preflight;
