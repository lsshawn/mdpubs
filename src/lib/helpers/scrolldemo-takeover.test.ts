import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The landing page's signing act is scroll-driven, but the visitor can take it
 * over and sign the document themselves. `takeover` is the switch that stops
 * the timeline writing to the signing drivers while they do.
 *
 * These cover the three ways that went wrong: the stamp fading off a document
 * the visitor had just signed, the demo replaying on an already signed doc with
 * the scribble pre-drawn, and Sign writing the class behind the flag's back so
 * the flag's cache went stale and the timeline could never undo it.
 *
 * scrolldemo.js reads `matchMedia` and `window` at import, so both are stubbed
 * before the dynamic import below. No DOM beyond that: the drivers here apply
 * to a plain object, which is all the cache behaviour needs.
 */
type Driver = { set: (v: unknown) => void; snap: (v: unknown) => void; discrete?: boolean };
type Kit = {
	drive: (d: Driver, v: unknown) => void;
	snapTo: (d: Driver, v: unknown) => void;
	mute: (on: boolean) => void;
};

let flag: (apply: (v: unknown) => void) => Driver;
let takeover: (drivers: Driver[]) => Kit;

before(async () => {
	const g = globalThis as Record<string, unknown>;
	g.matchMedia = () => ({ matches: false });
	g.window = g;
	g.requestAnimationFrame = () => 0;
	/*
	 * Loaded by URL, not a static specifier. These are plain browser scripts
	 * under static/, deliberately outside tsconfig's `include`; importing them
	 * by path would pull both into svelte-check and report ~150 type errors in
	 * files the project never type-checks.
	 */
	const dir = new URL('../../../static/scrolldemo/', import.meta.url);
	({ flag } = await import(new URL('scrolldemo.js', dir).href));
	({ takeover } = await import(new URL('mdpubs-demo.js', dir).href));
});

/** A flag plus the log of values actually applied to the DOM. */
const spy = () => {
	const applied: unknown[] = [];
	return { d: flag((v) => applied.push(v)), applied };
};

test('while muted the timeline cannot write, but hand-driven code still can', () => {
	const { d, applied } = spy();
	const kit = takeover([d]);

	kit.mute(true);
	d.set(true); // the timeline's write: dropped
	assert.deepEqual(applied, []);

	kit.drive(d, true); // the visitor's tap: lands
	assert.deepEqual(applied, [true]);
});

test('unmuting hands the driver back to the timeline', () => {
	const { d, applied } = spy();
	const kit = takeover([d]);

	kit.mute(true);
	kit.drive(d, true);
	kit.mute(false);
	d.set(false);

	assert.deepEqual(applied, [true, false]);
});

test('driving through the kit keeps the cache honest, so the timeline can undo it', () => {
	// The signing bug: Sign set the class directly instead of through the flag.
	// The flag still cached `false`, so when the timeline later asked for `false`
	// it was a no-op and the document stayed signed.
	const { d, applied } = spy();
	const kit = takeover([d]);

	kit.mute(true);
	kit.drive(d, true); // signed, through the driver
	kit.mute(false);
	d.set(false); // the timeline undoing it

	assert.deepEqual(applied, [true, false]);
});

test('a direct write behind the driver is exactly what goes stale', () => {
	// Documents why the rule exists: bypass the driver and its cache disagrees
	// with the DOM, so the timeline's undo is swallowed.
	let domSigned = false;
	const applied: unknown[] = [];
	const d = flag((v) => {
		applied.push(v);
		domSigned = v as boolean;
	});
	const kit = takeover([d]);

	// The timeline has already run, so the flag's cache holds `false`.
	d.set(false);
	applied.length = 0;

	kit.mute(true);
	domSigned = true; // the bug: written behind the flag's back
	kit.mute(false);
	d.set(false); // cache still says false -> no apply, the DOM keeps the edit

	assert.deepEqual(applied, []);
	assert.equal(domSigned, true, 'stays signed: this is the stale cache the kit avoids');
});

test('every signing driver is muted together, the stamp included', () => {
	// The stamp was left out of the muted set, so one scroll tick after signing
	// faded it back to the timeline's value at that position, which is 0.
	const drawer = spy(),
		stamp = spy(),
		signedFlag = spy();
	const kit = takeover([drawer.d, stamp.d, signedFlag.d]);

	kit.mute(true);
	for (const s of [drawer, stamp, signedFlag]) s.d.set('from the timeline');

	assert.deepEqual(drawer.applied, []);
	assert.deepEqual(stamp.applied, []);
	assert.deepEqual(signedFlag.applied, []);
});

test('snapTo reaches the real driver while muted', () => {
	// Release uses snapTo to reset the drivers before handing back, so the
	// timeline's next write is not swallowed as a no-op.
	const { d, applied } = spy();
	const kit = takeover([d]);

	kit.mute(true);
	kit.drive(d, true);
	kit.snapTo(d, false);

	assert.deepEqual(applied, [true, false]);
});
