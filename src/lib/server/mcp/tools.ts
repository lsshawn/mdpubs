/**
 * The tools /mcp exposes to Claude and ChatGPT. Each one runs as the user the
 * access token belongs to, through the same services as the notes API.
 */
import { env } from 'cloudflare:workers';
import type { User } from '#lib/server/db/schema.js';
import { database, NoteLimitReachedError, NoteLockedError } from '#lib/server/api/db.js';
import { resolveNoteId } from '#lib/server/api/http.js';
import {
	InvalidAccountError,
	InvalidFrontmatterError,
	NoteService
} from '#lib/server/api/services/note.js';
import { signService } from '#lib/server/api/services/sign.js';
import { noteUrl } from '#lib/server/tokens.js';

const noteService = new NoteService();

/** How to write a signable document. Sent as the server's instructions and in the publish tool. */
export const WRITING_GUIDE = `mdpubs publishes markdown as a web page a client signs on their phone: they open the link, tap the signature box and sign with a thumb. No account, no app.

Write the document as markdown with YAML frontmatter:

---
title: Website redesign for Acme Co
mdpubs-signers:
  - Sam Rivera
mdpubs-signers-open:
  - Acme Co
mdpubs-sign-order: parallel
mdpubs-sign: true
---

Acme Co engages Rivera Studio to redesign its website.

## Scope
...

## Sign-off

**For Rivera Studio**

<!-- mdpubs-sign-here: Sam Rivera -->

**For Acme Co**

<!-- mdpubs-sign-here: Acme Co -->

Rules:
- title lives in the frontmatter. Don't repeat it as a # H1; use ## for sections.
- mdpubs-sign: true makes it signable.
- mdpubs-signers: people whose name is fixed, usually the user. mdpubs-signers-open: slots where whoever signs types their own name and email, usually the client. Ask the user for names if you don't have them.
- One <!-- mdpubs-sign-here: NAME --> where each signature goes. NAME must exactly match an entry in one of the two signer lists.
- mdpubs-sign-order: parallel lets signers sign in any order; without it they sign top to bottom.
- Optional mdpubs-signer-fields: entries like "Title?" collect extra fields at signing ("?" = optional). Name, email and date are always collected.
- Optional mdpubs-is-private: true hides it from the user's public profile; anyone with the link can still open and sign it.
- Quote frontmatter values that contain ": ".
- End the frontmatter with a one-line key such as mdpubs-sign: true, never with a list. A list that is the last key is ignored.
- Write for a phone: short paragraphs, small tables.
- Once anyone signs, the document locks and can't be edited. Get the wording right before the user sends the link.`;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

const idParam = {
	type: 'string',
	description: 'The document id returned by publish_document or list_documents.'
};

export const tools = [
	{
		name: 'publish_document',
		title: 'Publish a signable document',
		description: `Publish a proposal, contract or agreement and get the link the client signs. Pass id to update a document you published before instead of creating a new one.\n\n${WRITING_GUIDE}`,
		inputSchema: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Document title, same as the frontmatter title.' },
				markdown: {
					type: 'string',
					description: 'The whole document: frontmatter, body and sign-here anchors.'
				},
				id: { ...idParam, description: 'Only when updating an existing document.' }
			},
			required: ['title', 'markdown']
		},
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
	},
	{
		name: 'get_document',
		title: 'Read a document',
		description: 'Get the markdown of a document you published, to edit and republish it.',
		inputSchema: { type: 'object', properties: { id: idParam }, required: ['id'] },
		annotations: { readOnlyHint: true }
	},
	{
		name: 'list_documents',
		title: 'List documents',
		description: "The user's 20 most recently updated documents, with ids and links.",
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true }
	},
	{
		name: 'signing_status',
		title: 'Check signatures',
		description: 'Who has signed a document, who has not, and whether it is complete.',
		inputSchema: { type: 'object', properties: { id: idParam }, required: ['id'] },
		annotations: { readOnlyHint: true }
	}
];

/** One of the user's own documents, or null. */
async function ownNote(user: User, id: unknown) {
	if (typeof id !== 'string' || !id) return null;
	const noteId = await resolveNoteId(id);
	if (noteId === null) return null;
	const note = await database.getNoteById(noteId);
	return note && !note.deletedAt && note.userId === user.id ? note : null;
}

export async function callTool(
	user: User,
	name: string,
	args: Record<string, unknown>,
	origin: string
): Promise<ToolResult> {
	try {
		switch (name) {
			case 'publish_document': {
				const title = typeof args.title === 'string' ? args.title.trim() : '';
				const markdown = typeof args.markdown === 'string' ? args.markdown : '';
				if (!title || !markdown) return fail('title and markdown are required.');

				let note;
				if (args.id) {
					const existing = await ownNote(user, args.id);
					if (!existing) return fail(`No document with id ${String(args.id)} in this account.`);
					note = await noteService.updateNote(
						env.BUCKET,
						existing.id,
						user.id,
						{ title, content: markdown },
						user.defaultOrgId
					);
				} else {
					note = await noteService.createNote(
						env.BUCKET,
						user.id,
						user.plan || 'free',
						{ title, content: markdown, file_extension: 'md' },
						user.defaultOrgId
					);
				}
				const url = await noteUrl(note, origin);
				return ok(
					`Published: ${url}\nid: ${note.publicId}\n\nGive the user this link to send to their client. To change the document later, call publish_document again with id ${note.publicId}.`
				);
			}

			case 'get_document': {
				const note = await ownNote(user, args.id);
				if (!note) return fail(`No document with id ${String(args.id)} in this account.`);
				return ok(
					`Link: ${await noteUrl(note, origin)}\nid: ${note.publicId}\n\n${note.content ?? ''}`
				);
			}

			case 'list_documents': {
				const notes = (await noteService.getNotesByUserId(user.id)).slice(0, 20);
				if (notes.length === 0) return ok('No documents yet.');
				const lines = await Promise.all(
					notes.map(async (n) => `- ${n.title} (id ${n.publicId}): ${await noteUrl(n, origin)}`)
				);
				return ok(lines.join('\n'));
			}

			case 'signing_status': {
				const note = await ownNote(user, args.id);
				if (!note) return fail(`No document with id ${String(args.id)} in this account.`);
				const state = await signService.getState(note);
				if (!state.enabled) {
					return ok('This document is not signable. Add mdpubs-sign: true and signers.');
				}
				const lines = state.signers.map((s) =>
					s.signed
						? `- ${s.label}: signed by ${s.name} on ${new Date(s.signedAt ?? 0).toISOString().slice(0, 10)}`
						: `- ${s.label}: not signed yet`
				);
				return ok(
					`${state.complete ? 'Fully signed.' : 'Waiting for signatures.'}\n${lines.join('\n')}`
				);
			}

			default:
				return fail(`Unknown tool: ${name}`);
		}
	} catch (e) {
		if (e instanceof NoteLockedError) return fail(e.message);
		if (e instanceof InvalidFrontmatterError) return fail(e.message);
		if (e instanceof InvalidAccountError) return fail(e.message);
		if (e instanceof NoteLimitReachedError) return fail('Note limit reached on this plan.');
		console.error(`MCP tool ${name} failed:`, e);
		return fail('Something went wrong on mdpubs. Try again in a minute.');
	}
}
