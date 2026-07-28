---
name: mdpubs
description: Add mdpubs e-signing frontmatter and inline sign-here anchors to a markdown proposal or agreement so it can be published and signed online. Use when a user wants to make a .md document e-signable, add signers, or wire up signature slots.
---

# mdpubs E-Signing

Turn a plain markdown proposal or agreement into an mdpubs e-signable document: add the signing frontmatter and drop `<!-- mdpubs-sign-here: NAME -->` anchors where each signature belongs.

Canonical reference (a fully wired document to copy the pattern from):
`/mnt/storage/projects/note/clients/kw-loh/20260717-kwloh-ai-assistant-proposal.md`

## How it works

mdpubs reads YAML frontmatter to decide who signs, and reads inline HTML comments in the body to decide where each signature is placed. Two moving parts:

1. **Frontmatter keys** declare the document is signable and list the signers.
2. **`<!-- mdpubs-sign-here: NAME -->` comments** in the body mark the exact spot each signer's block renders. The `NAME` must match a name listed under `mdpubs-signers` or `mdpubs-signers-open`.

Signatures are stored against the document, never written into its content — that is why placement uses an anchor. On the **first** signature the document locks: later edits that change the signed body are rejected with a `409`. Get the wording right before you send the link.

(For `.html` documents the same features exist as comment markers — `<!-- mdpubs-sign: true -->`, `<!-- mdpubs-signer: Name <email> -->`, `<!-- mdpubs-signer-open: Label -->`, `<!-- mdpubs-signer-field: Title? -->`, `<!-- mdpubs-sign-order: parallel -->`. This skill covers the markdown path; `mdpubs help` documents both.)

## Frontmatter keys

