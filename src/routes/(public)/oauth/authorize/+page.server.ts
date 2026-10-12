/**
 * /oauth/authorize — the consent page Claude or ChatGPT opens when the user adds
 * the mdpubs connector. See src/lib/server/oauth-server.ts.
 *
 * Errors in client_id or redirect_uri are shown here and never redirected, so
 * a bad registration can't be used to bounce users to an arbitrary URL. Every
 * other error goes back to the client as `?error=` per RFC 6749 §4.1.2.1.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { createAuthCode, getClient } from '#lib/server/oauth-server.js';
import { billing, requireUser } from '#lib/server/tool-gate.js';
import { isPaid } from '#lib/server/tokens.js';
import type { Actions, PageServerLoad } from './$types';

const PARAMS = [
	'client_id',
	'redirect_uri',
	'response_type',
	'state',
	'code_challenge',
	'code_challenge_method',
	'scope',
	'resource'
] as const;
type Params = Record<(typeof PARAMS)[number], string>;

function read(source: { get(k: string): FormDataEntryValue | null }): Params {
	return Object.fromEntries(
		PARAMS.map((k) => {
			const v = source.get(k);
			return [k, typeof v === 'string' ? v : ''];
		})
	) as Params;
}

// Only called after validate() matched redirect_uri against the client's
// registered list, which is what makes the external redirects below safe.
function back(p: Params, query: Record<string, string>): string {
	const u = new URL(p.redirect_uri);
	for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
	if (p.state) u.searchParams.set('state', p.state);
	return u.toString();
}

/** The registered client, or a 400 page. Then the request checks that can redirect. */
async function validate(p: Params) {
	const client = await getClient(p.client_id);
	if (!client) error(400, 'Unknown client. Remove the connector and add it again.');
	if (!client.redirectUris.includes(p.redirect_uri)) error(400, 'Redirect URI is not registered.');
	if (p.response_type !== 'code') {
		redirect(302, back(p, { error: 'unsupported_response_type' }), { external: true });
	}
	if (!p.code_challenge || p.code_challenge_method !== 'S256') {
		redirect(
			302,
			back(p, { error: 'invalid_request', error_description: 'PKCE with S256 is required' }),
			{ external: true }
		);
	}
	return client;
}

export const load: PageServerLoad = async (event) => {
	const u = requireUser(event);
	const p = read(event.url.searchParams);
	const client = await validate(p);
	return {
		clientName: client.name,
		redirectHost: new URL(p.redirect_uri).host,
		fields: p,
		...billing(u)
	};
};

export const actions: Actions = {
	allow: async (event) => {
		const u = requireUser(event);
		const p = read(await event.request.formData());
		const client = await validate(p);
		if (!isPaid(u)) return fail(402, { error: 'Subscribe first.' });
		const code = await createAuthCode({
			clientId: client.id,
			userId: u.id,
			redirectUri: p.redirect_uri,
			codeChallenge: p.code_challenge
		});
		redirect(303, back(p, { code, iss: event.url.origin }), { external: true });
	},
	deny: async (event) => {
		requireUser(event);
		const p = read(await event.request.formData());
		await validate(p);
		redirect(303, back(p, { error: 'access_denied' }), { external: true });
	}
};
