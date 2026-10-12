// POST /oauth/register — dynamic client registration (RFC 7591), public clients only.
import { OAuthError, oauthJson, preflight, registerClient } from '#lib/server/oauth-server.js';
import type { RequestEvent } from './$types';

export async function POST({ request }: RequestEvent): Promise<Response> {
	try {
		const client = await registerClient(await request.json().catch(() => null));
		return oauthJson(
			{
				client_id: client.id,
				client_id_issued_at: Math.floor(Date.now() / 1000),
				client_name: client.name,
				redirect_uris: client.redirectUris,
				grant_types: ['authorization_code'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none'
			},
			201
		);
	} catch (e) {
		if (e instanceof OAuthError) {
			return oauthJson({ error: e.code, error_description: e.message }, 400);
		}
		throw e;
	}
}

export const OPTIONS = preflight;
