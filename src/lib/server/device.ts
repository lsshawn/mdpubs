/**
 * Device-flow login for the `mdpubs` CLI (RFC 8628 shape, plain-text replies so
 * a POSIX shell script can read them without jq).
 *
 *   1. CLI  POST /api/cli/login   → device secret + short user code + URL
 *   2. User opens /device?code=…, logs in, pays if new, clicks Allow
 *   3. CLI  POST /api/cli/token   → "pending" until approved, then the token
 *
 * The token is minted on the poll that follows approval, so the raw token only
 * ever travels to the CLI and is never stored.
 */
import { and, eq, gt } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { deviceCode } from '#lib/server/db/schema.js';
import { issueToken, randomSecret, sha256Hex } from '#lib/server/tokens.js';

const TTL_MS = 15 * 60 * 1000;
// RFC 8628 §6.1: consonants only, so a code can't spell a word or be misread.
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

function userCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
	return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Normalise what a person typed or pasted: "wdjb mjht" → "WDJB-MJHT". */
export function normaliseUserCode(input: string | null): string | null {
	const letters = (input ?? '').toUpperCase().replace(/[^A-Z]/g, '');
	return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
}

export async function startDeviceLogin() {
	const device = randomSecret();
	const code = userCode();
	await db.insert(deviceCode).values({
		deviceCodeHash: sha256Hex(device),
		userCode: code,
		expiresAt: new Date(Date.now() + TTL_MS)
	});
	return { device, code, expiresIn: TTL_MS / 1000 };
}

/** A login still waiting for approval, by the code shown to the user. */
export async function pendingDeviceLogin(code: string) {
	const [row] = await db
		.select()
		.from(deviceCode)
		.where(
			and(
				eq(deviceCode.userCode, code),
				eq(deviceCode.status, 'pending'),
				gt(deviceCode.expiresAt, new Date())
			)
		)
		.limit(1);
	return row ?? null;
}

export async function decideDeviceLogin(id: string, userId: string, approve: boolean) {
	await db
		.update(deviceCode)
		.set({ status: approve ? 'approved' : 'denied', userId })
		.where(and(eq(deviceCode.id, id), eq(deviceCode.status, 'pending')));
}

export type PollResult =
	| { status: 'pending' | 'denied' | 'expired' | 'unknown' }
	| { status: 'approved'; token: string };

export async function pollDeviceLogin(device: string): Promise<PollResult> {
	const [row] = await db
		.select()
		.from(deviceCode)
		.where(eq(deviceCode.deviceCodeHash, sha256Hex(device)))
		.limit(1);
	if (!row || row.status === 'consumed') return { status: 'unknown' };
	if (row.status === 'denied') return { status: 'denied' };
	if (row.expiresAt < new Date()) return { status: 'expired' };
	if (row.status !== 'approved' || !row.userId) return { status: 'pending' };

	// Claim the row before minting, so two racing polls can't both get a token.
	const claimed = await db
		.update(deviceCode)
		.set({ status: 'consumed' })
		.where(and(eq(deviceCode.id, row.id), eq(deviceCode.status, 'approved')))
		.returning({ id: deviceCode.id });
	if (claimed.length === 0) return { status: 'unknown' };

	const token = await issueToken({ userId: row.userId, kind: 'cli', name: 'mdpubs CLI' });
	return { status: 'approved', token };
}
