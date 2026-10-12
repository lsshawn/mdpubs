<script lang="ts">
	/**
	 * Scroll-demo variation of the landing page. Same pitch as `/`, acted out: a
	 * chat window types the prompt, the link opens a phone, a thumb signs it, and
	 * the signed doc refuses an edit.
	 *
	 * The markup lives here. The choreography is plain JS in
	 * static/scrolldemo/mdpubs-demo.js, next to the scroll engine it drives
	 * (scrolldemo.js, copied verbatim from the scroll-demo skill). Both are loaded
	 * on mount so the engine, which touches `window` at import, never runs on the
	 * server, and its global stylesheet is only on the page while this route is.
	 */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { config } from '#lib/config.js';

	const signupHref = resolve('login');

	const PROMPT =
		'Write a proposal for Acme Co: a 4-page site with a blog. $11,000, six weeks, half up front. Jordan Lee signs.';

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
		['Sent', 'Rivera Studio', '9:02 AM'],
		['Opened', 'Jordan Lee', '9:40 AM'],
		['Signed', 'Jordan Lee', '9:41 AM'],
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
			['Your own ', false],
			['branded domain.', true]
		],
		[
			['Works from ', false],
			['Claude Code, Codex, Claude and ChatGPT.', true]
		]
	];

	let root: HTMLDivElement;

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
	<title>MdPubs — watch a contract go from one prompt to a thumb signature</title>
	<meta
		name="description"
		content="$20 a month, flat. Your AI writes the contract, your client signs it on their phone. No account, no app, no printer."
	/>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
	/>
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

