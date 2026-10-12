# pSEO plan: mdpubs.com

Planned 2026-10-13 with the `pseo` skill. company-os tracks it as `seo_site` mdpubs.com
(`pseo.py status mdpubs.com`).

## Pattern

**`<profession> contract template`** at `/templates/<profession>-contract-template`.
The hub is `/templates`. The head term is "contract template".

Why this pattern won:
- **The asset is the product's output.** Every page is a contract, and mdpubs exists
  to get contracts signed. The download is an mdpubs-signable file, so the page demos
  the product.
- **Demand is broad.** 168 of 220 profession × {contract, proposal} template
  combinations show up in Google autocomplete, most with a "free" variant.
- **Competitors prove it.** Bonsai runs `/contract-template/<profession>` with 60+
  pages, and PandaDoc, Agiled, Jotform and Paperform hold page one.
- **Page one is beatable.** It's mid-authority tool vendors and some scraped spam.
  Few results have a full, trade-specific contract body.

Why the others lost:
- `<profession> proposal template` has the same demand. It becomes the second folder
  once this one is indexed, because a proposal is a different document, not a
  reworded contract.
- `docusign/pandadoc alternative` has high intent but only about 5 pages, so it's
  hand-written comparison pages, not pSEO.
- `<tool> e-signature` and "send a contract from ChatGPT" have too little
  autocomplete volume today.
- `freelance contract template <country>` is only worth doing where local law
  changes the text. Revisit for MY/SG once the folder ranks.

## What makes each page unique

The contract body is written for the trade: its clauses, payment habits and
disputes (usage licence, overtime, whitelisting, vendor contracts). The intro,
"covers" list and FAQs are trade-specific too. Shared boilerplate is the CTA, the
how-to-use steps and the disclaimer.

Format: `pseo/content-spec.md`. Similarity gate: `node scripts/pseo-similarity.mjs`
(word 5-gram Jaccard against every sibling; above 0.5 fails).

## CTA

"Send it for signature" goes to checkout, tracked with Umami event `pseo-cta` and a
`slug` property. The page also offers copy and download of the signable .md file.

## 30-day targets (day 0 = the deploy of this PR)

| By day | Target |
|---|---|
| 7 | Sitemap submitted in Search Console; every /templates URL is 200 with a canonical |
| 14 | 50% of /templates pages indexed, first impressions |
| 30 | 80% indexed, 500+ impressions, 5+ queries in the top 30, first clicks, 1+ `pseo-cta` |

Cadence: 10 launch pages, then 10 per week from `pseo/backlog.csv`, gated by the
indexed ratio (see the skill's review mode).
