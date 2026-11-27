/**
 * mdpubs-live: who is on a note right now, and live updates to it.
 *
 * One Durable Object per note (keyed by its publicId) holds the open WebSockets.
 * It keeps no storage: the room is the set of sockets, and each socket carries
 * its seat (name, mode, section) as its attachment, so the room survives
 * hibernation without waking for keep-alive pings.
 *
 * Browsers connect to wss://live.mdpubs.com/room/<publicId>?t=<ticket>. The
 * ticket is minted by the main app (src/lib/server/live.ts) after its own access
 * check, and signed with LIVE_SECRET, so this Worker never touches the database.
 *
 * The main app calls notify() over its service binding when comments or the
 * note change. RPC methods are not reachable from the internet.
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

type Env = {
	ROOMS: DurableObjectNamespace<NoteRoom>;
	LIVE_SECRET: string;
};

/** What the main app vouches for. Short keys keep the URL small. */
type Ticket = {
	/** Note publicId. */
	n: string;
	/** Stable per person (hashed user id), or random per guest tab. */
	u: string;
	/** Display name. */
	name: string;
	/** Can manage the note (its author or an org admin). Sees everyone's names. */
	mgr: boolean;
	mode: 'reading' | 'editing';
	/** Expiry, ms since epoch. */
	exp: number;
};

type Seat = Ticket & {
	/** This connection. */
	c: string;
	/** Heading link the reader is at, e.g. "#pricing". */
	s: string | null;
};

/** One person as another viewer sees them. `name` is null when hidden from that viewer. */
type PersonOut = {
	c: string;
	u: string;
	name: string | null;
	mgr: boolean;
	mode: 'reading' | 'editing';
	s: string | null;
};

export class NoteRoom extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Keep-alives answered by the runtime: no wake, no duration billed.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async fetch(request: Request): Promise<Response> {
		const ticket = JSON.parse(request.headers.get('x-ticket') || 'null') as Ticket | null;
		if (!ticket) return new Response('Missing ticket', { status: 400 });
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		const seat: Seat = { ...ticket, c: crypto.randomUUID().slice(0, 8), s: null };
		server.serializeAttachment(seat);
		server.send(JSON.stringify({ t: 'hello', me: seat.c }));
		this.sendPresence();
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== 'string' || message.length > 512) return;
		let m: { t?: unknown; s?: unknown };
		try {
			m = JSON.parse(message);
		} catch {
			return;
		}
		if (m.t !== 'at') return;
		const seat = ws.deserializeAttachment() as Seat;
		const s = typeof m.s === 'string' && m.s ? m.s.slice(0, 200) : null;
		if (s === seat.s) return;
		seat.s = s;
		ws.serializeAttachment(seat);
		this.sendPresence();
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		try {
			ws.close(code, reason);
		} catch {
			// Already closed.
		}
		this.sendPresence(ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		this.sendPresence(ws);
	}

	/** Pass an event from the main app to everyone in the room. */
	async notify(msg: unknown): Promise<void> {
		const text = JSON.stringify(msg);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(text);
			} catch {
				// Closing; its close handler updates the roster.
			}
		}
	}

	/**
	 * Send the roster to everyone. People who manage the note see every name;
	 * other readers see the managers' names (the author is public anyway) and
	 * everyone else as an unnamed reader.
	 */
	private sendPresence(gone?: WebSocket): void {
		const sockets = this.ctx
			.getWebSockets()
			.filter((ws) => ws !== gone && ws.readyState === WebSocket.OPEN);
		const seats = sockets.map((ws) => ws.deserializeAttachment() as Seat);
		const all: PersonOut[] = seats.map((x) => ({
			c: x.c,
			u: x.u,
			name: x.name,
			mgr: x.mgr,
			mode: x.mode,
			s: x.s
		}));
		const forManagers = JSON.stringify({ t: 'presence', people: all });
		const forReaders = JSON.stringify({
			t: 'presence',
			people: all.map((p) => (p.mgr ? p : { ...p, name: null }))
		});
		sockets.forEach((ws, i) => {
			try {
				ws.send(seats[i].mgr ? forManagers : forReaders);
			} catch {
				// Closing.
			}
		});
	}
}

const b64urlToBytes = (s: string): Uint8Array => {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

/** `<base64url payload>.<base64url HMAC-SHA256 of the payload>`, as minted by the main app. */
async function readTicket(token: string | null, secret: string): Promise<Ticket | null> {
	if (!token || !secret) return null;
	const [payload, sig] = token.split('.');
	if (!payload || !sig) return null;
	try {
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		);
		const ok = await crypto.subtle.verify(
			'HMAC',
			key,
			b64urlToBytes(sig),
			new TextEncoder().encode(payload)
		);
		if (!ok) return null;
		const ticket = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as Ticket;
		return ticket.exp > Date.now() ? ticket : null;
	} catch {
		return null;
	}
}

export default class extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const match = url.pathname.match(/^\/room\/([\w-]{1,64})$/);
		if (!match) return new Response('Not found', { status: 404 });
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected a WebSocket', { status: 426 });
		}
		const ticket = await readTicket(url.searchParams.get('t'), this.env.LIVE_SECRET);
		if (!ticket || ticket.n !== match[1]) return new Response('Forbidden', { status: 403 });

		const headers = new Headers(request.headers);
		headers.set('x-ticket', JSON.stringify(ticket));
		const room = this.env.ROOMS.get(this.env.ROOMS.idFromName(match[1]));
		return room.fetch(new Request(request, { headers }));
	}

	/** Called by the main app: tell everyone on a note that something changed. */
	async notify(noteId: string, msg: unknown): Promise<void> {
		await this.env.ROOMS.get(this.env.ROOMS.idFromName(noteId)).notify(msg);
	}
}
