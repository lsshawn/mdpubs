/**
 * /api/ping — health check. Native port of the old Hono `/ping` (the nvim plugin
 * calls this via :MdPubsStatus).
 */
import { text } from '@sveltejs/kit';

export function GET(): Response {
	return text('pong');
}
