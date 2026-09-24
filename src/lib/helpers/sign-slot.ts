/**
 * Resolve which signer slot a `<!-- mdpubs-sign-here: Label -->` anchor belongs to.
 *
 * Match on the DECLARED label first: once an open slot is signed, `name` becomes
 * whatever the signer typed, so matching on `name` alone loses the anchor and it
 * falls back to document order — which can point at a different signer's slot.
 * Then match on the current name, then fall back to the anchor's position.
 */
export type SlotLike = { name: string; label?: string };

export function resolveSignSlot<T extends SlotLike>(
	signers: T[],
	label: string,
	slotIndex: number
): T | null {
	const norm = (s: string) => s.trim().toLowerCase();
	const want = norm(label);
	if (want) {
		const byLabel =
			signers.find((s) => s.label !== undefined && norm(s.label) === want) ??
			signers.find((s) => norm(s.name) === want);
		if (byLabel) return byLabel;
	}
	return signers[slotIndex] ?? null;
}

/**
 * Server side: pick the slot a signature fills.
 *
 * When the client says which slot it signed (`requested`, the sign box's slot
 * index), honour it — otherwise every emailless slot is claimed positionally, so
 * signing the second box on the page fills slot 0 and shows up in the first box.
 * Without `requested` (older clients, direct API calls) keep the positional rule:
 * email match first, then the next unsigned emailless slot.
 *
 * Returns the slot index, or an error message for the caller to throw.
 */
export function pickSigningSlot(
	signers: { email?: string }[],
	signedIndexes: Set<number>,
	email: string,
	requested?: number
): { index: number } | { error: string } {
	const norm = (s: string | undefined) => (s || '').trim().toLowerCase();
	const want = norm(email);

	if (requested !== undefined) {
		const slot = signers[requested];
		if (!Number.isInteger(requested) || !slot)
			return { error: 'That signing slot does not exist.' };
		if (signedIndexes.has(requested)) return { error: 'This slot has already been signed.' };
		if (slot.email && norm(slot.email) !== want) {
			return { error: 'This slot is reserved for a different signer.' };
		}
		return { index: requested };
	}

	let index = signers.findIndex(
		(s, i) => !!s.email && !signedIndexes.has(i) && norm(s.email) === want
	);
	if (index === -1) index = signers.findIndex((s, i) => !s.email && !signedIndexes.has(i));
	if (index === -1) return { error: 'There are no signing slots left for this document.' };
	return { index };
}
