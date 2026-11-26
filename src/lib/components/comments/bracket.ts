/**
 * A hand-drawn `]` for the margin, in the manner of rough-notation's bracket:
 * three strokes (top tick, upright, bottom tick), each a single wobbly cubic.
 * The wobble is seeded, so a bracket keeps its shape between renders.
 */

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const ROUGHNESS = 1.5;
const MAX_OFFSET = 2;
const BOWING = 1;

function stroke(x1: number, y1: number, x2: number, y2: number, rnd: () => number): string {
	const length = Math.hypot(x2 - x1, y2 - y1);
	let offset = MAX_OFFSET;
	if (offset * offset * 100 > length * length) offset = length / 10;
	const r = (x: number) => ROUGHNESS * (rnd() * 2 * x - x);
	const diverge = 0.2 + rnd() * 0.2;
	const bowX = r((BOWING * MAX_OFFSET * (y2 - y1)) / 200);
	const bowY = r((BOWING * MAX_OFFSET * (x1 - x2)) / 200);
	const f = (n: number) => n.toFixed(2);
	return (
		`M${f(x1 + r(offset))} ${f(y1 + r(offset))} C` +
		`${f(bowX + x1 + (x2 - x1) * diverge + r(offset))} ${f(bowY + y1 + (y2 - y1) * diverge + r(offset))}, ` +
		`${f(bowX + x1 + 2 * (x2 - x1) * diverge + r(offset))} ${f(bowY + y1 + 2 * (y2 - y1) * diverge + r(offset))}, ` +
		`${f(x2 + r(offset))} ${f(y2 + r(offset))}`
	);
}

export type BracketStroke = { d: string };

/**
 * A right bracket whose open side starts at `x` and whose upright stands
 * `depth` further right, from `top` to `bottom`: top tick, upright, bottom tick.
 */
export function bracket(
	x: number,
	top: number,
	bottom: number,
	seed: string,
	depth = 10
): BracketStroke[] {
	const rnd = mulberry32(hash(seed));
	const r = x + depth;
	return [
		{ d: stroke(x, top, r, top, rnd) },
		{ d: stroke(r, top, r, bottom, rnd) },
		{ d: stroke(r, bottom, x, bottom, rnd) }
	];
}
