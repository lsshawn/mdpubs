<script lang="ts">
	/**
	 * The landing page, acted out as a scroll demo: a chat window types the
	 * prompt, the link opens a phone, a thumb signs it, and the signed doc refuses
	 * an edit.
	 *
	 * The markup lives here. The choreography is plain JS in
	 * static/scrolldemo/mdpubs-demo.js, next to the scroll engine it drives
	 * (scrolldemo.js, copied verbatim from the scroll-demo skill). Both are loaded
	 * on mount so the engine, which touches `window` at import, never runs on the
	 * server, and its global stylesheet is only on the page while this route is.
	 */
	import { onMount } from 'svelte';
	import FeedbackWidget from '#lib/components/FeedbackWidget.svelte';
	import { config } from '#lib/config.js';
	import { checkoutHref } from '#lib/helpers/checkout.js';

	// Every CTA on this page goes straight to Stripe monthly checkout, in the same
	// window, rather than via /login. Falls back to /login if the link is unset.
	const signupHref = checkoutHref(config.stripePaymentLinks.monthly.link);

	const FONTS_URL =
		'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
	const FONTS = `<link rel="stylesheet" href="${FONTS_URL}" media="print" onload="this.media='all'" /><noscript><link rel="stylesheet" href="${FONTS_URL}" /></noscript>`;

	const PROMPT = 'Publish this proposal to mdpubs for Shawn and Matt to sign.';

	const terms = [
		['Total', '$11,000'],
		['Timeline', '6 weeks'],
		['Payment', '50% now, 50% at launch']
	];
	const included = [
		'4-page site: Home, About, Services, Contact',
		'A blog your team can edit',
		'Built for phones first'
	];
	const today = new Date().toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	// One scribble, drawn in the signing pad and then shown on the signed doc.
	const SIG =
		'M18 72 C 26 30, 44 14, 42 52 C 40 84, 16 88, 22 70 C 34 46, 54 52, 60 62 C 66 72, 72 50, 80 55 C 86 60, 84 72, 93 63 C 101 54, 104 40, 110 58 C 114 72, 121 70, 127 56 C 131 45, 137 70, 147 60 C 157 48, 161 28, 168 18 C 160 50, 157 72, 171 70 C 183 68, 186 52, 196 58 C 204 64, 200 73, 212 64 C 222 56, 226 54, 233 62 C 240 70, 252 66, 282 48';

	const log = [
		['Sent', 'Cupbots', '9:02 AM'],
		['Signed', 'Shawn', '9:05 AM'],
		['Opened', 'Matt', '9:40 AM'],
		['Signed', 'Matt', '9:41 AM'],
		['Locked', 'No more edits', '9:41 AM']
	];

	// [text, accent?] runs. Each card carries one feature, its key phrase in accent.
	const cards: [string, boolean][][] = [
		[
			['$20 a month.', true],
			[' Send as many contracts as you like.', false]
		],
		[
			['Parallel signers,', true],
			[' each with their own box.', false]
		],
		[
			['No sign-in', true],
			[' needed to sign.', false]
		],
		[
			['Works from ', false],
			['Claude Code, Codex, Claude and ChatGPT.', true]
		]
	];

	// Only the first step differs between the two ways in. Both then log in at
	// the same page, which sends new users through checkout.
	const setupPaths = [
		{
			name: 'Claude Code · Codex',
			first: 'Paste this into Claude Code or Codex:',
			paste: 'curl -fsSL https://mdpubs.com/install | sh'
		},
		{
			name: 'Claude · ChatGPT',
			first: 'Add a connector with this URL:',
			paste: 'https://mdpubs.com/mcp'
		}
	];
	let tab = $state(0);

	let root: HTMLDivElement;

	// The footer's feedback button. The layout hides its floating one on this page.
	let feedbackMessage = $state('');
	let feedbackEmail = $state('');
	let feedbackName = $state('');

	onMount(() => {
		let alive = true;
		// Built from location at runtime so the bundler cannot fold it into a
		// static import and try to bundle a file that only exists in static/.
		const src = new URL('/scrolldemo/mdpubs-demo.js', location.origin).href;
		import(/* @vite-ignore */ src).then((m) => {
			if (alive) m.default(root);
		});
		return () => {
			alive = false;
		};
	});
</script>

