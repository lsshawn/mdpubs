/**
 * E-signing service (mdpubs-sign) — ported from mdpubs-api/src/services/sign.ts.
 *
 * A pub opts into signing from its own content:
 *
 *   HTML pub — comments near the top:
 *     <!-- mdpubs-sign: true -->
 *     <!-- mdpubs-signer: Lim Shi Shyang <sub@sshawn.com> -->
 *     <!-- mdpubs-signer: KW Loh <kw@example.com> -->
 *     <!-- mdpubs-sign-order: sequential -->   (optional; sequential | parallel)
 *
 *   Markdown pub — frontmatter:
 *     mdpubs-sign: true
 *     mdpubs-signers:
 *       - Lim Shi Shyang <sub@sshawn.com>
 *       - KW Loh <kw@example.com>
 *     mdpubs-sign-order: sequential
 *
 * PORT NOTES:
 *   - Signature-image storage uses the R2 binding (`$lib/server/storage`), so
 *     `sign()` takes an `R2Bucket` threaded from the route.
 *   - Signature images are NO LONGER presigned: `signatureImageKey` holds the
 *     plain public URL (as `uploadFile` returns), and `withSignatureImageUrls`
 *     surfaces it directly. No presign churn.
 *   - All hashing / canonicalization (canonicalBody, hashContent) is BYTE-FAITHFUL
 *     to the original.
 */

import { createHash } from 'node:crypto';
import { database, NotFoundError, NoteNotOwnedError } from '../db';
import { uploadFile, publicUrl } from '$lib/server/storage';
import type { R2Bucket } from '@cloudflare/workers-types';
import { NoteService } from './note';
import type { Note, Signature } from '$lib/server/db/schema';

// Stateless helpers only (stripLeadingFrontmatter, isHtmlFile). NoteService holds
// no per-request state, so a module-local instance is safe and avoids a singleton.
const noteService = new NoteService();

export interface Signer {
	name: string;
	email: string;
	/**
	 * An "open" slot: the person/email is unknown in advance. Anyone with the link
	 * fills it with any name + email at signing time (both recorded). Declared via
	 * `<!-- mdpubs-signer-open: Label -->` (or markdown `mdpubs-signers-open:`).
	 * For open slots `email` is empty until signed; `name` holds the slot label.
	 */
	open?: boolean;
}

/** A custom field a signer fills in. Declare optional with a trailing `?`. */
export interface SignField {
	label: string;
	required: boolean;
}

export interface SignConfig {
	enabled: boolean;
	signers: Signer[];
	order: 'sequential' | 'parallel';
	/** Extra fields signers fill in (name/email/date are automatic). */
	fields: SignField[];
}

export interface SignStateSigner extends Signer {
	index: number;
	signed: boolean;
	signedAt: number | null;
	/** Whose turn it is to sign now (sequential only; always true for parallel). */
	isTurn: boolean;
	signatureImageUrl?: string | null;
	/** Custom field values this signer entered (label -> value), once signed. */
	fields?: Record<string, string> | null;
}

export interface SignState {
	enabled: boolean;
	order: 'sequential' | 'parallel';
	/** Extra fields signers fill in (label + whether required). */
	fields: SignField[];
	signers: SignStateSigner[];
	complete: boolean;
	/** True once a signature request has been snapshotted (first signature). */
	started: boolean;
	/**
	 * Whether the currently served content still matches what was signed. Under
	 * lock-on-first-signature this is always true on the happy path; a false here
	 * means something bypassed the lock and the document was altered after signing.
	 */
	contentMatches: boolean;
}

class SignService {
	/** Normalise an email for matching: trimmed + lowercased. */
	private normEmail(email: string): string {
		return email.trim().toLowerCase();
	}

	/**
	 * The canonical bytes a signature binds to. This MUST equal what the public
	 * view / `/raw` endpoint serves as the document body, so a signer signs
	 * exactly what they see: the content with the leading (imageMap) frontmatter
	 * block stripped. Asset-URL rewriting is excluded — we hash the authored body.
	 */
	canonicalBody(note: Pick<Note, 'content'>): string {
		return noteService.stripLeadingFrontmatter(note.content || '');
	}

	hashContent(body: string): string {
		return createHash('sha256').update(body, 'utf8').digest('hex');
	}

