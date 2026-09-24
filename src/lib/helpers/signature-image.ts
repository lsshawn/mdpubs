/**
 * Draw an uploaded signature image onto the signing pad canvas, so an uploaded
 * signature goes through the same PNG submit path as a drawn one.
 *
 * The image is scaled to fit (never upscaled past its natural size) and centred.
 * Near-white pixels are made transparent: a photo or scan of a wet signature
 * comes on paper, and an opaque white box would sit over the document.
 */
const WHITE_THRESHOLD = 215;

export async function drawSignatureImage(canvas: HTMLCanvasElement, file: File): Promise<void> {
	if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Could not read the signature pad.');

	const bitmap = await createImageBitmap(file).catch(() => {
		throw new Error('Could not read that image.');
	});

	// Work in device pixels; the pad's context may carry a devicePixelRatio scale.
	const w = canvas.width;
	const h = canvas.height;
	const pad = Math.round(Math.min(w, h) * 0.05);
	const scale = Math.min((w - pad * 2) / bitmap.width, (h - pad * 2) / bitmap.height, 1);
	const dw = Math.round(bitmap.width * scale);
	const dh = Math.round(bitmap.height * scale);

	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, w, h);
	ctx.drawImage(bitmap, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
	bitmap.close();

	const data = ctx.getImageData(0, 0, w, h);
	const px = data.data;
	for (let i = 0; i < px.length; i += 4) {
		if (px[i] > WHITE_THRESHOLD && px[i + 1] > WHITE_THRESHOLD && px[i + 2] > WHITE_THRESHOLD) {
			px[i + 3] = 0;
		}
	}
	ctx.putImageData(data, 0, 0);
	ctx.restore();
}
