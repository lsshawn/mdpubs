/**
 * POST /api/cli/login — start a device login for the `mdpubs` CLI.
 *
 * Replies in `key=value` lines rather than JSON so the shell CLI can read them
 * with `sed`, with no jq dependency. See src/lib/server/device.ts.
 */
import { startDeviceLogin } from '#lib/server/device.js';
import type { RequestEvent } from './$types';

export async function POST({ url }: RequestEvent): Promise<Response> {
	const { device, code, expiresIn } = await startDeviceLogin();
	const body = [
		`device=${device}`,
		`code=${code}`,
		`url=${url.origin}/device?code=${code}`,
		'interval=3',
		`expires_in=${expiresIn}`
	].join('\n');
	return new Response(body + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
