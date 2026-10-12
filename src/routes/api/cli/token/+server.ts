/**
 * POST /api/cli/token — the CLI polls this with its device secret.
 *
 * The status code carries the state so the shell script can branch on it:
 * 200 with the token as the body once approved, 202 while pending, 403 denied,
 * 410 expired or already used.
 */
import { pollDeviceLogin } from '#lib/server/device.js';
import type { RequestEvent } from './$types';

const text = (body: string, status: number) =>
	new Response(body + '\n', { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function POST({ request }: RequestEvent): Promise<Response> {
	const form = await request.formData().catch(() => null);
	const device = form?.get('device');
	if (typeof device !== 'string' || !device) return text('missing device', 400);

	const result = await pollDeviceLogin(device);
	switch (result.status) {
		case 'approved':
			return text(result.token, 200);
		case 'pending':
			return text('pending', 202);
		case 'denied':
			return text('denied', 403);
		default:
			return text('expired', 410);
	}
}
