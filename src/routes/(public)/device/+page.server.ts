/**
 * /device?code=XXXX-XXXX — approve a CLI login started by `mdpubs login`.
 * See src/lib/server/device.ts for the flow.
 */
import { fail, redirect } from '@sveltejs/kit';
import { decideDeviceLogin, normaliseUserCode, pendingDeviceLogin } from '#lib/server/device.js';
import { billing, requireUser } from '#lib/server/tool-gate.js';
import { isPaid } from '#lib/server/tokens.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async (event) => {
	const u = requireUser(event);
	const code = normaliseUserCode(event.url.searchParams.get('code'));
	const login = code ? await pendingDeviceLogin(code) : null;
	return { code, found: !!login, done: event.url.searchParams.get('done'), ...billing(u) };
};

async function decide(event: RequestEvent, approve: boolean) {
	const u = requireUser(event);
	const form = await event.request.formData();
	const code = normaliseUserCode(String(form.get('code') ?? ''));
	const login = code ? await pendingDeviceLogin(code) : null;
	if (!login) return fail(410, { error: 'This code has expired. Run `mdpubs login` again.' });
	if (approve && !isPaid(u)) return fail(402, { error: 'Subscribe first.' });
	await decideDeviceLogin(login.id, u.id, approve);
	redirect(303, `/device?done=${approve ? 'allowed' : 'denied'}`);
}

export const actions: Actions = {
	allow: (event) => decide(event, true),
	deny: (event) => decide(event, false)
};
