/**
 * /mcp — the remote MCP server Claude and ChatGPT connect to (Streamable HTTP
 * transport, stateless, JSON replies only, no SSE stream).
 *
 * Every request needs a Bearer token from the OAuth flow
 * (src/lib/server/oauth-server.ts). Without one we answer 401 with a
 * WWW-Authenticate header pointing at the resource metadata, which is how the
 * client discovers where to send the user to log in.
 */
import { authenticate, getToken, isAuthError } from '#lib/server/api/auth.js';
import { callTool, tools, WRITING_GUIDE } from '#lib/server/mcp/tools.js';
import { corsHeaders, preflight } from '#lib/server/oauth-server.js';
import type { RequestEvent } from './$types';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type JsonRpcRequest = {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
};

const reply = (body: unknown, status = 200) =>
	Response.json(body, { status, headers: corsHeaders });

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) =>
	reply({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function unauthorized(origin: string, detail: string): Response {
	return new Response(JSON.stringify({ error: 'unauthorized', error_description: detail }), {
		status: 401,
		headers: {
			...corsHeaders,
			'content-type': 'application/json',
			'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
		}
	});
}

export async function POST({ request, url }: RequestEvent): Promise<Response> {
	// Header tokens only. Accepting the session cookie here would let any site
	// drive this endpoint as a logged-in visitor.
	const token = getToken(request);
	if (!token) return unauthorized(url.origin, 'Connect mdpubs to continue.');
	const auth = await authenticate(token, 'POST');
	if (isAuthError(auth)) {
		if (auth.status === 401) return unauthorized(url.origin, 'Reconnect mdpubs to continue.');
		return auth;
	}
	if (!auth.user) return unauthorized(url.origin, 'This endpoint needs a user token.');
	const user = auth.user;

	let msg: JsonRpcRequest;
	try {
		msg = await request.json();
	} catch {
		return rpcError(null, -32700, 'Parse error');
	}
	if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
		return rpcError(null, -32600, 'Invalid request');
	}

	// Notifications and responses from the client need no reply.
	if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202 });

	const result = (r: unknown) => reply({ jsonrpc: '2.0', id: msg.id, result: r });

	switch (msg.method) {
		case 'initialize': {
			const asked = String(msg.params?.protocolVersion ?? '');
			return result({
				protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
				capabilities: { tools: {} },
				serverInfo: { name: 'mdpubs', title: 'mdpubs', version: '1.0.0' },
				instructions: WRITING_GUIDE
			});
		}
		case 'ping':
			return result({});
		case 'tools/list':
			return result({ tools });
		case 'tools/call': {
			const name = String(msg.params?.name ?? '');
			const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
			if (!tools.some((t) => t.name === name)) {
				return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
			}
			return result(await callTool(user, name, args, url.origin));
		}
		default:
			return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
	}
}

// No server-to-client stream and no sessions to end.
export function GET(): Response {
	return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
}
export const DELETE = GET;

export const OPTIONS = preflight;
