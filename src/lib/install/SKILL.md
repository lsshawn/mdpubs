---
name: mdpubs
description: Publish a proposal, contract, quote or agreement as a web page the client signs on their phone. Use when the user asks to make a document signable, send something to sign, get a signature, or publish with mdpubs, and to check who has signed.
---

# mdpubs: documents your client signs on a phone

You write the document as markdown, publish it with the `mdpubs` CLI, and give
the user the link to send. The client opens the link, taps the signature box and
signs with a thumb. No account, no app.

## 1. Write the document

Save it as a `.md` file in the current directory, e.g. `acme-proposal.md`.

```markdown
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

## Price

| Item   | Amount |
| ------ | ------ |
| Design | $4,200 |
| Build  | $6,800 |

## Sign-off

**For Rivera Studio**

<!-- mdpubs-sign-here: Sam Rivera -->

**For Acme Co**

<!-- mdpubs-sign-here: Acme Co -->
```

Rules:

- `title:` lives in the frontmatter. Do not repeat it as a `# H1` in the body;
  use `##` for sections.
- `mdpubs-sign: true` makes it signable.
- `mdpubs-signers:` are people whose name is known and fixed, usually the user.
  `mdpubs-signers-open:` are slots where whoever signs types their own name and
  email, usually the client. Ask the user for names if you don't have them.
- Put one `<!-- mdpubs-sign-here: NAME -->` where each signature goes. `NAME`
  must match an entry in one of the two signer lists exactly.
- `mdpubs-sign-order: parallel` lets signers sign in any order. Leave it out
  and they must sign top to bottom.
- Optional: `mdpubs-signer-fields:` with entries like `Title?` collects extra
  fields at signing (`?` = optional). Name, email and date are always collected.
- Optional: `mdpubs-is-private: true` hides it from the user's public profile.
  Anyone with the link can still open and sign it.
- Quote any frontmatter value that contains `: `.
- End the frontmatter with a one-line key such as `mdpubs-sign: true`, never
  with a list. A list that is the last key is ignored.
- Write for a phone: short paragraphs, small tables.

## 2. Publish

```sh
mdpubs publish acme-proposal.md
```

It prints `Published: <link>`. Give the user that link to send to the client.

The first publish adds an `mdpubs: <id>` line to the frontmatter. Keep it: the
next `mdpubs publish` of the same file updates that document instead of making
a new one. Never invent or change that id.

Once anyone signs, the document locks and edits are rejected. Get the wording
right before the user sends the link.

If `mdpubs` is not on the PATH, it is at `~/.local/bin/mdpubs`.

## 3. Check signatures

```sh
mdpubs status acme-proposal.md
```

Prints JSON with each signer's `signed` and `signedAt`, and `complete` once
everyone has signed.

## Errors

- "not logged in" or "revoked": run `mdpubs login`, show the user the link it
  prints, wait for them to say they clicked Allow, then run `mdpubs login`
  again.
- "subscription is not active": tell the user to renew at
  **ORIGIN**/account.

Never read, print or copy anything in `~/.config/mdpubs`. It holds the user's
access token.
