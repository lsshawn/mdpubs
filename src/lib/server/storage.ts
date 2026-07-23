/**
 * Note image/asset storage on Cloudflare R2 (native binding).
 *
 * Replaces the old mdpubs-api `r2.ts`, which used the S3 API (`@aws-sdk`) +
 * `sharp` on a VPS. Here:
 *   - Storage is the R2 binding `env.BUCKET` — no access keys, no S3 SDK.
 *   - Images are NOT compressed at write time (no `sharp`). Originals are stored
 *     as-is; resize/WebP happens on DELIVERY via Cloudflare Images URL
 *     transforms (see `imageUrl`).
 *   - `imageMap` stores PLAIN PUBLIC URLs (`${PUBLIC_IMG_BASE}/<key>`), so note
 *     reads need no per-image presigning. The R2 bucket `neonote` must be
 *     connected to PUBLIC_IMG_BASE as a public custom domain.
 *
 * Bindings are request-scoped (they live on `platform.env`), so every function
 * takes the `R2Bucket` explicitly — there is no module-level singleton.
 */
import { env as publicEnv } from '$env/dynamic/public';
import { createHash } from 'node:crypto';
import type { R2Bucket } from '@cloudflare/workers-types';

/** Max upload size, mirrors the old config.limits.fileSize (200MB). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

export class FileTooLargeError extends Error {
	constructor(nameOrMsg: string) {
		super(nameOrMsg);
		this.name = 'FileTooLargeError';
	}
}

function imgBase(): string {
	return (publicEnv.PUBLIC_IMG_BASE ?? 'https://img.mdpubs.com').replace(/\/$/, '');
}

/**
 * Stable object key for a note asset. Mirrors the old scheme so existing objects
 * remain addressable: users/<userId>/notes/<noteId>/<sha256(name)[:12]><ext>.
 */
export function fileKey(userId: string, noteId: number, originalName: string): string {
	const lastDot = originalName.lastIndexOf('.');
	const extension = lastDot !== -1 ? originalName.substring(lastDot) : '';
	const nameToHash = lastDot !== -1 ? originalName.substring(0, lastDot) : originalName;
	const hash = createHash('sha256').update(nameToHash).digest('hex').substring(0, 12);
	return `users/${userId}/notes/${noteId}/${hash}${extension}`;
}

/** The plain public URL stored in imageMap for a key. */
export function publicUrl(key: string): string {
	return `${imgBase()}/${key}`;
}

/** Given a stored image URL (or key), the R2 key. */
export function keyFromUrl(url: string): string {
	const base = imgBase();
	if (url.startsWith(base + '/')) return url.slice(base.length + 1);
	return url; // already a key
}

/**
 * A delivery URL that resizes/reformats via Cloudflare Images URL transforms.
 * The stored imageMap keeps the plain original URL; callers that want a resized
 * variant (e.g. in-page <img>) can wrap it. Defaults match the old sharp config
 * (max 1200px, WebP).
 */
export function imageUrl(
	urlOrKey: string,
	opts: { width?: number; height?: number; quality?: number; format?: string } = {}
): string {
	const src = urlOrKey.startsWith('http') ? urlOrKey : publicUrl(urlOrKey);
	const { width = 1200, quality = 75, format = 'auto', height } = opts;
	const parts = [`width=${width}`, `quality=${quality}`, `format=${format}`, 'fit=scale-down'];
	if (height) parts.push(`height=${height}`);
	// Cloudflare Images URL form: /cdn-cgi/image/<opts>/<absolute-src>
	return `${imgBase()}/cdn-cgi/image/${parts.join(',')}/${src}`;
}

export type UploadResult = {
	success: boolean;
	url: string; // plain public URL (goes into imageMap)
	size: number;
	error?: string;
};

/**
 * Upload one asset to R2. Skips the write if an object with the same key AND
 * size already exists (cheap dedup, mirrors the old HeadObject check).
 * No compression — originals are stored; delivery transforms handle sizing.
 */
export async function uploadFile(
	bucket: R2Bucket,
	userId: string,
	noteId: number,
	originalName: string,
	body: ArrayBuffer,
	contentType: string
): Promise<UploadResult> {
	const size = body.byteLength;
	if (size > MAX_FILE_BYTES) {
		const mb = (size / (1024 * 1024)).toFixed(2);
		return {
			success: false,
			url: '',
			size,
			error: `File "${originalName}" is too large (${mb}MB). Max ${MAX_FILE_BYTES / (1024 * 1024)}MB.`
		};
	}

	const key = fileKey(userId, noteId, originalName);
	try {
		const existing = await bucket.head(key);
		if (existing && existing.size === size) {
			return { success: true, url: publicUrl(key), size };
		}
		await bucket.put(key, body, { httpMetadata: { contentType } });
		return { success: true, url: publicUrl(key), size };
	} catch (e) {
		return { success: false, url: '', size, error: e instanceof Error ? e.message : 'Upload failed' };
	}
}

/** Delete objects by their stored URLs (or keys). Best-effort, batched. */
export async function deleteFiles(bucket: R2Bucket, urls: string[]): Promise<void> {
	if (!urls?.length) return;
	const keys = urls.map(keyFromUrl);
	// R2 binding delete accepts an array of keys.
	await bucket.delete(keys);
}

/** Delete every object under a prefix (e.g. a whole note or user). Paginates. */
export async function deleteFolder(bucket: R2Bucket, prefix: string): Promise<number> {
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const listed = await bucket.list({ prefix, cursor });
		const keys = listed.objects.map((o) => o.key);
		if (keys.length) {
			await bucket.delete(keys);
			deleted += keys.length;
		}
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
	return deleted;
}