Add these to the existing YAML frontmatter (keep the document's own `title`, `date`, `tags`):

```yaml
# --- mdpubs e-signing ---
mdpubs-is-private: false        # false = anyone with the link can view; true = restricted
mdpubs-sign: true               # enable signature collection
mdpubs: <short-id>              # OMIT on first publish — mdpubs assigns the doc id. Keep it verbatim once set.
mdpubs-signers:                 # NAMED signers (identity fixed; usually your side)
  - Full Name
mdpubs-signers-open:            # OPEN slots (whoever the counterparty authorises signs & types their own name/email)
  - Counterparty Legal Name
mdpubs-signer-fields:           # extra fields collected at signing. "?" suffix = optional
  - Title?
mdpubs-sign-order: parallel     # parallel = either can sign first; sequential = top-to-bottom order
```

Notes:
- **Named vs open.** A named signer is a specific person on your side (e.g. you, the vendor). An open slot is "whoever the client authorises" — they enter their own name and email at signing time. In the KW Loh reference, "Lim Shi Shyang" is named and "KW Loh & Associates / KW Loh Taxation Sdn Bhd" is an open slot.
- **Named signer forms.** Three are accepted: `Full Name` (name locked, signer supplies their own email), `Full Name <a@b.com>` (email pre-filled), or a bare `a@b.com` (email used as the name too). Prefer the bare-name form unless you're certain of the address — slots are matched by position, not email, so a wrong address just creates friction.
- **`mdpubs: <id>`** — do NOT invent this. Leave it out on the first publish; mdpubs mints the id and it gets written back. On any later edit, preserve the existing value exactly, or you fork the document and lose collected signatures.
- **`mdpubs-signer-fields`** — `Title?` collects an optional job title. Drop the `?` to make a field required. Name, email, and signed date are always captured — never declare those as fields.
- **`mdpubs-sign-order`** — **the server default is `sequential`** when the key is absent, which blocks the second party until the first has signed. For a proposal both parties can sign independently, set `parallel` explicitly rather than omitting the key.
- **Private + signable.** `mdpubs-is-private: true` still lets a signer open the document via its link — the signing flow needs it reachable. Privacy hides it from your public profile listing; it is not an access wall against someone holding the URL.

## Body anchors

For each signer, place one anchor where the signature should render. Put a short human-readable heading above it so the printed/unsigned version still reads correctly:

```markdown
**For <Your Company>**
<company reg no. / address, optional>

<Named Signer>
<Their title>

<!-- mdpubs-sign-here: Named Signer -->


**For <Counterparty>** _(signed by an authorised signatory)_
<their reg no. / address, optional>

<!-- mdpubs-sign-here: Counterparty Legal Name -->
```

Rules:
- The `NAME` in the comment must exactly match a frontmatter signer entry (named or open).
- One anchor per signer. Every listed signer needs an anchor, and every anchor needs a listed signer.
- Do NOT leave manual `Name: _____ / Signature: _____` underscore lines next to an anchor — mdpubs renders the signature block, so the underscores are redundant. Remove them.
- Keep the entity details (registered name, company number, address) as plain text above the anchor; mdpubs only supplies the signature, name, email, and any signer-fields.

## Raw HTML inside a markdown document

A `.md` pub is rendered with `marked` and **no sanitizer**, so raw HTML written in the body reaches the page as live markup. Use it when markdown can't express the layout — bordered callouts, side-by-side signature columns, a table with merged cells, inline colour.

```markdown
Ordinary markdown paragraph.

<div style="border:1px solid #ccc; padding:1rem">
  <strong>Boxed callout</strong>
  second line
</div>

Inline <span style="color:red">emphasis</span> works mid-sentence too.
```

Rules that actually bite (verified against the renderer):

- **Blank-line-separate block HTML.** A `<div>`/`<table>` block set off by blank lines passes through verbatim — no wrapping `<p>`, no injected `<br>`. Without a blank line before it the preceding text just closes as its own paragraph, which is usually fine.
- **`breaks: true` is on, and it only affects inline HTML.** A `<span>` that spans two source lines *inside a paragraph* gets a `<br>` inserted at the newline. Keep inline HTML on one line. Block-level HTML is unaffected.
- **Never indent block HTML 4+ spaces.** That makes it a markdown code block, so it renders as escaped text instead of markup.
- **Markdown does not process inside a tight HTML block.** `**bold**` on a line directly inside `<div>...</div>` stays literal asterisks. Put a blank line after the opening tag (and before the closing one) if you need markdown to run inside — then it does.
- **To *show* HTML rather than run it**, put it in a fenced block or backticks. Entity decoding deliberately skips `<pre>` and `<code>`, so escaped markup stays visible there; outside them it would decode into live tags and the text would vanish.
- **Signed documents lock.** HTML edits change the signed body like any other edit, so a change after the first signature is rejected with `409`. Settle layout before sending the link.

This is the markdown path. A whole-file `.html` pub (`file_extension: html`) is different — it is served verbatim in a sandboxed iframe and uses the comment markers from the note above, not frontmatter.

## Steps

1. Read the target document and confirm the two parties and which side is named vs open (your side is usually named; the client/counterparty is usually an open slot).
2. Merge the mdpubs frontmatter keys into the existing frontmatter. Omit `mdpubs:` on first publish; preserve it if already present.
3. In the Acceptance / signature section, replace any manual signature lines with a short heading per party plus one `<!-- mdpubs-sign-here: NAME -->` anchor each, names matching the frontmatter exactly.
4. Sanity-check: every signer in frontmatter has exactly one matching anchor, and vice versa.

## Publishing

The frontmatter and anchors are the whole contract — the server parses them out of the document content. Any way of getting the file to mdpubs works.

**With the CLI** (easiest; stamps the returned id back into the file automatically):

```bash
mdpubs publish doc.md          # prints the URL, signers, order, fields
mdpubs publish doc.md --json   # deterministic output for agents
```

It also warns when a signer has no matching anchor, or an anchor matches no signer.

**Without the CLI.** mdpubs is a plain REST API keyed on `X-API-Key`, so curl or any HTTP client is enough:

```bash
# create — returns JSON including the publicId
curl -X POST https://mdpubs.com/api/notes \
  -H "X-API-Key: $MDPUBS_API_KEY" \
  -F title="Proposal" -F file_extension=md \
  -F content="$(cat doc.md)"

# update an existing pub (id = the `mdpubs:` value in the frontmatter)
curl -X PUT https://mdpubs.com/api/notes/<id> \
  -H "X-API-Key: $MDPUBS_API_KEY" \
  -F title="Proposal" -F file_extension=md -F content="$(cat doc.md)"
```

JSON bodies work too. Signing is unaffected by how you publish — the server reads the config from `content`. The one thing you lose is the automatic id stamp: after a create, copy the returned `publicId` into the document's `mdpubs:` key yourself, or the next publish creates a duplicate instead of updating.

## Gotchas

- Names are the join key. A typo between frontmatter and an anchor breaks that signer's slot silently — the box just falls back to the floating panel. `mdpubs publish` warns about both mismatch directions; check its output.
- **Omitting `mdpubs-sign-order` gives you `sequential`, not `parallel`.** For a two-party proposal that usually isn't what you want: the counterparty's Sign button stays disabled until your side signs. Write `parallel` explicitly.
- If the user is re-publishing an already-signed document, never regenerate or clear the `mdpubs:` id.
