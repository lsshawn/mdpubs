/**
 * The browser end of a note's live room (see live/src/index.ts).
 *
 * Holds the roster of who else is on the note and passes the room's events to
 * the page. Reconnects on its own with backoff; after a reconnect it tells the
 * page to refetch comments, since it may have missed changes while away.
 */

/**
 * What someone last clicked or selected: block `b` of the page, and for a
 * selection the characters [s, e) of the page text. `h` hashes the page text
 * they saw (pageHash), so a pointer into another version of the page is ignored.
 */
export type LivePointer = { b: number; s?: number; e?: number; h: number };

export type LivePerson = {
	/** This connection. */
	c: string;
	/** Same for one person across tabs (signed-in) or one guest tab. */
	u: string;
	/** Null when the room hides it from this viewer. */
	name: string | null;
	/** The note's author or an org admin. */
	mgr: boolean;
	mode: 'reading' | 'editing';
	/** Heading link they are at, e.g. "#pricing". */
	s: string | null;
	p: LivePointer | null;
};

export type NoteEvent = { t: 'note'; version: number; by: string; silent: boolean };

type Handlers = {
	onComments?: () => void;
	onNote?: (e: NoteEvent) => void;
};

const PING_MS = 45_000;
const SECTION_DEBOUNCE_MS = 3_000;
const POINTER_GAP_MS = 250;

/** FNV-1a over the page text: same text, same number, in every browser. */
export function pageHash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

/** A colour per person, steady across reloads. */
export function personHue(u: string): number {
	let h = 0;
	for (const ch of u) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

export class LiveRoom {
	people = $state<LivePerson[]>([]);
	me = $state<string | null>(null);

	/** Everyone but this tab, one entry per person (their busiest tab wins). */
	others = $derived.by(() => {
		const byPerson: Record<string, LivePerson> = {};
		const myU = this.people.find((p) => p.c === this.me)?.u;
		for (const p of this.people) {
			if (p.c === this.me || p.u === myU) continue;
			const seen = byPerson[p.u];
			if (!seen || (p.mode === 'editing' && seen.mode !== 'editing')) byPerson[p.u] = p;
		}
		return Object.values(byPerson);
	});

	editors = $derived(this.others.filter((p) => p.mode === 'editing'));

	#url: string;
	#handlers: Handlers;
	#ws: WebSocket | null = null;
	#closed = false;
	#attempt = 0;
	#everOpen = false;
	#ping: ReturnType<typeof setInterval> | null = null;
	#retry: ReturnType<typeof setTimeout> | null = null;
	#sectionTimer: ReturnType<typeof setTimeout> | null = null;
	#section: string | null = null;
	#pointer: LivePointer | null = null;
	#sent = '';
	#pointerTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(url: string, handlers: Handlers = {}) {
		this.#url = url;
		this.#handlers = handlers;
	}

	connect(): void {
		if (this.#closed || typeof WebSocket === 'undefined') return;
		const ws = new WebSocket(this.#url);
		this.#ws = ws;

		ws.onopen = () => {
			this.#attempt = 0;
			if (this.#everOpen) this.#handlers.onComments?.();
			this.#everOpen = true;
			this.#sent = '';
			this.#flush();
			this.#ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
		};
		ws.onmessage = (e) => {
			if (e.data === 'pong') return;
			let m: { t?: string } & Record<string, unknown>;
			try {
				m = JSON.parse(e.data);
			} catch {
				return;
			}
			if (m.t === 'hello') this.me = m.me as string;
			else if (m.t === 'presence') this.people = m.people as LivePerson[];
			else if (m.t === 'comments') this.#handlers.onComments?.();
			else if (m.t === 'note') this.#handlers.onNote?.(m as unknown as NoteEvent);
		};
		ws.onclose = (e) => {
			if (this.#ping) clearInterval(this.#ping);
			this.#ping = null;
			this.#ws = null;
			this.people = [];
			// A refused ticket (expired after 12h, say) shows up as a plain failed
			// connect, so give up after a run of failures rather than retry forever.
			if (this.#closed || e.code === 1008 || this.#attempt >= 8) return;
			const wait = Math.min(30_000, 1000 * 2 ** this.#attempt++) * (0.5 + Math.random() / 2);
			this.#retry = setTimeout(() => this.connect(), wait);
		};
	}

	/** Where this reader is. Sent at most every few seconds. */
	setSection(link: string | null): void {
		this.#section = link || null;
		if (this.#sectionTimer) return;
		this.#sectionTimer = setTimeout(() => {
			this.#sectionTimer = null;
			this.#flush();
		}, SECTION_DEBOUNCE_MS);
	}

	/** What this reader clicked or selected; null to clear. Sent within a moment. */
	setPointer(p: LivePointer | null): void {
		this.#pointer = p;
		if (this.#pointerTimer) return;
		this.#pointerTimer = setTimeout(() => {
			this.#pointerTimer = null;
			this.#flush();
		}, POINTER_GAP_MS);
	}

	#flush(): void {
		const msg = JSON.stringify({ t: 'at', s: this.#section, p: this.#pointer });
		if (msg === this.#sent) return;
		if (this.#ws?.readyState !== WebSocket.OPEN) return;
		this.#ws.send(msg);
		this.#sent = msg;
	}

	close(): void {
		this.#closed = true;
		if (this.#retry) clearTimeout(this.#retry);
		if (this.#sectionTimer) clearTimeout(this.#sectionTimer);
		if (this.#pointerTimer) clearTimeout(this.#pointerTimer);
		if (this.#ping) clearInterval(this.#ping);
		this.#ws?.close(1000);
		this.#ws = null;
	}
}
