<script lang="ts">
	import { config } from '#lib/config.js';
	import { resolve } from '$app/paths';
	import SignPlayground from '#lib/components/SignPlayground.svelte';

	/**
	 * Both pricing CTAs go to signup rather than straight to Stripe. The app has a
	 * single Stripe payment link configured (config.stripePaymentLinks), not one
	 * per tier, and wiring a second link would mean a new config entry — an
	 * owner's call. Signup is the step a visitor has to take first anyway.
	 */
	const signupHref = resolve('login');

	const oldWay = [
		'You hit the monthly envelope cap halfway through a deal.',
		'A second person on your team means a second seat.',
		'The price you saw needs a yearly contract. Cancelling means calling sales.',
		'Your client is asked to make an account, then pinches a PDF on their phone.'
	];
	const newWay = [
		'$20 a month. Send as many contracts as you like.',
		'Your AI writes the contract and sends you a link.',
		'Your client taps the box and signs with a thumb. No account, no app.',
		'Locked once signed, with a log of every view and signature.'
	];

	// Both paths end at the same login page, which sends new users through
	// checkout before handing a key to the installer or a token to the connector.
	const setupPaths = [
		{
			name: 'Claude Code · Codex',
			first: 'Paste this into Claude Code or Codex:',
			paste: 'curl -fsSL https://mdpubs.com/install | sh',
			second: 'Log in at the link it shows you. New here? Subscribe on the same page.'
		},
		{
			name: 'Claude · ChatGPT',
			first: 'Add a connector with this URL:',
			paste: 'https://mdpubs.com/mcp',
			second: 'Log in when it asks. New here? Subscribe on the same page.'
		}
	];
</script>

<svelte:head>
	<title>MdPubs — your AI writes the contract, your client signs on a phone</title>
	<meta
		name="description"
		content="$20 a month, flat. No envelopes, no seats, no per-document fees. Clients open a link and sign with a thumb. No account, no app, no printer."
	/>
	<!--
		JetBrains Mono carries the monospace accents on this page only. Loaded here
		rather than in app.html so the rest of the app does not pay for a
		third-party font request it never renders. `display=swap` keeps the page
		readable in the system monospace until it arrives.
	-->

	<link rel="preconnect" href="https://fonts.googleapis.com" />

	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />

	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
	/>
</svelte:head>

