/**
 * Seed data shared by the e2e database setup (setup-db.ts) and the specs.
 * Everything here is synthetic.
 */
export const PORT = 5198;
export const BASE_URL = `http://localhost:${PORT}`;
export const DB_FILE = new URL('./.tmp/e2e.db', import.meta.url).pathname;
export const DB_URL = `file:${DB_FILE}`;

export const OWNER = {
	id: 'e2e-owner',
	email: 'owner@example.test',
	name: 'Dana Owner',
	session: 'e2e-owner-session'
};
export const MEMBER = {
	id: 'e2e-member',
	email: 'member@example.test',
	name: 'Riley Member',
	session: 'e2e-member-session'
};

const body = `
<!-- toc -->
- [Scope of work](#scope-of-work)
- [Timeline](#timeline)
<!-- toc -->

## Scope of work

We will build the onboarding flow and the billing page in the first month. The team ships weekly and you see every build on a preview link before it goes live.

Payment is due within fourteen days of each invoice being issued. Late invoices pause the work until they are settled.

Read the [full terms](https://example.test/terms) before you sign.

![Architecture diagram](/favicon.png)

- Design review with your team
- Build phase
  - Onboarding flow
  - Billing page
- Handover and training

| Phase | Hours | Price |
| --- | --- | --- |
| Design | 40 | $4,000 |
| Build | 120 | $12,000 |
| Handover | 10 | $1,000 |

<video controls width="320" height="180" src="/missing-e2e-video.mp4"></video>

\`\`\`js
const total = phases.reduce((sum, p) => sum + p.price, 0);
console.log(total);
\`\`\`

> Either party may end this agreement with thirty days of written notice.

$$
E = mc^2
$$

<details>
<summary>Fine print</summary>

Prices exclude tax and are quoted in US dollars.

</details>

## Timeline

Work starts on the first Monday after the deposit clears. We expect the whole project to take about ten weeks from start to handover.
`;

/** A page with the author's own HTML in it: a row of figures, then a picture. */
const report = `
## Annual report

Revenue grew in every quarter of the year. The fourth quarter was the strongest on record, and renewals held up through the summer.

<div class="report" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin:16px 0">
<div class="stat" style="padding:16px;border:1px solid #999"><b>$4.2M</b> <span>Revenue</span></div>
<div class="stat" style="padding:16px;border:1px solid #999"><b>1,280</b> <span>Customers</span></div>
<div class="stat" style="padding:16px;border:1px solid #999"><b>97%</b> <span>Renewals</span></div>
</div>

![Revenue chart](/favicon.png)

The board approved the plan for next year at its December meeting.
`;

const page = (frontmatter: string) => `---\ntitle: Proposal\n${frontmatter}---\n${body}`;

/** publicId → the note. Each spec area gets its own note so tests don't share comments. */
export const NOTES: Record<string, { content: string; isPrivate?: boolean }> = {
	'e2e-public': { content: page('mdpubs-comments: public\n') },
	'e2e-elements': { content: page('mdpubs-comments: public\n') },
	'e2e-edit': { content: page('mdpubs-comments: public\n') },
	'e2e-owner': { content: page('mdpubs-comments: public\n') },
	'e2e-mobile': { content: page('mdpubs-comments: public\n') },
	'e2e-users': { content: page('mdpubs-comments: true\n') },
	'e2e-email': { content: page('mdpubs-comments: public\nmdpubs-comments-email: required\n') },
	'e2e-noemail': { content: page('mdpubs-comments: public\nmdpubs-comments-email: off\n') },
	'e2e-off': { content: page('') },
	'e2e-history': { content: page('mdpubs-comments: public\nmdpubs-history: public\n') },
	'e2e-history-only': { content: page('mdpubs-history: public\n') },
	'e2e-report': {
		content: `---\ntitle: Annual report\nmdpubs-comments: public\n---\n${report}`
	},
	// Private, and no comments key: only an embed token opens it and turns comments on.
	'e2e-embed': { content: page(''), isPrivate: true },
	'e2e-private': { content: page('mdpubs-comments: public\n'), isPrivate: true }
};