	/**
	 * Parse a signer entry. Accepts:
	 *   - `Name <email>`  -> fixed signer, email pre-filled at signing
	 *   - `email`         -> fixed signer, name == email
	 *   - `Name`          -> fixed signer, NO email; the signer enters their email
	 *                        when signing (name is locked). Email is optional because
	 *                        slot identity is by index, not email.
	 * Null only for an empty entry.
	 */
	private parseSigner(raw: string): Signer | null {
		const trimmed = raw.trim();
		if (!trimmed) return null;
		const angle = trimmed.match(/^(.*?)\s*<\s*([^>]+?)\s*>$/);
		if (angle) {
			const name = angle[1].trim();
			const email = angle[2].trim();
			return { name: name || email, email };
		}
		// Bare email.
		if (/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
			return { name: trimmed, email: trimmed };
		}
		// Bare name: fixed signer, email supplied at signing time.
		return { name: trimmed, email: '' };
	}

	/**
	 * Parse a field declaration. A trailing `?` marks it optional:
	 *   "Title"   -> { label: "Title",   required: true  }
	 *   "Title?"  -> { label: "Title",   required: false }
	 */
	private parseField(raw: string): SignField | null {
		let label = raw.trim();
		if (!label) return null;
		let required = true;
		if (label.endsWith('?')) {
			required = false;
			label = label.slice(0, -1).trim();
		}
		if (!label) return null;
		return { label, required };
	}

