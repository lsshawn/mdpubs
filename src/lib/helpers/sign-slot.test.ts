import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSigningSlot, resolveSignSlot } from './sign-slot';

// Mirrors the tripartite NDA layout: signers declared as [CGPT, ENECO, EPC-M open
// slot], but the anchors appear in the document as CGPT, EPC-M, ENECO. Synthetic
// data only; no database access.
type S = { name: string; label?: string; index: number; signed: boolean; open?: boolean };
const anchors = ['Dr A', 'Company B Pte Ltd', 'Mr C']; // document order

test('open slot anchor resolves to the open slot before signing', () => {
	const signers: S[] = [
		{ name: 'Dr A', label: 'Dr A', index: 0, signed: true },
		{ name: 'Mr C', label: 'Mr C', index: 1, signed: true },
		{ name: 'Company B Pte Ltd', label: 'Company B Pte Ltd', index: 2, signed: false, open: true }
	];
	assert.equal(resolveSignSlot(signers, anchors[1], 1)?.index, 2);
});

test('open slot anchor still resolves to the open slot after the signer enters their name', () => {
	// After signing, getState surfaces the signer's typed name instead of the label.
	const signers: S[] = [
		{ name: 'Dr A', label: 'Dr A', index: 0, signed: true },
		{ name: 'Mr C', label: 'Mr C', index: 1, signed: true },
		{ name: 'Ruben B', label: 'Company B Pte Ltd', index: 2, signed: true, open: true }
	];
	const slot = resolveSignSlot(signers, anchors[1], 1);
	assert.equal(slot?.index, 2);
	assert.equal(slot?.name, 'Ruben B');
});

test('every anchor maps to a distinct slot after all have signed', () => {
	const signers: S[] = [
		{ name: 'Dr A', label: 'Dr A', index: 0, signed: true },
		{ name: 'Mr C', label: 'Mr C', index: 1, signed: true },
		{ name: 'Ruben B', label: 'Company B Pte Ltd', index: 2, signed: true, open: true }
	];
	const got = anchors.map((l, i) => resolveSignSlot(signers, l, i)?.index);
	assert.deepEqual(got, [0, 2, 1]);
});

test('an unlabelled anchor falls back to anchor order', () => {
	const signers: S[] = [
		{ name: 'X', index: 0, signed: false },
		{ name: 'Y', index: 1, signed: false }
	];
	assert.equal(resolveSignSlot(signers, '', 1)?.index, 1);
});

test('a label that matches a fixed signer name wins over position', () => {
	const signers: S[] = [
		{ name: 'X', label: 'X', index: 0, signed: false },
		{ name: 'Y', label: 'Y', index: 1, signed: false }
	];
	assert.equal(resolveSignSlot(signers, 'y', 0)?.index, 1);
});

// Server-side slot pick. Same layout: no signer has a declared email.
const declared = [{ email: '' }, { email: '' }, { email: '', open: true }];

test('signing the open slot box fills the open slot, not slot 0', () => {
	assert.deepEqual(pickSigningSlot(declared, new Set(), '', 2), { index: 2 });
});

test('a requested slot that is already signed is refused', () => {
	assert.ok('error' in pickSigningSlot(declared, new Set([2]), '', 2));
});

test('a requested slot reserved for a declared email needs that email', () => {
	const withEmail = [{ email: 'a@x.com' }, { email: '' }];
	assert.ok('error' in pickSigningSlot(withEmail, new Set(), 'b@x.com', 0));
	assert.deepEqual(pickSigningSlot(withEmail, new Set(), 'A@x.com', 0), { index: 0 });
});

test('an out-of-range requested slot is refused', () => {
	assert.ok('error' in pickSigningSlot(declared, new Set(), '', 5));
	assert.ok('error' in pickSigningSlot(declared, new Set(), '', 1.5));
});

test('without a requested slot, the positional rule still applies', () => {
	assert.deepEqual(pickSigningSlot(declared, new Set([0]), ''), { index: 1 });
	assert.ok('error' in pickSigningSlot(declared, new Set([0, 1, 2]), ''));
});