{#snippet chatBar()}
	<header class="chat-bar"><i></i><i></i><i></i><span>Your AI</span></header>
{/snippet}

{#snippet thread()}
	<div class="thread">
		<p class="bubble" data-k="bubble">{PROMPT}</p>
		<div class="reply" data-k="reply">
			<p>Done. The proposal is live and ready for Jordan to sign.</p>
			<div class="linkcard" data-k="link">
				<span class="ico">md</span>
				<span class="lc-text"
					><b>Website redesign for Acme Co</b><span>mdpubs.com/abc123</span></span
				>
			</div>
		</div>
	</div>
{/snippet}

{#snippet phone(signed: boolean)}
	<div class="phone" class:is-signed={signed}>
		<div class="phone-bar"><span>9:41</span><span>mdpubs.com/abc123</span><span>100%</span></div>
		<div class="screen" data-k="screen">
			<article class="doc">
				<p class="doc-kicker">Proposal · Rivera Studio</p>
				<h3>Website redesign for Acme Co</h3>
				<p class="doc-for">Prepared for Jordan Lee</p>
				<dl>
					{#each terms as [term, value] (term)}
						<div>
							<dt>{term}</dt>
							<dd>
								{#if term === 'Total'}<span class="sd-sel" data-k="amount">{value}</span
									>{:else}{value}{/if}
							</dd>
						</div>
					{/each}
				</dl>
				<p class="doc-label">What you get</p>
				<ul>
					{#each included as item (item)}
						<li><span>—</span>{item}</li>
					{/each}
				</ul>
				<div class="signbox" data-k="signbox">
					<span>Jordan Lee, Acme Co</span>
					<span>✍️ Tap here to sign</span>
				</div>
				<div class="signed">
					<svg viewBox="0 0 300 100" aria-label="Signature of Jordan Lee" role="img"
						><path d={SIG} /></svg
					>
					<div class="signed-line">
						<b>Jordan Lee</b><span>Acme Co · {today}</span>
					</div>
				</div>
				<p class="stamp" data-k="stamp">✓ Signed and locked</p>
			</article>
			<div class="sigdrawer hide-nojs">
				<div class="scrim" data-k="scrim"></div>
				<div class="sheet" data-k="sheet">
					<div class="grip"></div>
					<p class="sheet-title">Signing as Jordan Lee</p>
					<p class="sheet-hint">Draw your signature</p>
					<svg class="pad" data-k="pad" viewBox="0 0 300 100" aria-hidden="true"
						><path data-k="ink" d={SIG} /></svg
					>
					<p class="sheet-name">Jordan Lee</p>
					<div class="sheet-btns">
						<span>Cancel</span><span class="sign-btn" data-k="signBtn">Sign</span>
					</div>
				</div>
			</div>
			{@render ghost('finger')}
		</div>
	</div>
{/snippet}

<div class="sdp" bind:this={root}>
	<!-- Opener, then the chat window rises with the headline in it -->
	<section class="sd-scene act-hero" id="hero">
		<div class="sd-stage">
			<p class="opener">
				E-sign tools charge per envelope, per seat, per year.<br /><em
					>mdpubs is $20 a month. Flat.</em
				>
			</p>
			<div class="chatwin sd-paper">
				{@render chatBar()}
				<div class="chat-body">
					<h1 class="chat-head">
						Your AI writes the contract. <em>Your client signs it on their phone.</em>
					</h1>
				</div>
				<div class="chat-input">
					<p class="placeholder">Ask for a proposal</p>
					<span class="send">↑</span>
				</div>
			</div>
		</div>
	</section>

	<!-- The prompt types itself and sends; the reply carries the link -->
	<section class="sd-scene act-prompt" id="prompt">
		<div class="sd-stage">
			<div class="chatwin sd-paper">
				{@render chatBar()}
				<div class="chat-body">
					<p class="chat-head" data-k="head" aria-hidden="true">
						Your AI writes the contract. <em>Your client signs it on their phone.</em>
					</p>
					{@render thread()}
				</div>
				<div class="chat-input" data-k="input">
					<p class="sd-type" data-k="text">{PROMPT}</p>
					<div class="sd-caret sd-blink" data-k="caret"></div>
					<span class="send" data-k="send">↑</span>
				</div>
			</div>
		</div>
	</section>

	<!-- Click the link; the chat recedes and the client's phone rises -->
	<section class="sd-scene act-open" id="open">
		<div class="sd-stage">
			<div class="chatwin sd-paper is-sent">
				{@render chatBar()}
				<div class="chat-body">{@render thread()}</div>
				<div class="chat-input">
					<p class="placeholder">Reply</p>
					<span class="send">↑</span>
				</div>
			</div>
			<div class="duo">
				<p class="caption">Your client opens the link. <em>No account, no app.</em></p>
				<div class="phone-fit">{@render phone(false)}</div>
			</div>
			{@render ghost('cursor')}
		</div>
	</section>

	<!-- The peak: tap, draw, sign. The phone leans in while it happens -->
	<section class="sd-scene act-sign" id="sign">
		<div class="sd-stage">
			<div class="duo">
				<p class="caption">They sign it <em>with a thumb.</em></p>
				<div class="phone-fit">{@render phone(false)}</div>
			</div>
		</div>
	</section>

	<!-- Try to edit the signed amount; it refuses. The log fills in -->
	<section class="sd-scene act-locked" id="locked">
		<div class="sd-stage">
			<div class="duo duo-r">
				<div class="phone-fit">{@render phone(true)}</div>
				<div class="side">
					<p class="caption">Locked once signed. <em>Every view is logged.</em></p>
					<div class="log sd-float" data-k="log">
						<p class="log-title">Activity</p>
						<ul>
							{#each log as [what, who, when] (what)}
								<li data-k="row"><b>{what}</b><span>{who}</span><time>{when}</time></li>
							{/each}
						</ul>
					</div>
				</div>
			</div>
			<div class="tip sd-float hide-nojs" data-k="tip">Signed. This can't change now.</div>
			{@render ghost('cursor')}
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

	<section class="sd-scene act-cta" id="start">
		<div class="sd-stage">
			<div class="cta-inner">
				<a href={signupHref}
					><span class="w">Start</span> <span class="w">for</span>
					<span class="w">$20/mo</span> <span class="w">→</span></a
				>
				<p>
					<span class="w">Cancel</span> <span class="w">anytime.</span> <span class="w">No</span>
					<span class="w">yearly</span> <span class="w">contract.</span>
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
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={config.git}>Docs</a>
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
		/* Act 1 */
		.act-hero {
			height: calc(100lvh + 1200px);
		}
		.opener {
			place-self: center start;
			padding-left: 8vw;
			font-size: clamp(20px, 2vw, 30px);
			font-weight: 500;
			line-height: 1.35;
			max-width: 30ch;
		}
		.act-hero .chatwin {
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
		.chat-head {
			place-self: center;
			text-align: center;
			font: 600 clamp(28px, 4.4vw, 56px) / 1.08 var(--sd-font-display);
			letter-spacing: -0.02em;
			max-width: 17ch;
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
			margin: 0 clamp(12px, 3vw, 24px) clamp(12px, 3vw, 24px);
			border: 1px solid var(--sd-hairline);
			border-radius: 16px;
			padding: 14px 56px 14px 16px;
			min-height: 76px;
			font-size: 16px;
			line-height: 1.5;
		}
		.placeholder {
			color: #a3a3a3;
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
		.act-prompt {
			height: calc(100lvh + 2600px);
		}
		.act-prompt .bubble,
		.act-prompt .reply,
		.act-prompt .linkcard {
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
		.act-open {
			height: calc(100lvh + 1800px);
		}
		.act-open .phone {
			translate: 0 100lvh;
		}
		.act-sign {
			height: calc(100lvh + 4000px);
		}
		.act-locked {
			height: calc(100lvh + 2200px);
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
			justify-content: space-between;
			gap: 8px;
			padding: 10px 22px 8px;
			border-bottom: 1px solid #e5e7eb;
			background: #f9fafb;
			font: 11px var(--sd-font-mono);
			color: #6b7280;
		}
		.screen {
			position: relative;
			flex: 1;
			overflow: hidden;
		}
		.doc {
			padding: 20px 20px 24px;
			color: #1f2937;
			font-size: 14px;
			line-height: 1.45;
		}
		.doc-kicker,
		.doc-label {
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: #6b7280;
		}
		.doc h3 {
			margin-top: 8px;
			font-size: 21px;
			line-height: 1.25;
			letter-spacing: -0.01em;
			color: #111827;
		}
		.doc-for {
			margin-top: 4px;
			font-size: 12px;
			color: #6b7280;
		}
		.doc dl {
			margin: 16px 0 0;
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
			margin-top: 16px;
		}
		.doc ul {
			margin: 8px 0 0;
			padding: 0;
			list-style: none;
			display: grid;
			gap: 6px;
		}
		.doc li {
			display: flex;
			gap: 8px;
		}
		.doc li span {
			color: #9ca3af;
		}
		.signbox {
			margin-top: 20px;
			display: grid;
			gap: 4px;
			padding: 16px;
			border: 2px dashed #111827;
			border-radius: 10px;
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
			pointer-events: none;
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
		.sheet-btns span {
			flex: 1;
			padding: 8px;
			border: 1px solid #d1d5db;
			border-radius: 10px;
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

		/* Act 5 */
		.duo-r {
			grid-template-columns: var(--phone-w) minmax(0, 420px);
		}
		.side {
			display: grid;
			gap: 28px;
		}
		.log {
			padding: 18px 20px;
			opacity: 0;
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
		.tip {
			position: absolute;
			left: 0;
			top: 0;
			padding: 8px 12px;
			border-radius: 10px;
			font-size: 13px;
			font-weight: 500;
			white-space: nowrap;
			opacity: 0;
			scale: 0.92;
			pointer-events: none;
			transition:
				opacity 0.15s,
				scale 0.15s;
		}
		.tip.is-on {
			opacity: 1;
			scale: 1;
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
			.duo,
			.duo-r {
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
			.duo-r .side {
				display: contents;
			}
			.duo-r .caption {
				order: -1;
			}
			.duo-r .log {
				position: absolute;
				left: 16px;
				right: 16px;
				bottom: 3lvh;
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