<svelte:head>
	<title>MdPubs — write one prompt, get a signed contract back</title>
	<meta
		name="description"
		content="$20 a month, flat. Your AI publishes the contract, your client signs it on their phone. No account, no app, no printer."
	/>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<!-- Loaded as print media and switched on load, so the font CSS never blocks first paint -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html FONTS}
	<link rel="stylesheet" href="/scrolldemo/scrolldemo.css" />
	<noscript>
		<style>
			.sdp .sd-scene {
				height: auto !important;
			}
			.sdp .sd-stage {
				position: static;
				height: auto;
				min-height: 100svh;
				display: flex;
				flex-direction: column;
				gap: 32px;
				padding: 48px 16px;
			}
			.sdp .captions,
			.sdp .log {
				display: grid;
				gap: 16px;
				position: static;
			}
			.sdp .captions > * {
				grid-area: auto;
			}
			.sdp .sd-cursor,
			.sdp .sd-caret,
			.sdp .hide-nojs {
				display: none !important;
			}
			.sdp .caption,
			.sdp .bubble,
			.sdp .reply,
			.sdp .linkcard,
			.sdp .log,
			.sdp .log li,
			.sdp .feat,
			.sdp .act-cta .w {
				opacity: 1 !important;
				translate: none !important;
			}
		</style>
	</noscript>
</svelte:head>

