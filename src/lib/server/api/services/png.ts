/**
 * Blank-signature detection for drawn signature PNGs.
 *
 * The signature canvas draws onto a TRANSPARENT surface (`clearRect`, no
 * background fill — see SignPanel.svelte), so "blank" has a precise meaning
 * here: every pixel has alpha 0. That makes the check a decode of the alpha
 * channel rather than any kind of image analysis.
 *
 * SignPanel already refuses to submit when its `hasDrawn` flag is false, but
 * that flag is client state: it is set by the first pointer event, so a stray
 * tap that deposits one invisible-ish dot flips it, and any client that posts
 * the endpoint directly skips it entirely. A blank image that reaches the DB
 * becomes a signature with no visible mark on a locked document, recoverable
 * only by hand — so the authoritative check belongs on the server.
 *
 * Implemented with `DecompressionStream('deflate')`, which is available in
 * both Workers and Node, rather than a zlib dependency.
 */

/** Bytes 0-7 of every PNG file. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class NotAPngError extends Error {
	constructor(message = 'The signature image is not a valid PNG.') {
		super(message);
		this.name = 'NotAPngError';
	}
}

interface PngHeader {
	width: number;
	height: number;
	bitDepth: number;
	colorType: number;
	interlaced: boolean;
}

/**
 * Walk the chunk list once, returning the IHDR fields and the concatenated
 * IDAT payload. IDAT may legally be split across several chunks, and the
 * deflate stream only decodes once they are joined.
 */
function readChunks(bytes: Uint8Array): { header: PngHeader; idat: Uint8Array } {
	for (let i = 0; i < PNG_MAGIC.length; i++) {
		if (bytes[i] !== PNG_MAGIC[i]) throw new NotAPngError();
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let header: PngHeader | null = null;
	const idatParts: Uint8Array[] = [];
	// 8 magic bytes, then repeating [length:4][type:4][data:length][crc:4].
	let offset = 8;

	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7]
		);
		const dataStart = offset + 8;
		// A truncated or lying length would otherwise read past the buffer.
		if (dataStart + length > bytes.length) throw new NotAPngError();

		if (type === 'IHDR') {
			header = {
				width: view.getUint32(dataStart),
				height: view.getUint32(dataStart + 4),
				bitDepth: bytes[dataStart + 8],
				colorType: bytes[dataStart + 9],
				interlaced: bytes[dataStart + 12] !== 0
			};
		} else if (type === 'IDAT') {
			idatParts.push(bytes.subarray(dataStart, dataStart + length));
		} else if (type === 'IEND') {
			break;
		}

		offset = dataStart + length + 4; // + CRC
	}

	if (!header) throw new NotAPngError();
	if (idatParts.length === 0) throw new NotAPngError('The signature image has no pixel data.');

	const total = idatParts.reduce((n, p) => n + p.length, 0);
	const idat = new Uint8Array(total);
	let at = 0;
	for (const part of idatParts) {
		idat.set(part, at);
		at += part.length;
	}
	return { header, idat };
}

/** Inflate the zlib-wrapped IDAT stream. */
async function inflate(idat: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([idat as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate'));
	const buf = await new Response(stream).arrayBuffer();
	return new Uint8Array(buf);
}

/**
 * Reverse the per-scanline PNG filters in place, returning the raw pixel rows.
 *
 * Filtering is defined on BYTES at a fixed distance `bpp` (the pixel stride),
 * not on channels, so this works for any colour type at bit depth 8 without
 * knowing what the channels mean.
 */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
	const stride = width * bpp;
	const out = new Uint8Array(stride * height);
	let pos = 0;

	for (let y = 0; y < height; y++) {
		// Each scanline is prefixed with its filter type byte.
		const filter = raw[pos++];
		const line = raw.subarray(pos, pos + stride);
		pos += stride;
		const cur = out.subarray(y * stride, (y + 1) * stride);
		const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? cur[x - bpp] : 0; // left
			const b = prev ? prev[x] : 0; // up
			const c = x >= bpp && prev ? prev[x - bpp] : 0; // up-left
			const v = line[x];

			switch (filter) {
				case 0:
					cur[x] = v;
					break;
				case 1:
					cur[x] = (v + a) & 0xff;
					break;
				case 2:
					cur[x] = (v + b) & 0xff;
					break;
				case 3:
					cur[x] = (v + ((a + b) >> 1)) & 0xff;
					break;
				case 4: {
					// Paeth: pick whichever neighbour the gradient predictor is closest to.
					const p = a + b - c;
					const pa = Math.abs(p - a);
					const pb = Math.abs(p - b);
					const pc = Math.abs(p - c);
					cur[x] = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
					break;
				}
				default:
					throw new NotAPngError('The signature image uses an unsupported PNG filter.');
			}
		}
	}
	return out;
}

/**
 * How many pixels of a drawn signature PNG are actually visible.
 *
 * `null` means "cannot tell" — an interlaced image, an exotic bit depth, a
 * colour type with no alpha, or a decode failure. Callers must treat that as
 * permission to proceed: refusing a signature we merely failed to parse would
 * block a legitimate signer, which is far worse than storing a blank one.
 *
 * A pixel counts as visible when alpha exceeds `alphaThreshold`; anti-aliased
 * stroke edges land at very low alpha, and counting those would make a stray
 * near-invisible smudge look like a signature.
 */
export async function countVisiblePixels(
	png: ArrayBuffer,
	alphaThreshold = 8
): Promise<number | null> {
	try {
		const { header, idat } = readChunks(new Uint8Array(png));
		const { width, height, bitDepth, colorType, interlaced } = header;

		// Only the two alpha-bearing colour types at depth 8 are decoded: that is
		// what every browser's canvas.toBlob() emits for a transparent canvas.
		// Anything else (paletted, 16-bit, grayscale, Adam7) is a "cannot tell".
		if (interlaced || bitDepth !== 8) return null;
		if (colorType !== 6 && colorType !== 4) return null;
		if (width === 0 || height === 0) return 0;
		const bpp = colorType === 6 ? 4 : 2; // RGBA | grayscale+alpha
		// Guard against a decompression bomb before allocating the pixel buffer.
		if (width * height > 16_000_000) return null;

		const inflated = await inflate(idat);
		if (inflated.length < height * (width * bpp + 1)) return null;
		const pixels = unfilter(inflated, width, height, bpp);

		let visible = 0;
		// Alpha is the last byte of each pixel for both supported colour types.
		for (let i = bpp - 1; i < pixels.length; i += bpp) {
			if (pixels[i] > alphaThreshold) visible++;
		}
		return visible;
	} catch {
		return null;
	}
}

/**
 * True when a drawn signature PNG carries no meaningful mark.
 *
 * `minVisiblePixels` is a floor, not just a zero-check: a single accidental tap
 * on the canvas leaves a dot of a few dozen pixels, which is indistinguishable
 * from blank on a printed document but would still pass an `alpha > 0` test.
 * A genuine drawn signature covers thousands.
 *
 * Returns false whenever the image could not be decoded — see
 * `countVisiblePixels`.
 */
export async function isBlankSignaturePng(
	png: ArrayBuffer,
	minVisiblePixels = 64
): Promise<boolean> {
	const visible = await countVisiblePixels(png);
	if (visible === null) return false;
	return visible < minVisiblePixels;
}