	/**
	 * Read the signing config out of a note's content. Returns a disabled config
	 * when the pub does not opt in or declares no valid signers.
	 */
	parseConfig(note: Pick<Note, 'content' | 'fileExtension'>): SignConfig {
		const disabled: SignConfig = { enabled: false, signers: [], order: 'sequential', fields: [] };
		const content = note.content || '';
		const isHtml = noteService.isHtmlFile(note.fileExtension || undefined);

		let enabled = false;
		let order: 'sequential' | 'parallel' = 'sequential';
		const signers: Signer[] = [];
		const fields: SignField[] = [];

		if (isHtml) {
			enabled = /<!--\s*mdpubs-sign:\s*true\s*-->/i.test(content);
			const orderMatch = content.match(/<!--\s*mdpubs-sign-order:\s*(sequential|parallel)\s*-->/i);
			if (orderMatch) order = orderMatch[1].toLowerCase() as 'sequential' | 'parallel';
			// Scan fixed (`mdpubs-signer:`) and open (`mdpubs-signer-open:`) markers in
			// a SINGLE pass so declared order is preserved (matters for sequential).
			const signerRe = /<!--\s*mdpubs-signer(-open)?:\s*(.+?)\s*-->/gi;
			let m: RegExpExecArray | null;
			while ((m = signerRe.exec(content)) !== null) {
				const isOpen = !!m[1];
				if (isOpen) {
					signers.push({ name: m[2].trim() || 'Signer', email: '', open: true });
				} else {
					const s = this.parseSigner(m[2]);
					if (s) signers.push(s);
				}
			}
			// Custom fields: <!-- mdpubs-signer-field: Title --> (trailing ? = optional)
			const fieldRe = /<!--\s*mdpubs-signer-field:\s*(.+?)\s*-->/gi;
			let fm2: RegExpExecArray | null;
			while ((fm2 = fieldRe.exec(content)) !== null) {
				const f = this.parseField(fm2[1]);
				if (f) fields.push(f);
			}
		} else {
			// Markdown: read the leading frontmatter block only.
			const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
			if (fm) {
				const block = fm[1];
				enabled = /^\s*mdpubs-sign:\s*true\s*$/im.test(block);
				const orderMatch = block.match(/^\s*mdpubs-sign-order:\s*(sequential|parallel)\s*$/im);
				if (orderMatch) order = orderMatch[1].toLowerCase() as 'sequential' | 'parallel';
				// `mdpubs-signers:` (fixed) and `mdpubs-signers-open:` (open label list).
				// The `\Z` is preserved byte-faithfully from the original signing logic
				// (in JS regex it matches a literal `Z`); do not "fix" the escape.
				// eslint-disable-next-line no-useless-escape
				const listMatch = block.match(/^\s*mdpubs-signers:\s*\r?\n([\s\S]*?)(?=^\S|\Z)/im);
				if (listMatch) {
					const items = listMatch[1].matchAll(/^\s*-\s*(.+?)\s*$/gim);
					for (const item of items) {
						const s = this.parseSigner(item[1].replace(/^["']|["']$/g, ''));
						if (s) signers.push(s);
					}
				}
				// eslint-disable-next-line no-useless-escape
				const openMatch = block.match(/^\s*mdpubs-signers-open:\s*\r?\n([\s\S]*?)(?=^\S|\Z)/im);
				if (openMatch) {
					const items = openMatch[1].matchAll(/^\s*-\s*(.+?)\s*$/gim);
					for (const item of items) {
						const label = item[1].replace(/^["']|["']$/g, '').trim();
						signers.push({ name: label || 'Signer', email: '', open: true });
					}
				}
				// Custom fields: `mdpubs-signer-fields:` list. Trailing `?` = optional.
				// eslint-disable-next-line no-useless-escape
				const fieldsMatch = block.match(/^\s*mdpubs-signer-fields:\s*\r?\n([\s\S]*?)(?=^\S|\Z)/im);
				if (fieldsMatch) {
					const items = fieldsMatch[1].matchAll(/^\s*-\s*(.+?)\s*$/gim);
					for (const item of items) {
						const f = this.parseField(item[1].replace(/^["']|["']$/g, ''));
						if (f) fields.push(f);
					}
				}
			}
		}

		if (!enabled || signers.length === 0) return disabled;
		// De-duplicate fixed signers by email, preserving declared order. Open slots
		// and name-only signers have no email yet, so they are never deduped away.
		const seen = new Set<string>();
		const unique = signers.filter((s) => {
			if (s.open || !s.email) return true;
			const key = this.normEmail(s.email);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		// De-duplicate fields by label, preserving order.
		const seenFields = new Set<string>();
		const uniqueFields = fields.filter((f) => {
			const key = f.label.toLowerCase();
			if (seenFields.has(key)) return false;
			seenFields.add(key);
			return true;
		});
		return { enabled: true, signers: unique, order, fields: uniqueFields };
	}

	/**
	 * Compute the full signing state for a note: config + who has signed + whose
	 * turn + whether the live content still matches what was signed.
	 */
	async getState(note: Note): Promise<SignState> {
		const config = this.parseConfig(note);
		if (!config.enabled) {
			return {
				enabled: false,
				order: 'sequential',
				fields: [],
				signers: [],
				complete: false,
				started: false,
				contentMatches: true
			};
		}

		const request = await database.getSignatureRequestByNoteId(note.id);
		const signatures = await database.getSignaturesByNoteId(note.id);
		// Match signatures to slots by signerIndex — works for both fixed and open
		// slots (an open slot's real name/email is only known once signed).
		const signedByIndex = new Map<number, Signature>();
		for (const s of signatures) signedByIndex.set(s.signerIndex, s);

		// Determine the next unsigned index for sequential ordering.
		const signerStates: SignStateSigner[] = config.signers.map((s, index) => {
			const sig = signedByIndex.get(index);
			return {
				...s,
				// For a signed open slot, surface the name/email the signer actually
				// entered rather than the placeholder label.
				name: sig ? sig.signerName : s.name,
				email: sig ? sig.signerEmail : s.email,
				index,
				signed: !!sig,
				signedAt: sig?.signedAt ? new Date(sig.signedAt).getTime() : null,
				isTurn: false,
				signatureImageUrl: null,
				fields: sig?.fields ?? null
			};
		});

		if (config.order === 'parallel') {
			for (const st of signerStates) st.isTurn = !st.signed;
		} else {
			const nextUnsigned = signerStates.find((st) => !st.signed);
			if (nextUnsigned) nextUnsigned.isTurn = true;
		}

		const complete = signerStates.every((st) => st.signed);
		const contentMatches = request
			? this.hashContent(this.canonicalBody(note)) === request.contentHash
			: true;

		return {
			enabled: true,
			order: config.order,
			fields: config.fields,
			signers: signerStates,
			complete,
			started: !!request,
			contentMatches
		};
	}

	/**
	 * Record a signature. Validates that the pub is signable, that the signer
	 * matches a declared entry, that it is their turn (sequential), that they have
	 * not already signed, and that the content still matches any earlier signature.
	 * Snapshots the signed content into a request on the first signature.
	 *
	 * Returns the updated SignState. Throws SignError on any validation failure.
	 */
	async sign(params: {
		bucket: R2Bucket;
		note: Note;
		name: string;
		email: string;
		signatureImagePng: ArrayBuffer;
		fieldValues?: Record<string, string>;
		ipAddress?: string;
		location?: string;
		userAgent?: string;
	}): Promise<SignState> {
		const {
			bucket,
			note,
			name,
			email,
			signatureImagePng,
			fieldValues,
			ipAddress,
			location,
			userAgent
		} = params;
		const config = this.parseConfig(note);
		if (!config.enabled) throw new SignError('This document is not open for signing.');

		const normEmail = this.normEmail(email);
		const existingSigs = await database.getSignaturesByNoteId(note.id);
		const signedIndexes = new Set(existingSigs.map((s) => s.signerIndex));

		// Resolve which slot this signer fills.
		//  - A slot with a declared email is matched by that email.
		//  - A slot WITHOUT a declared email (open slot, or a name-only fixed signer)
		//    is claimed positionally: the next unsigned emailless slot in order.
		let signerIndex = config.signers.findIndex(
			(s, i) => !!s.email && !signedIndexes.has(i) && this.normEmail(s.email) === normEmail
		);
		if (signerIndex === -1) {
			// No email match — claim the next unsigned emailless slot (open or name-only).
			signerIndex = config.signers.findIndex((s, i) => !s.email && !signedIndexes.has(i));
		}
		if (signerIndex === -1) {
			// Either this email isn't a declared signer and there's no positional slot
			// left, or the matching declared slot was already signed.
			const alreadyThisEmail =
				!!normEmail && existingSigs.some((s) => this.normEmail(s.signerEmail) === normEmail);
			if (alreadyThisEmail) throw new SignError('You have already signed this document.');
			throw new SignError('There are no signing slots left for this document.');
		}

		// Guard: a (non-empty) email may not sign two different slots of the same
		// document. Empty emails are allowed to repeat (they're positional).
		if (normEmail && existingSigs.some((s) => this.normEmail(s.signerEmail) === normEmail)) {
			throw new SignError('You have already signed this document.');
		}

		const body = this.canonicalBody(note);
		const contentHash = this.hashContent(body);

		let request = await database.getSignatureRequestByNoteId(note.id);
		if (request) {
			// Signing already started: the content must match the snapshot. Under
			// lock-on-first-signature this should always hold; guard anyway.
			if (request.contentHash !== contentHash) {
				await database.recordSignatureEvent({
					noteId: note.id,
					requestId: request.id,
					action: 'edit_blocked',
					signerEmail: normEmail,
					contentHash,
					ipAddress,
					userAgent,
					detail: 'Content hash changed after signing started.'
				});
				throw new SignError(
					'This document was changed after signing started and can no longer be signed.'
				);
			}
		} else {
			// First signature: snapshot the exact signed bytes + hash + signer list.
			request = await database.createSignatureRequest({
				noteId: note.id,
				contentHash,
				signedContent: body,
				signOrder: config.order,
				signers: config.signers
			});
			await database.recordSignatureEvent({
				noteId: note.id,
				requestId: request.id,
				action: 'request_created',
				contentHash,
				ipAddress,
				userAgent
			});
		}

		// Enforce sequential turn order by slot index.
		if (config.order === 'sequential') {
			const nextIndex = config.signers.findIndex((_, i) => !signedIndexes.has(i));
			if (signerIndex !== nextIndex) {
				const waitingFor = config.signers[nextIndex];
				throw new SignError(
					`It is not your turn yet. Waiting for ${waitingFor?.name || 'the previous signer'} to sign first.`
				);
			}
		}

		const slot = config.signers[signerIndex];
		// Name: an open slot's name is whatever the signer types; a named slot (fixed,
		// with or without email) keeps its declared name.
		const finalName = slot.open ? name.trim() : slot.name;
		if (slot.open && !name.trim()) {
			throw new SignError('Please enter your name to sign.');
		}
		// Email: use the declared email if the slot has one; otherwise whatever the
		// signer entered (may be empty — email is optional).
		const finalEmail = slot.email || email.trim();

		// Collect custom field values — only for labels declared in the config, so a
		// client can't inject arbitrary keys. Required fields must be non-empty;
		// optional fields are stored only when provided.
		const storedFields: Record<string, string> = {};
		for (const f of config.fields) {
			const val = (fieldValues?.[f.label] ?? '').trim();
			if (!val) {
				if (f.required) throw new SignError(`Please fill in the "${f.label}" field.`);
				continue;
			}
			storedFields[f.label] = val;
		}

		// Upload the drawn signature PNG to R2. The stored key is the plain public URL.
		let signatureImageKey: string | null = null;
		try {
			const upload = await uploadFile(
				bucket,
				note.userId,
				note.id,
				`signature-${normEmail.replace(/[^a-z0-9]/gi, '_')}-${signerIndex}.png`,
				signatureImagePng,
				'image/png'
			);
			if (upload.success) signatureImageKey = upload.url;
		} catch (err) {
			console.error('[SignService] Failed to upload signature image:', err);
			// Non-fatal: the signature record (name/email/hash/time) is the legal
			// substance; the drawn image is corroborating. Record without it.
		}

		await database.createSignature({
			requestId: request.id,
			noteId: note.id,
			signerName: finalName,
			signerEmail: finalEmail,
			signerIndex,
			contentHash,
			signatureImageKey,
			fields: config.fields.length ? storedFields : null,
			// Set explicitly: the column is timestamp-mode (epoch int), but the SQL
			// `current_timestamp` default writes a text datetime that Drizzle reads
			// back as null. A JS Date is stored/round-tripped correctly.
			signedAt: new Date(),
			ipAddress,
			location,
			userAgent
		});
		await database.recordSignatureEvent({
			noteId: note.id,
			requestId: request.id,
			action: 'signed',
			signerEmail: normEmail,
			contentHash,
			ipAddress,
			location,
			userAgent
		});

		const state = await this.getState(note);
		if (state.complete) {
			await database.recordSignatureEvent({
				noteId: note.id,
				requestId: request.id,
				action: 'completed',
				contentHash,
				ipAddress,
				userAgent
			});
		}
		return state;
	}

	/**
	 * The lock-on-first-signature gate. Returns true if edits to this note must be
	 * rejected because at least one signature already exists.
	 */
	async isLockedForEditing(noteId: number): Promise<boolean> {
		return await database.noteHasSignatures(noteId);
	}

	/**
	 * Fetch a note for the signing endpoints. Unlike the normal privacy gate, a
	 * PRIVATE note is reachable here IF it is signable (mdpubs-sign) — the signing
	 * link grants access, DocuSign-style. The owner always has access. A private,
	 * NON-signable note stays blocked.
	 */
	async getNoteForSigning(noteId: number, userId?: string): Promise<Note> {
		const note = await database.getNoteById(noteId);
		if (!note || note.deletedAt) throw new NotFoundError('Note not found');
		const isOwner = !!userId && note.userId === userId;
		if (!note.isPrivate || isOwner) return note;
		// Private + not owner: allow only if it's a signable pub.
		if (this.parseConfig(note).enabled) return note;
		throw new NoteNotOwnedError('Note does not belong to you or is not public');
	}

	/**
	 * Attach signature-image URLs for signed signatures onto a SignState's signers
	 * (so the UI can show the drawn marks). Current signatures store the plain public
	 * URL in `signatureImageKey`; records migrated from the pre-Cloudflare system
	 * stored a bare R2 key. Normalise both to a public URL via `publicUrl` (a no-op
	 * for values that are already absolute) so legacy rows don't render as relative
	 * URLs against the app origin (which 404s).
	 */
	async withSignatureImageUrls(note: Note, state: SignState): Promise<SignState> {
		if (!state.enabled) return state;
		const signatures = await database.getSignaturesByNoteId(note.id);
		// Key by slot index (stable for both fixed and open slots).
		const urlByIndex = new Map<number, string>();
		for (const s of signatures) {
			if (s.signatureImageKey) {
				const raw = s.signatureImageKey;
				urlByIndex.set(s.signerIndex, raw.startsWith('http') ? raw : publicUrl(raw));
			}
		}
		if (urlByIndex.size === 0) return state;

		for (const signer of state.signers) {
			const url = urlByIndex.get(signer.index);
			if (url) signer.signatureImageUrl = url;
		}
		return state;
	}
}

export class SignError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SignError';
	}
}

export const signService = new SignService();