{#snippet ghost(key: string)}
	<div class="sd-cursor" data-k={key} data-mode="arrow" aria-hidden="true">
		<svg class="sd-c-arrow" viewBox="0 0 24 24"
			><path
				d="M4 2l16 10-7 1.5L9.5 21z"
				fill="#111"
				stroke="#fff"
				stroke-width="1.5"
				stroke-linejoin="round"
			/></svg
		>
		<svg class="sd-c-text" viewBox="0 0 24 24"
			><path d="M8 3h8M8 21h8M12 3v18" stroke="#111" stroke-width="2" /></svg
		>
		<svg class="sd-c-hand" viewBox="0 0 24 24"
			><path
				d="M9 11V4.5a1.5 1.5 0 013 0V10m0-1.5a1.5 1.5 0 013 0V11m0-1a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L4 15.5a1.5 1.5 0 012.4-1.8L9 16"
				fill="#fff"
				stroke="#111"
				stroke-width="1.5"
				stroke-linejoin="round"
			/></svg
		>
		<svg class="c-touch" viewBox="0 0 32 32"
			><circle
				cx="16"
				cy="16"
				r="13"
				fill="rgba(17,17,17,.16)"
				stroke="rgba(17,17,17,.5)"
				stroke-width="1.5"
			/></svg
		>
	</div>
{/snippet}

{#snippet phone()}
	<div class="phone">
		<div class="phone-bar"><span>mdpubs.com/abc123</span></div>
		<div class="screen" data-k="screen">
			<article class="doc">
				<header class="letterhead">
					<!-- The Cupbots bot face, from cupbots/static/favicon.svg -->
					<svg viewBox="0 0 100 100" aria-hidden="true"
						><defs
							><mask id="cb-eyes"
								><rect width="100" height="100" fill="white" /><circle
									cx="50.9"
									cy="37.9"
									r="6.25"
									fill="black"
								/><circle cx="67.4" cy="35.4" r="6.25" fill="black" /></mask
							></defs
						><circle cx="50" cy="50" r="48" fill="#0a0a0a" mask="url(#cb-eyes)" /></svg
					>
					<b>Cupbots</b>
					<span>Proposal</span>
				</header>
				<p class="doc-title">Website redesign for Acme Co</p>
				<p class="doc-for">Prepared for Shawn and Matt · {today}</p>
				<dl>
					{#each terms as [term, value] (term)}
						<div>
							<dt>{term}</dt>
							<dd>
								{value}
							</dd>
						</div>
					{/each}
				</dl>
				<p class="doc-label">Scope</p>
				<ul>
					{#each included as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
				<!-- A real button: the demo JS opens the signing drawer on tap, so a
					 visitor can try signing without scrolling the demo to that act. -->
				<button class="signbox" type="button" data-k="signbox">
					<span>Matt, Acme Co</span>
					<span>✍️ Tap here to sign</span>
				</button>
				<div class="signed">
					<svg viewBox="0 0 300 100" aria-label="Signature of Matt" role="img"><path d={SIG} /></svg
					>
					<div class="signed-line">
						<b>Matt</b><span>Acme Co · {today}</span>
					</div>
				</div>
				<p class="stamp" data-k="stamp">✓ Signed and locked</p>
			</article>
			<div class="sigdrawer hide-nojs">
				<div class="scrim" data-k="scrim"></div>
				<div class="sheet" data-k="sheet">
					<div class="grip"></div>
					<p class="sheet-title">Signing as Matt</p>
					<p class="sheet-hint">Draw your signature</p>
					<svg class="pad" data-k="pad" viewBox="0 0 300 100" aria-hidden="true"
						><path data-k="ink" d={SIG} /></svg
					>
					<p class="sheet-name">Matt</p>
					<div class="sheet-btns">
						<button type="button" data-k="cancelBtn">Cancel</button><button
							type="button"
							class="sign-btn"
							data-k="signBtn">Sign</button
						>
					</div>
				</div>
			</div>
			{@render ghost('finger')}
		</div>
	</div>
{/snippet}

<div class="sdp" bind:this={root}>
	<!--
		Acts 1 to 5 share one pinned stage, so the chat window and the phone are
		each a single element that carries its state from act to act. Separate
		scenes would each need their own copy, and the next copy would scroll in
		from below as the last one left: the same screen, twice.
	-->
	<section class="sd-scene act-story" id="story">
		<div class="sd-stage">
			<div class="opener">
				<h1>Write one prompt. <em>Get a signed contract back.</em></h1>
				<p>
					$20 a month, flat. No envelope caps, no seat fees. Your client opens a link and signs. No
					login. Every view is logged.
				</p>
				<!--
					Above the fold, before the demo starts: a visitor who is already sold
					should not have to scroll 11000px to find the price.
				-->
				<a class="hero-cta" href={signupHref}>Start for $20/mo →</a>
				<p class="hero-note">No account needed for clients. Cancel anytime.</p>
			</div>

			<div class="chatwin sd-paper" data-k="chatwin">
				<header class="chat-bar"><i></i><i></i><i></i><span>Your AI</span></header>
				<div class="chat-body">
					<div class="thread">
						<p class="bubble" data-k="bubble">{PROMPT}</p>
						<div class="reply" data-k="reply">
							<p>Done. The proposal is live and ready for Shawn and Matt to sign.</p>
							<div class="linkcard" data-k="link">
								<span class="ico">md</span>
								<span class="lc-text"
									><b>Website redesign for Acme Co</b><span>mdpubs.com/abc123</span></span
								>
							</div>
						</div>
					</div>
				</div>
				<div class="chat-input" data-k="input">
					<p class="sd-type" data-k="text">{PROMPT}</p>
					<div class="sd-caret sd-blink" data-k="caret"></div>
					<span class="send" data-k="send">↑</span>
				</div>
			</div>

			<div class="duo">
				<div class="side">
					<div class="captions">
						<p class="caption" data-k="capOpen">
							Your client opens the link. <em>No account, no app.</em>
						</p>
						<p class="caption" data-k="capSign">They sign it <em>with a thumb.</em></p>
						<p class="caption" data-k="capLocked">
							Locked once signed. <em>Every view is logged.</em>
						</p>
					</div>
					<div class="log sd-float" data-k="log">
						<p class="log-title">Activity</p>
						<ul>
							{#each log as [what, who, when] (what + who)}
								<li data-k="row"><b>{what}</b><span>{who}</span><time>{when}</time></li>
							{/each}
						</ul>
					</div>
				</div>
				<div class="phone-fit">{@render phone()}</div>
			</div>

			{@render ghost('cursor')}
		</div>
	</section>

	<!--
		The contrast, in plain sections after the demo: what signing costs today,
		and what it costs here. A static block on purpose — it is the one part of
		the page a visitor should be able to read without waiting for an animation.
	-->
	<section class="contrast">
		<h2>Two ways to get this signed</h2>
		<div class="contrast-cards">
			<div class="con con-old">
				<p class="con-tag">The old way</p>
				<p class="con-name">DocuSign &amp; PDF</p>
				<p class="con-body">
					<em>$40/mo per seat</em>, envelope limits. Client pinches and zooms an unreadable PDF on a
					phone, delays 4 days to sign on desktop.
				</p>
			</div>
			<div class="con con-new">
				<p class="con-tag">The MdPubs way</p>
				<p class="con-name">MdPubs</p>
				<p class="con-body">
					<em>Flat $20/mo.</em> Client opens a clean web link and signs with a thumb in 8 seconds. Audit-locked
					instantly.
				</p>
			</div>
		</div>
	</section>

	<!-- One price: the headline parts and the rest swings in -->
	<section class="sd-scene act-more" id="more">
		<div class="sd-stage">
			<h2><span data-k="w1">One</span><span data-k="w2">price.</span></h2>
			<div class="cards">
				{#each cards as runs, i (i)}
					<p class="feat sd-float">
						{#each runs as [text, accent], j (j)}{#if accent}<em>{text}</em
								>{:else}{text}{/if}{/each}
					</p>
				{/each}
			</div>
		</div>
	</section>

	<section class="setup">
		<h2>Set up in a minute</h2>
		<p class="setup-sub">Use the AI you already have. No API key to copy.</p>
		<ol>
			<li>
				<span class="n">01</span>
				<div class="step">
					<div class="tabs" role="tablist">
						{#each setupPaths as path, i (path.name)}
							<button
								role="tab"
								aria-selected={tab === i}
								class:on={tab === i}
								onclick={() => (tab = i)}>{path.name}</button
							>
						{/each}
					</div>
					<p>{setupPaths[tab].first}</p>
					<code>{setupPaths[tab].paste}</code>
				</div>
			</li>
			<li>
				<span class="n">02</span>
				<p class="step">Log in when it asks.</p>
			</li>
			<li>
				<span class="n">03</span>
				<p class="step">
					Ask for it: <em>"Publish this proposal to mdpubs for my client to sign."</em>
				</p>
			</li>
		</ol>
	</section>

	<section class="sd-scene act-cta" id="start">
		<div class="sd-stage">
			<div class="cta-inner">
				<a href={signupHref}
					><span class="w">Start</span> <span class="w">for</span>
					<span class="w">$20/mo</span> <span class="w">→</span></a
				>
				<p>
					<span class="w">Cancel</span> <span class="w">anytime.</span>
				</p>
				<p class="small"><span class="w">Or $190 a year, $50 less.</span></p>
			</div>
		</div>
	</section>

	<footer>
		<p>
			&copy; {new Date().getFullYear()} MdPubs, built by
			<a href="https://x.com/me_sshawn" target="_blank">Shawn</a>.
		</p>
		<FeedbackWidget
			bind:message={feedbackMessage}
			bind:email={feedbackEmail}
			bind:name={feedbackName}
			variant="footer"
		/>
	</footer>
</div>

<style>
	.sdp {
		--sd-accent: oklch(45% 0.24 277);
		--sd-font-display: 'Inter', system-ui, sans-serif;
		--sd-font-text: 'Inter', system-ui, sans-serif;
		--sd-font-mono: 'JetBrains Mono', ui-monospace, monospace;
		--phone-w: 340px;
		--phone-h: 660px;
		background: var(--sd-canvas);
		color: var(--sd-ink);
		font-family: var(--sd-font-text);
	}

	/*
		Everything below is global but held under .sdp: the scroll engine toggles
		classes and data attributes Svelte can't see, and scoped selectors for them
		would be pruned as unused.
	*/
	.sdp :global {
		/*
			Acts 1 to 5 in one scene. Budgets: hero 1200px, prompt 2600, open 1800,
			sign 4000, locked 1400. mdpubs-demo.js splits the timeline the same way.
		*/
		.act-story {
			height: calc(100lvh + 11000px);
		}
		.opener {
			place-self: start center;
			display: grid;
			justify-items: center;
			/* The CTA and its microcopy sit tighter than headline-to-subhead. */
			gap: 14px;
			padding: 14lvh 16px 0;
			text-align: center;
		}
		.opener h1 + p {
			margin-bottom: 6px;
		}
		.opener h1 {
			font: 600 clamp(32px, 5vw, 64px) / 1.06 var(--sd-font-display);
			letter-spacing: -0.02em;
			max-width: 17ch;
		}
		.opener p {
			max-width: 46ch;
			font-size: clamp(16px, 1.5vw, 19px);
			line-height: 1.5;
			color: var(--sd-ink-soft);
		}
		.hero-cta {
			margin-top: 4px;
			padding: 15px 30px;
			border-radius: 99px;
			background: var(--sd-accent);
			/* `!`: scrolldemo.css sets an unlayered `a { color: inherit }`. */
			color: #fff !important;
			font: 600 clamp(17px, 1.6vw, 20px) / 1 var(--sd-font-display);
			letter-spacing: -0.01em;
			text-decoration: none;
			white-space: nowrap;
			transition:
				scale 0.12s,
				filter 0.12s;
		}
		.hero-cta:hover {
			filter: brightness(1.12);
		}
		.hero-cta:active {
			scale: 0.97;
		}
		.opener .hero-note {
			margin-top: -6px;
			font-size: 13.5px;
			color: var(--sd-ink-soft);
		}
		.act-story .chatwin,
		.act-story .phone {
			translate: 0 100lvh;
		}

		/* The chat window, shared by acts 1 to 3 */
		.chatwin {
			width: min(92vw, 880px);
			height: min(80lvh, 620px);
			border-radius: 18px;
			overflow: hidden;
			display: grid;
			grid-template-rows: auto 1fr auto;
		}
		.chat-bar {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 12px 16px;
			border-bottom: 1px solid var(--sd-hairline);
			font-size: 13px;
			color: var(--sd-ink-soft);
		}
		.chat-bar i {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: #e5e5e5;
		}
		.chat-bar span {
			margin-left: 10px;
		}
		.chat-body {
			display: grid;
			padding: 24px clamp(16px, 5vw, 56px);
			overflow: hidden;
			min-height: 0;
		}
		.chat-body > * {
			grid-area: 1 / 1;
		}
		.thread {
			align-self: end;
			display: grid;
			gap: 16px;
			font-size: 15px;
			line-height: 1.5;
		}
		.bubble {
			justify-self: end;
			max-width: min(520px, 85%);
			background: #f1f1f1;
			padding: 12px 16px;
			border-radius: 18px 18px 4px 18px;
		}
		.reply {
			max-width: min(520px, 92%);
			display: grid;
			gap: 10px;
		}
		.linkcard {
			display: flex;
			gap: 12px;
			align-items: center;
			padding: 12px 14px;
			border-radius: 12px;
			background: var(--sd-paper);
			box-shadow: var(--sd-shadow);
			transition: scale 0.12s;
		}
		.linkcard.is-pressed {
			scale: 0.97;
		}
		.linkcard .ico {
			flex: none;
			width: 36px;
			height: 36px;
			border-radius: 9px;
			background: var(--sd-ink);
			color: #fff;
			display: grid;
			place-items: center;
			font: 500 13px var(--sd-font-mono);
		}
		.lc-text b {
			display: block;
			font-size: 14px;
			font-weight: 600;
		}
		.lc-text span {
			font: 12px var(--sd-font-mono);
			color: var(--sd-ink-soft);
		}
		.chat-input {
			position: relative;
			display: grid;
			margin: 0 clamp(12px, 3vw, 24px) clamp(12px, 3vw, 24px);
			border: 1px solid var(--sd-hairline);
			border-radius: 16px;
			padding: 14px 56px 14px 16px;
			min-height: 76px;
			font-size: 16px;
			line-height: 1.5;
		}
		.chat-input > p {
			grid-area: 1 / 1;
		}
		.send {
			position: absolute;
			right: 12px;
			bottom: 12px;
			width: 34px;
			height: 34px;
			border-radius: 50%;
			background: #d4d4d4;
			color: #fff;
			display: grid;
			place-items: center;
			font-weight: 600;
			transition:
				background 0.15s,
				scale 0.12s;
		}
		.send.is-ready {
			background: var(--sd-ink);
		}
		.send.is-pressed {
			scale: 0.86;
		}
		.chatwin.is-sent .chat-input .sd-type,
		.chatwin.is-sent .chat-input .sd-caret {
			visibility: hidden;
		}
		.act-story .bubble,
		.act-story .reply,
		.act-story .linkcard {
			opacity: 0;
		}

		/* Caption + phone, acts 3 to 5 */
		.duo {
			display: grid;
			grid-template-columns: minmax(0, 420px) var(--phone-w);
			gap: clamp(32px, 7vw, 120px);
			align-items: center;
		}
		.caption {
			font: 600 clamp(24px, 2.8vw, 42px) / 1.12 var(--sd-font-display);
			letter-spacing: -0.02em;
			opacity: 0;
		}
		.phone-fit {
			width: var(--phone-w);
			height: var(--phone-h);
			perspective: 1100px;
			transform-origin: 50% 0;
		}

		/* The phone, rebuilt from SignPlayground */
		.phone {
			width: 100%;
			height: 100%;
			display: flex;
			flex-direction: column;
			background: #fff;
			border: 8px solid #111;
			border-radius: 46px;
			overflow: hidden;
			box-shadow: var(--sd-shadow-lift);
			transform-style: preserve-3d;
		}
		.phone-bar {
			display: flex;
			justify-content: center;
			padding: 14px 22px 6px;
		}
		.phone-bar span {
			padding: 4px 12px;
			border-radius: 99px;
			background: #f3f4f6;
			font: 11px var(--sd-font-mono);
			color: #6b7280;
		}
		.screen {
			position: relative;
			flex: 1;
			overflow: hidden;
		}
		.doc {
			padding: 18px 24px 24px;
			color: #1f2937;
			font-size: 13.5px;
			line-height: 1.5;
		}
		.letterhead {
			display: flex;
			align-items: center;
			gap: 8px;
			padding-bottom: 14px;
			border-bottom: 1px solid #111827;
		}
		.letterhead svg {
			width: 22px;
			height: 22px;
		}
		.letterhead b {
			font-size: 14px;
			font-weight: 600;
			letter-spacing: -0.01em;
			color: #111827;
		}
		.letterhead span,
		.doc-label {
			font-size: 10px;
			font-weight: 500;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: #9ca3af;
		}
		.letterhead span {
			margin-left: auto;
		}
		.doc-title {
			margin-top: 22px;
			font-size: 20px;
			font-weight: 600;
			line-height: 1.25;
			letter-spacing: -0.015em;
			text-wrap: balance;
			color: #111827;
		}
		.doc-for {
			margin-top: 6px;
			font-size: 12px;
			color: #6b7280;
		}
		.doc dl {
			margin: 20px 0 0;
			border-block: 1px solid #e5e7eb;
		}
		.doc dl > div {
			display: flex;
			justify-content: space-between;
			gap: 16px;
			padding: 8px 0;
		}
		.doc dl > div + div {
			border-top: 1px solid #e5e7eb;
		}
		.doc dt {
			color: #6b7280;
		}
		.doc dd {
			margin: 0;
			text-align: right;
			font-weight: 500;
			color: #111827;
		}
		.doc-label {
			margin-top: 20px;
		}
		.doc ul {
			margin: 8px 0 0;
			padding: 0;
			list-style: none;
			display: grid;
			gap: 6px;
		}
		.doc li {
			padding-left: 12px;
			border-left: 1px solid #e5e7eb;
		}
		.signbox {
			margin-top: 20px;
			display: grid;
			width: 100%;
			gap: 4px;
			padding: 14px 16px;
			border: 1.5px dashed #9ca3af;
			border-radius: 8px;
			background: none;
			font: inherit;
			text-align: left;
			color: inherit;
			/* Tappable for real: a visitor on a phone can open the drawer and sign
			   it themselves without waiting for the scroll to get there. */
			cursor: pointer;
			touch-action: manipulation;
			transition:
				background 0.12s,
				scale 0.12s;
		}
		.signbox.is-pressed {
			background: #f3f4f6;
			scale: 0.98;
		}
		.signbox span:first-child {
			font-size: 11px;
			font-weight: 500;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: #6b7280;
		}
		.signed {
			margin-top: 16px;
			max-width: 240px;
		}
		.signed svg {
			display: block;
			width: 150px;
			height: 50px;
		}
		.signed path,
		.pad path {
			fill: none;
			stroke: #111827;
			stroke-width: 2.4;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.signed-line {
			display: grid;
			border-top: 2px dotted #9ca3af;
			padding-top: 4px;
		}
		.signed-line b {
			font-size: 14px;
			font-weight: 500;
			color: #111827;
		}
		.signed-line span {
			font-size: 12px;
			color: #6b7280;
		}
		.stamp {
			display: inline-block;
			margin-top: 14px;
			padding: 4px 12px;
			border: 1.5px solid var(--sd-accent);
			border-radius: 99px;
			color: var(--sd-accent);
			font-size: 12px;
			font-weight: 600;
		}
		.phone:not(.is-signed) .signed,
		.phone:not(.is-signed) .stamp,
		.phone.is-signed .signbox {
			display: none;
		}
		.sigdrawer {
			position: absolute;
			inset: 0;
			/* Inert while the demo plays itself; live once the visitor taps the box. */
			pointer-events: none;
		}
		.screen.is-live .sigdrawer {
			pointer-events: auto;
		}
		/* Drawing must not scroll the page out from under the stroke. */
		.screen.is-live .pad {
			touch-action: none;
			cursor: crosshair;
		}
		.screen.is-live .sheet-btns button {
			cursor: pointer;
			touch-action: manipulation;
		}
		/* Sign tapped with nothing drawn: say so instead of signing an empty box. */
		.pad.is-asking {
			border-color: var(--sd-accent);
			background: #fff;
		}
		.scrim {
			position: absolute;
			inset: 0;
			background: rgb(17 24 39 / 0.4);
			opacity: 0;
		}
		.sheet {
			position: absolute;
			inset: auto 0 0;
			padding: 14px 16px 18px;
			background: #fff;
			border-top: 1px solid #d1d5db;
			border-radius: 18px 18px 0 0;
			box-shadow: 0 -8px 24px rgb(0 0 0 / 0.12);
			translate: 0 101%;
			font-size: 13px;
		}
		.grip {
			width: 40px;
			height: 4px;
			margin: 0 auto 12px;
			border-radius: 4px;
			background: #d1d5db;
		}
		.sheet-title {
			font-size: 14px;
			font-weight: 600;
			color: #111827;
		}
		.sheet-hint {
			margin: 8px 0 6px;
			font-size: 12px;
			color: #4b5563;
		}
		.pad {
			display: block;
			width: 100%;
			aspect-ratio: 3 / 1;
			border: 1px dashed #d1d5db;
			border-radius: 10px;
			background: #f9fafb;
		}
		.sheet-name {
			margin-top: 8px;
			padding: 8px 12px;
			border: 1px solid #d1d5db;
			border-radius: 10px;
			color: #111827;
		}
		.sheet-btns {
			display: flex;
			gap: 8px;
			margin-top: 10px;
		}
		.sheet-btns button {
			flex: 1;
			padding: 8px;
			border: 1px solid #d1d5db;
			border-radius: 10px;
			background: none;
			font: inherit;
			text-align: center;
			color: #374151;
		}
		.sheet-btns .sign-btn {
			background: #111827;
			border-color: #111827;
			color: #fff;
			font-weight: 500;
			transition: scale 0.12s;
		}
		.sign-btn.is-pressed {
			scale: 0.94;
		}

		/* A finger, for the phone acts */
		.sd-cursor[data-mode='touch'] {
			width: 32px;
			height: 32px;
			margin: -16px 0 0 -16px;
			filter: none;
		}
		.sd-cursor[data-mode='touch'] .c-touch {
			display: block;
		}

		/* Captions cross-fade in one cell; the log hangs below without moving them */
		.side {
			position: relative;
		}
		.captions {
			display: grid;
		}
		.captions > * {
			grid-area: 1 / 1;
		}
		.log {
			position: absolute;
			top: calc(100% + 28px);
			left: 0;
			right: 0;
			padding: 18px 20px;
			opacity: 0;
			/* Decoration only, and on mobile it sits over the phone at z-index 2 —
			   without this it swallows the tap meant for the signing box. */
			pointer-events: none;
		}
		.log-title {
			font: 500 11px var(--sd-font-mono);
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--sd-ink-soft);
		}
		.log ul {
			margin: 10px 0 0;
			padding: 0;
			list-style: none;
		}
		.log li {
			display: grid;
			grid-template-columns: 64px 1fr auto;
			gap: 12px;
			padding: 9px 0;
			font-size: 14px;
			opacity: 0;
		}
		.log li + li {
			border-top: 1px solid var(--sd-hairline);
		}
		.log li span {
			color: var(--sd-ink-soft);
		}
		.log time {
			font: 12px var(--sd-font-mono);
			color: var(--sd-ink-soft);
		}

		/* Act 6 */
		.act-more {
			height: calc(100lvh + 2000px);
		}
		.act-more h2 {
			display: flex;
			gap: 0.25em;
			font-size: clamp(56px, 10vw, 150px);
		}
		.cards {
			display: flex;
			gap: 18px;
			perspective: 900px;
		}
		.feat {
			width: min(70vw, 21vw, 250px);
			padding: 22px;
			border-radius: 10px;
			font-size: 16px;
			line-height: 1.4;
			opacity: 0;
		}

		/* The two ways in, side by side. A plain section, no scroll scene. */
		.contrast {
			max-width: 900px;
			margin: 0 auto;
			padding: 120px 16px 0;
		}
		.contrast h2 {
			font: 600 clamp(28px, 3.6vw, 44px) / 1.1 var(--sd-font-display);
			letter-spacing: -0.02em;
			text-align: center;
			text-wrap: balance;
		}
		.contrast-cards {
			margin-top: 40px;
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 20px;
		}
		.con {
			padding: 26px;
			border: 1px solid var(--sd-hairline);
			border-radius: 14px;
		}
		.con-new {
			border-color: var(--sd-accent);
			background: var(--sd-paper);
			box-shadow: var(--sd-shadow);
		}
		.con-tag {
			font: 500 11px var(--sd-font-mono);
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--sd-ink-soft);
		}
		.con-new .con-tag {
			color: var(--sd-accent);
		}
		.con-name {
			margin-top: 10px;
			font: 600 clamp(20px, 2.2vw, 26px) / 1.15 var(--sd-font-display);
			letter-spacing: -0.015em;
		}
		.con-body {
			margin-top: 12px;
			font-size: 15.5px;
			line-height: 1.55;
			color: var(--sd-ink-soft);
		}
		.con-body em {
			font-style: normal;
			font-weight: 600;
			color: var(--sd-ink);
		}
		.con-new .con-body em {
			color: var(--sd-accent);
		}
		/* The old way reads as the thing you are leaving behind. */
		.con-old .con-name,
		.con-old .con-body em {
			color: var(--sd-ink-soft);
		}

		/* Setup: a plain section, no scroll scene */
		.setup {
			max-width: 640px;
			margin: 0 auto;
			padding: 120px 16px;
		}
		.setup h2 {
			font: 600 clamp(28px, 3.6vw, 44px) / 1.1 var(--sd-font-display);
			letter-spacing: -0.02em;
		}
		.setup-sub {
			margin-top: 10px;
			color: var(--sd-ink-soft);
		}
		.setup ol {
			margin: 40px 0 0;
			padding: 0;
			list-style: none;
			display: grid;
			/* minmax(0, …) so the unwrapped command scrolls inside its box instead of widening the page */
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
		.setup li {
			display: flex;
			gap: 16px;
		}
		.setup .n {
			font: 14px var(--sd-font-mono);
			color: var(--sd-ink-soft);
		}
		.setup .step {
			flex: 1;
			min-width: 0;
		}
		.tabs {
			display: flex;
			gap: 4px;
			margin-bottom: 14px;
		}
		.tabs button {
			padding: 6px 12px;
			border: 1px solid var(--sd-hairline);
			border-radius: 99px;
			background: none;
			font: 12px var(--sd-font-mono);
			color: var(--sd-ink-soft);
			cursor: pointer;
		}
		.tabs button.on {
			background: var(--sd-ink);
			border-color: var(--sd-ink);
			color: #fff;
		}
		.setup code {
			display: block;
			margin-top: 8px;
			padding: 12px 14px;
			overflow-x: auto;
			white-space: nowrap;
			border: 1px solid var(--sd-hairline);
			border-radius: 10px;
			background: var(--sd-paper);
			font: 13px var(--sd-font-mono);
			user-select: all;
		}

		/* Close */
		.act-cta {
			height: calc(100lvh + 600px);
		}
		.cta-inner {
			display: grid;
			gap: 8px;
			text-align: center;
			padding: 0 16px;
		}
		.cta-inner a {
			font: 600 clamp(32px, 4.6vw, 60px) / 1.1 var(--sd-font-display);
			letter-spacing: -0.02em;
			color: var(--sd-accent);
			text-decoration: none;
		}
		.cta-inner p {
			font-size: clamp(20px, 2.6vw, 32px);
			font-weight: 500;
		}
		.cta-inner .small {
			margin-top: 8px;
			font: 14px var(--sd-font-mono);
			color: var(--sd-ink-soft);
		}
		.act-cta .w {
			display: inline-block;
			opacity: 0;
		}

		footer {
			display: flex;
			flex-wrap: wrap;
			justify-content: space-between;
			gap: 16px;
			padding: 40px 24px;
			border-top: 1px solid var(--sd-hairline);
			font: 12px var(--sd-font-mono);
			color: var(--sd-ink-soft);
		}
		footer a {
			text-decoration: underline;
			text-underline-offset: 4px;
		}
	}

	@media (max-width: 760px) {
		.sdp :global {
			.chatwin {
				height: min(82lvh, 640px);
			}
			.chat-bar span {
				margin-left: 6px;
			}
			.duo {
				grid-template-columns: 1fr;
				justify-items: center;
				align-content: start;
				align-self: start;
				gap: 18px;
				padding-top: 5lvh;
			}
			.caption {
				max-width: 20ch;
				text-align: center;
				font-size: 24px;
			}
			.side {
				display: contents;
			}
			/* Two caption lines, fixed, so the phone below doesn't jump when Inter swaps in */
			.captions {
				order: -1;
				height: calc(2 * 1.12 * 24px);
				align-content: end;
			}
			.log {
				top: auto;
				z-index: 2;
				left: 16px;
				right: 16px;
				bottom: 3lvh;
			}
			.contrast {
				padding-top: 80px;
			}
			.contrast-cards {
				grid-template-columns: minmax(0, 1fr);
				margin-top: 28px;
				gap: 14px;
			}
			.con {
				padding: 20px;
			}
			.cards {
				flex-direction: column;
				gap: 10px;
			}
			.feat {
				width: min(84vw, 340px);
				padding: 14px 16px;
			}
		}
	}
</style>
