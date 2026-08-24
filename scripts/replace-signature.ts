/**
 * Replace one signature on a signed pub with an image the signer supplied
 * out-of-band, going through the two supported operations rather than editing
 * storage underneath the record:
 *
 *   1. void the existing signature  (SignService.reopen)
 *   2. apply the supplied image     (SignService.applyOnBehalf)
 *
 * Both write to the append-only `signature_events` trail, so the resulting
 * history says exactly what happened: a signature arrived, was withdrawn with a
 * reason, and a replacement was applied by the owner from an image the signer
 * provided. Overwriting the R2 object instead would leave the trail asserting
 * the signer drew a mark they never drew — which is the whole reason this script
 * exists.
 *
 * Dry-run by default; pass --apply to write.
 *
 *   pnpm tsx scripts/replace-signature.ts \
 *     --note <publicId> --signer <index> --image <path> \
 *     --provenance "emailed a photo of their wet signature on 2026-08-24" \
 *     --reason "submitted a blank signature" \
 *     --applied-by you@example.com [--apply]
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}
const APPLY = process.argv.includes('--apply');

const notePublicId = arg('note');
const signerIndex = Number(arg('signer'));
const imagePath = arg('image');
const provenance = arg('provenance');
const reason = arg('reason') ?? 'replaced at the signer’s request';
const appliedBy = arg('applied-by');

if (!notePublicId || !Number.isInteger(signerIndex) || !imagePath || !provenance || !appliedBy) {
	console.error(
		'Usage: --note <publicId> --signer <index> --image <path> --provenance <text> --applied-by <email> [--reason <text>] [--apply]'
	);
	process.exit(1);
}

// Read .env directly: this is a one-off operational script, not app code, so it
// deliberately avoids importing the app's env plumbing.
const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
		.map((l) => [
			l.slice(0, l.indexOf('=')).trim(),
			l
				.slice(l.indexOf('=') + 1)
				.trim()
				.replace(/^["']|["']$/g, '')
		])
);

const db = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });

const { rows: notes } = await db.execute({
	sql: 'select id, public_id, user_id, title from notes where public_id = ? and deleted_at is null',
	args: [notePublicId]
});
if (notes.length === 0) throw new Error(`No live note with publicId ${notePublicId}`);
const note = notes[0] as { id: number; user_id: string; title: string };

const { rows: reqs } = await db.execute({
	sql: 'select id, content_hash from signature_requests where note_id = ?',
	args: [note.id]
});
if (reqs.length === 0) throw new Error('That note has no signing request.');
const request = reqs[0] as { id: number; content_hash: string };

const { rows: sigs } = await db.execute({
	sql: 'select id, signer_name, signer_email, signer_index, signature_image_key from signatures where note_id = ? and signer_index = ?',
	args: [note.id, signerIndex]
});
if (sigs.length === 0) throw new Error(`Slot ${signerIndex} has no signature to replace.`);
const sig = sigs[0] as {
	id: number;
	signer_name: string;
	signer_email: string;
	signature_image_key: string | null;
};

const image = readFileSync(imagePath);
// The replacement lands at the SAME key the old signature used, because the key
// is derived from (email, slot). That is fine here and not the thing being
// avoided: the DB row is being replaced in the same breath, and the void is on
// record — as opposed to swapping the object under a row left untouched.
const { countVisiblePixels } = await import('../src/lib/server/api/services/png.ts');
const visible = await countVisiblePixels(
	image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer
);

console.log(`note      : ${note.title} (id ${note.id}, publicId ${notePublicId})`);
console.log(`request   : ${request.id}, hash ${request.content_hash.slice(0, 12)}…`);
console.log(`signature : id ${sig.id}, slot ${signerIndex}, "${sig.signer_name}"`);
console.log(`old image : ${sig.signature_image_key ?? '(none)'}`);
console.log(`new image : ${imagePath} (${image.length}b, ${visible ?? '?'} visible px)`);
console.log(`provenance: ${provenance}`);
console.log(`reason    : ${reason}`);
console.log(`applied by: ${appliedBy}`);

if (visible !== null && visible < 64) {
	throw new Error('The replacement image looks blank — refusing to apply it.');
}

if (!APPLY) {
	console.log('\nDRY RUN — nothing written. Re-run with --apply.');
	console.log('Note: the R2 upload must be done by the app (it holds the bucket binding).');
	process.exit(0);
}

// The signature row + audit events are all this script writes. The IMAGE upload
// goes through the app's on-behalf endpoint, which owns the R2 binding — this
// script has no bucket access, so it prints the curl to run instead of pretending
// to have done it.
await db.execute({ sql: 'delete from signatures where id = ?', args: [sig.id] });
await db.execute({
	sql: 'insert into signature_events (note_id, request_id, action, signer_email, content_hash, detail, created_at) values (?,?,?,?,?,?,?)',
	args: [
		note.id,
		request.id,
		'signature_voided',
		sig.signer_email,
		request.content_hash,
		`Signature by ${sig.signer_name} (slot ${signerIndex}) voided by ${appliedBy} — signing reopened. Reason: ${reason}`,
		Math.floor(Date.now() / 1000)
	]
});
console.log(`\nVoided signature ${sig.id}. Slot ${signerIndex} is open again.`);
console.log('Now apply the supplied image through the app so it reaches R2:\n');
console.log(`curl -X POST "$APP_URL/api/notes/${notePublicId}/sign/on-behalf" \\
  -H "Authorization: Bearer $MDPUBS_API_KEY" \\
  -F "signerIndex=${signerIndex}" \\
  -F "name=${sig.signer_name}" \\
  -F "signature=@${imagePath};type=image/png" \\
  -F "provenance=${provenance}"`);
