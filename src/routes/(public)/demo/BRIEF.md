# /demo brief (self-authored)

A scroll-demo variation of the homepage. Same claims and copy as `/`, told by
the product acting itself out instead of a static hero.

- **What, for whom, the one belief.** mdpubs turns a prompt to your AI into a
  contract your client signs on their phone. For freelancers and small studios
  who send proposals. The visitor should leave believing: one prompt, one link,
  one thumb, and it costs $20 a month flat.
- **The old way.** "E-sign tools charge per envelope, per seat, per year." The
  turn: "mdpubs is $20 a month. Flat."
- **Verbs.** Type the prompt. Click the link. Sign with a thumb. Try to edit a
  signed doc and find it locked.
- **Peak.** Signing with a thumb. Longest budget (4000px), the only 3D move
  (the phone leans toward the viewer while it is signed).
- **UI.** Rebuilt from `SignPlayground.svelte` (the phone proposal and signing
  drawer) and a generic AI chat window.
- **Accent.** The app's DaisyUI primary, `oklch(45% 0.24 277)`. CTA label:
  "Start for $20/mo".

| Act    | Verb / interaction            | Feeling                   |
| ------ | ----------------------------- | ------------------------- |
| hero   | rise: chat window arrives     | "oh, this is about my AI" |
| prompt | type: the prompt types itself | "that's all I'd write"    |
| open   | click: the link opens a phone | "the client gets a page"  |
| sign   | draw: thumb signs (peak)      | "that's it?"              |
| locked | select: edit attempt refused  | "it's safe"               |
| more   | split + swing: the rest       | "and it's all one price"  |
| start  | blur-in close                 | "$20, cancel anytime"     |

It's the site where you watch a contract go from one prompt to a thumb
signature.