<div class="landing min-h-screen bg-base-100 text-base-content">
	<!--
		Hero: copy on the left, the signable phone on the right, so the demo is on
		the first screen. On a phone the order is copy, phone, then the prompt.
	-->
	<section
		class="mx-auto grid max-w-6xl grid-cols-1 gap-x-12 gap-y-10 px-6 pt-12 pb-20 md:pt-16 lg:grid-cols-[1fr_390px] lg:items-start"
	>
		<div class="lg:pt-6">
			<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">
				E-sign · $20 a month, flat
			</p>

			<h1 class="mt-5 text-3xl leading-[1.15] font-semibold tracking-tight md:text-5xl">
				Your AI wrote the contract. Your client signs it on their phone.
			</h1>

			<p class="mt-6 max-w-xl text-lg leading-relaxed text-base-content/70">
				$20 a month, flat. No envelopes, no seats, no per-document fees. Clients open a link and
				sign with a thumb. No account, no app, no printer.
			</p>

			<div class="mt-8 flex flex-wrap items-center gap-5">
				<a
					href={signupHref}
					class="border border-base-content bg-base-content px-6 py-3 font-mono text-sm text-base-100 transition-colors hover:bg-transparent hover:text-base-content"
				>
					Start for $20/mo →
				</a>
				<span class="font-mono text-xs text-base-content/50"
					>Cancel anytime. No yearly contract.</span
				>
			</div>
		</div>

		<div class="lg:row-span-2">
			<SignPlayground />
		</div>

		<!-- What the user typed to get the proposal on the phone -->
		<div class="max-w-xl">
			<p class="font-mono text-[11px] tracking-wide text-base-content/50 uppercase">
				You typed this into Claude
			</p>
			<p class="mt-2 border border-base-content/15 bg-base-200 p-4 text-[15px] leading-relaxed">
				Write a proposal for Acme Co: a 4-page site with a blog. $11,000, six weeks, half up front.
				Jordan Lee signs.
			</p>
			<p class="mt-2 text-sm text-base-content/60">It sent back the link on the right.</p>
		</div>
	</section>

	<!-- Old way vs mdpubs way -->
	<section class="border-y border-base-content/15">
		<div class="mx-auto grid max-w-6xl gap-px bg-base-content/15 md:grid-cols-2">
			<div class="bg-base-100 px-6 py-12 md:px-10">
				<p class="font-mono text-xs tracking-widest text-base-content/40 uppercase">
					The usual e-sign tool
				</p>
				<h2 class="mt-4 text-2xl font-semibold tracking-tight text-base-content/60">
					Priced per envelope, billed per year
				</h2>
				<ul class="mt-6 space-y-4 text-base-content/60">
					{#each oldWay as item, i (item)}
						<li class="flex gap-3">
							<span class="font-mono text-base-content/30">0{i + 1}</span>
							<span>{item}</span>
						</li>
					{/each}
				</ul>
			</div>

			<div class="bg-base-100 px-6 py-12 md:px-10">
				<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">
					The mdpubs way
				</p>
				<h2 class="mt-4 text-2xl font-semibold tracking-tight">One price. One link.</h2>
				<ul class="mt-6 space-y-4 text-base-content/80">
					{#each newWay as item, i (item)}
						<li class="flex gap-3">
							<span class="font-mono text-base-content/40">0{i + 1}</span>
							<span>{item}</span>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	</section>

	<!-- Setup: one path for terminal agents, one for the web apps -->
	<section class="mx-auto max-w-6xl px-6 py-20">
		<h2 class="text-2xl font-semibold tracking-tight md:text-3xl">Set up in a minute</h2>
		<p class="mt-3 max-w-xl text-base-content/70">
			Use the AI you already have. Three steps either way, and no API key to copy.
		</p>

		<div class="mt-10 grid gap-px border border-base-content/15 bg-base-content/15 md:grid-cols-2">
			{#each setupPaths as path (path.name)}
				<div class="bg-base-100 p-6 md:p-8">
					<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">
						{path.name}
					</p>
					<ol class="mt-6 space-y-6">
						<li class="flex gap-4">
							<span class="font-mono text-sm text-base-content/40">01</span>
							<div class="min-w-0 flex-1">
								<p>{path.first}</p>
								<code
									class="mt-2 block overflow-x-auto border border-base-content/15 bg-base-200 p-3 font-mono text-xs whitespace-nowrap select-all"
									>{path.paste}</code
								>
							</div>
						</li>
						<li class="flex gap-4">
							<span class="font-mono text-sm text-base-content/40">02</span>
							<p>{path.second}</p>
						</li>
						<li class="flex gap-4">
							<span class="font-mono text-sm text-base-content/40">03</span>
							<p>Ask for it: <em>"Write Acme a proposal and make it signable."</em></p>
						</li>
					</ol>
				</div>
			{/each}
		</div>
	</section>

	<!-- Pricing -->
	<section id="pricing" class="border-t border-base-content/15 bg-base-200">
		<div class="mx-auto max-w-6xl px-6 py-20">
			<h2 class="text-2xl font-semibold tracking-tight md:text-3xl">Pricing</h2>
			<p class="mt-3 max-w-xl text-base-content/70">One signed proposal pays for a year of it.</p>

			<div
				class="mt-10 grid gap-px border border-base-content/15 bg-base-content/15 md:grid-cols-2"
			>
				<div class="flex flex-col bg-base-100 p-8">
					<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">Monthly</p>
					<p class="mt-4 text-4xl font-semibold tracking-tight">
						$20<span class="font-mono text-base font-normal text-base-content/50">/mo</span>
					</p>
					<p class="mt-2 font-mono text-xs text-base-content/50">Billed monthly. Cancel anytime.</p>
					<ul class="mt-6 flex-1 space-y-3 text-sm text-base-content/80">
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> No envelope caps, no seat fees
						</li>
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> Locked once signed
						</li>
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> Audit log of every view and signature
						</li>
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> Custom branded domain
						</li>
						<li class="flex gap-3"><span class="text-base-content/40">—</span> Parallel signers</li>
					</ul>
					<a
						href={signupHref}
						class="mt-8 border border-base-content px-6 py-3 text-center font-mono text-sm transition-colors hover:bg-base-content hover:text-base-100"
					>
						Start monthly
					</a>
				</div>

				<div class="flex flex-col bg-base-100 p-8">
					<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">Annual</p>
					<p class="mt-4 text-4xl font-semibold tracking-tight">
						$190<span class="font-mono text-base font-normal text-base-content/50">/yr</span>
					</p>
					<!-- $20 x 12 = $240, so $190 is $50 off. Stated as the saving rather than
						 "N months free", which would not be a whole number of months. -->
					<p class="mt-2 font-mono text-xs text-base-content/50">
						Save $50 against paying monthly.
					</p>
					<ul class="mt-6 flex-1 space-y-3 text-sm text-base-content/80">
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> Everything in monthly
						</li>
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> One invoice a year
						</li>
					</ul>
					<a
						href={signupHref}
						class="mt-8 border border-base-content bg-base-content px-6 py-3 text-center font-mono text-sm text-base-100 transition-colors hover:bg-transparent hover:text-base-content"
					>
						Start annual
					</a>
				</div>
			</div>
		</div>
	</section>

	<!-- Closing CTA -->
	<section class="mx-auto max-w-6xl px-6 py-20 text-center">
		<h2 class="text-2xl font-semibold tracking-tight md:text-3xl">
			Your next contract is one prompt.
		</h2>
		<a
			href={signupHref}
			class="mt-8 inline-block border border-base-content bg-base-content px-8 py-3 font-mono text-sm text-base-100 transition-colors hover:bg-transparent hover:text-base-content"
		>
			Start for $20/mo →
		</a>
	</section>

	<footer class="border-t border-base-content/15">
		<div
			class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 font-mono text-xs text-base-content/50"
		>
			<p>
				&copy; {new Date().getFullYear()} MdPubs, built by

				<a href="https://x.com/me_sshawn" target="_blank" class="underline underline-offset-4"
					>Shawn</a
				>

				.
			</p>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={config.git} class="underline underline-offset-4">Docs</a>
		</div>
	</footer>
</div>

<style>
	/*
		Scope JetBrains Mono to this page's monospace accents. Setting it on the
		Tailwind theme would repoint `font-mono` across the whole app, including the
		code blocks and API keys in the dashboard, which do not load the font.
		`:global` is needed because the rule has to reach the child component's
		monospace text too.
	*/
	.landing :global(.font-mono),
	.landing :global(code),
	.landing :global(pre) {
		font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
	}
</style>
