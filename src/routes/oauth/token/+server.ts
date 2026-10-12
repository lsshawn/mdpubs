// POST /oauth/token — authorization_code + PKCE → access token.
import { OAuthError, oauthJson, preflight, redeemAuthCode } from '#lib/server/oauth-server.js';
import type { RequestEvent } from './$types';

export async function POST({ request }: RequestEvent): Promise<Response> {
	const form = await request.formData().catch(() => null);
	const get = (k: string) => {
		const v = form?.get(k);
		return typeof v === 'string' ? v : '';
	};

	if (get('grant_type') !== 'authorization_code') {
		return oauthJson({ error: 'unsupported_grant_type' }, 400);
	}
	if (!get('code') || !get('client_id') || !get('redirect_uri') || !get('code_verifier')) {
		return oauthJson(
			{
				error: 'invalid_request',
				error_description: 'code, client_id, redirect_uri and code_verifier are required'
			},
			400
		);
	}

	try {
		const token = await redeemAuthCode({
			code: get('code'),
			clientId: get('client_id'),
			redirectUri: get('redirect_uri'),
			codeVerifier: get('code_verifier')
		});
		return oauthJson({ access_token: token, token_type: 'Bearer', scope: 'mdpubs' });
	} catch (e) {
		if (e instanceof OAuthError) {
			return oauthJson({ error: e.code, error_description: e.message }, 400);
		}
		throw e;
	}
}

export const OPTIONS = preflight;
