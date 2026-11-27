/**
 * Live presence and updates, served by the separate mdpubs-live Worker (live/).
 *
 * The page asks for a ticket here after its own access check; the browser takes
 * it to wss://live.mdpubs.com. Writes that change what readers see (comments,
 * the note itself) call notifyLive, which reaches the note's room over the LIVE
 * service binding.
 *
 * Off by default: a note turns it on with `mdpubs-live: true` in its frontmatter,
 * so a note that goes viral costs nothing unless its author asked for this.
 * Also off when LIVE_URL or LIVE_SECRET is unset (local dev without the live Worker).
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import matter from 'gray-matter';
import { env, waitUntil } from 'cloudflare:workers';
import { LIVE_SECRET, LIVE_URL } from '$app/env/private';

const TICKET_TTL_MS = 12 * 60 * 60 * 1000;

export type LiveMode = 'reading' | 'editing';

/** True when the note's frontmatter says `mdpubs-live: true` (or on/yes). */
export function liveEnabled(
	frontmatterOrContent: Record<string, unknown> | string | null
): boolean {
	let data: Record<string, unknown> | null = null;
	if (typeof frontmatterOrContent === 'string') {
		try {
			data = matter(frontmatterOrContent).data;
		} catch {
			return false;
		}
	} else {
		data = frontmatterOrContent;
	}
	const raw = data?.['mdpubs-live'];
	const v = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
	return v === true || v === 'true' || v === 'on' || v === 'yes';
}

/** What the browser needs to join a note's room. */
export type LiveJoin = { url: string };

export type LiveEvent =
	/** Comments changed: refetch them (each viewer's copy differs, so no payload). */
	| { t: 'comments' }
	/** The note was saved. `silent` is an editor autosave, not a new version. */
	| { t: 'note'; version: number; by: string; silent: boolean };

/**
 * A signed ticket for one viewer of one note. `user` is null for a guest, who is
 * named `guestName` (an embed's reader) or "Guest".
 */
export function liveJoin(
	noteId: string,
	who: {
		user: { id: string; username: string | null; email: string } | null;
		guestName?: string | null;
		canManage: boolean;
		mode: LiveMode;
	}
): LiveJoin | null {
	if (!LIVE_URL || !LIVE_SECRET) return null;
	const ticket = {
		n: noteId,
		u: who.user
			? createHash('sha256').update(`live:${who.user.id}`).digest('base64url').slice(0, 12)
			: `g_${randomBytes(6).toString('base64url')}`,
		name: (who.user ? who.user.username || who.user.email.split('@')[0] : who.guestName) || 'Guest',
		mgr: who.canManage,
		mode: who.mode,
		exp: Date.now() + TICKET_TTL_MS
	};
	const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
	const sig = createHmac('sha256', LIVE_SECRET).update(payload).digest('base64url');
	const base = LIVE_URL.replace(/\/$/, '');
	return { url: `${base}/room/${encodeURIComponent(noteId)}?t=${payload}.${sig}` };
}

/**
 * Tell everyone on a note that something changed. Runs after the response is
 * sent, so a slow or missing live Worker never holds up the write. Never throws.
 */
export function notifyLive(noteId: string, content: string | null, event: LiveEvent): void {
	if (!LIVE_URL || !env.LIVE || !liveEnabled(content)) return;
	try {
		// Promise.resolve: the dev proxy hands back a bare thenable.
		const sent = Promise.resolve(env.LIVE.notify(noteId, event)).catch((error) =>
			console.error('Live notify failed:', error)
		);
		try {
			waitUntil(sent);
		} catch {
			// No request context (vite dev): the promise still runs on its own.
		}
	} catch (error) {
		console.error('Live notify failed:', error);
	}
}
