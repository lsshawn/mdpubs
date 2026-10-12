// Authorization server metadata (RFC 8414). See src/lib/server/oauth-server.ts.
import { oauthJson, preflight } from '#lib/server/oauth-server.js';
import type { RequestEvent } from './$types';

export function GET({ url }: RequestEvent): Response {
	const o = url.origin;
	return oauthJson({
		issuer: o,
		authorization_endpoint: `${o}/oauth/authorize`,
		token_endpoint: `${o}/oauth/token`,
		registration_endpoint: `${o}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		scopes_supported: ['mdpubs']
	});
}

export const OPTIONS = preflight;
