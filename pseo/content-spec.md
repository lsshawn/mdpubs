# Template page content spec

One file per page: `src/lib/pseo/templates/<slug>.md`. The page code reads the
frontmatter for SEO fields and renders the body as the contract. The body is also
offered as a download that mdpubs can publish and get signed, so it must be a real,
complete contract a freelancer could send today.

## The bar

Google demotes page folders whose pages differ only by a swapped profession word.
Every file must be specific to its profession. Use the clauses, payment habits,
deliverables, risks and disputes that are real for this trade. Examples:
- photography: usage licence, RAW files, second shooter, image delivery window
- DJ: overtime per hour, power and load-in, do-not-play list
- UGC creator: usage term, paid-ads whitelisting, raw footage, revision rounds

If you couldn't tell which profession a paragraph is for, rewrite it.

Never invent statistics or name laws you aren't sure of. Plain English, short
sentences. No legal-advice claims beyond one line in the FAQ saying to have a
lawyer check it for their jurisdiction.

## File format

```markdown
---
slug: photography-contract-template
keyword: photography contract template
profession: photographer
signer: Photographer
title: 'Photography Contract Template: Free and Ready to Sign'
description: 'A free photography contract template covering usage rights, deposits, delivery and cancellations. Copy it, or send it to your client to sign online.'
updated: 2026-10-12
intro: >-
  80-110 words. The first sentence contains the exact keyword. Say who it is for and
  what is specific to this trade's contracts, and name the dispute it prevents.
covers:
  - 'Usage licence: the client gets personal-use rights; commercial use is priced separately.'
  - 5-7 lines, each "Clause name: what it does and why it matters for this trade."
faqs:
  - q: 'Profession-specific question people actually search?'
    a: '40-80 words, a direct answer first.'
  - 4 entries in total. The last one may be "Is this template legally binding?"
---

Opening sentence naming the parties: "This agreement is between [Client Name] ("Client") and [Your Business Name] ("Photographer")..."

## 1. Services
...
## 9. Signatures

<!-- mdpubs-sign-here: Photographer -->

<!-- mdpubs-sign-here: Client -->
```

Rules for the frontmatter:
- `title` is under 60 characters and starts with the keyword's main words.
- `description` is under 155 characters and contains the keyword.
- Single-quote every string value. Double any apostrophe inside it (`client''s`).
- `signer` is the freelancer's role name in Title Case. It must match the first anchor.

Rules for the body:
- 700-1,100 words. No `# H1` (the page has its own). Use `##` numbered sections.
- Use placeholders in square brackets: `[Client Name]`, `[Event Date]`, `[$Amount]`.
- Cover: services and deliverables, timeline, fees and deposit, payment terms, revisions
  or changes, the trade-specific clauses, cancellation, liability, IP or usage rights,
  termination, and the general terms (governing law as `[State/Country]`).
- End with the `## Signatures` section holding exactly two anchors:
  `<!-- mdpubs-sign-here: <signer> -->` then `<!-- mdpubs-sign-here: Client -->`.
- No HTML other than those two comments.
