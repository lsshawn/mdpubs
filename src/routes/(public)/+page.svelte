<script lang="ts">
	import { config } from '$lib/config';
	import { resolve } from '$app/paths';
	import SignPlayground from '$lib/components/SignPlayground.svelte';

	/**
	 * Both pricing CTAs go to signup rather than straight to Stripe. The app has a
	 * single Stripe payment link configured (config.stripePaymentLinks), not one
	 * per tier, and wiring a second link would mean a new config entry — an
	 * owner's call. Signup is the step a visitor has to take first anyway.
	 */
	const signupHref = resolve('/login');
</script>

<svelte:head>
	<title>MdPubs — e-sign proposals from plain Markdown</title>
	<meta
		name="description"
		content="Send client proposals they can sign on a phone. Write Markdown, drop a signature anchor, share a link."
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
	<!-- Hero -->
	<section class="mx-auto max-w-6xl px-6 pt-16 pb-10 md:pt-24">
		<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">
			Markdown → signed document
		</p>
		<h1 class="mt-5 max-w-3xl text-3xl leading-[1.15] font-semibold tracking-tight md:text-5xl">
			Send client proposals they can actually sign on a phone. From plain Markdown.
		</h1>
		<p class="mt-6 max-w-2xl text-lg leading-relaxed text-base-content/70">
			Stop exporting ugly PDFs and paying $40/mo for DocuSign bloat. Drop a signature anchor and get
			a clean, phone-first e-sign link in seconds.
		</p>
		<div class="mt-8 flex flex-wrap items-center gap-5">
			<a
				href="#playground"
				class="border border-base-content bg-base-content px-6 py-3 font-mono text-sm text-base-100 transition-colors hover:bg-transparent hover:text-base-content"
			>
				Try with Your Markdown →
			</a>
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				href={config.git}
				class="font-mono text-sm text-base-content/60 underline underline-offset-4 hover:text-base-content"
			>
				API &amp; Neovim plugin
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</section>

	<!-- Split interactive playground -->
	<section id="playground" class="mx-auto max-w-6xl scroll-mt-8 px-6 pb-20">
		<SignPlayground />
	</section>

	<!-- Old way vs mdpubs way -->
	<section class="border-y border-base-content/15">
		<div class="mx-auto grid max-w-6xl gap-px bg-base-content/15 md:grid-cols-2">
			<div class="bg-base-100 px-6 py-12 md:px-10">
				<p class="font-mono text-xs tracking-widest text-base-content/40 uppercase">The old way</p>
				<h2 class="mt-4 text-2xl font-semibold tracking-tight text-base-content/60">
					A PDF, pinched to read
				</h2>
				<ul class="mt-6 space-y-4 text-base-content/60">
					<li class="flex gap-3">
						<span class="font-mono text-base-content/30">01</span>
						<span>Export to PDF. The layout breaks on the first phone that opens it.</span>
					</li>
					<li class="flex gap-3">
						<span class="font-mono text-base-content/30">02</span>
						<span>Your client pinches and drags around an A4 page on a 390px screen.</span>
					</li>
					<li class="flex gap-3">
						<span class="font-mono text-base-content/30">03</span>
						<span>They give up, print it, sign it, scan it — or find a printer on Monday.</span>
					</li>
					<li class="flex gap-3">
						<span class="font-mono text-base-content/30">04</span>
						<span>Four days pass before you hear back.</span>
					</li>
				</ul>
			</div>

			<div class="bg-base-100 px-6 py-12 md:px-10">
				<p class="font-mono text-xs tracking-widest text-base-content/50 uppercase">
					The mdpubs way
				</p>
				<h2 class="mt-4 text-2xl font-semibold tracking-tight">A web page, built for 390px</h2>
				<ul class="mt-6 space-y-4 text-base-content/80">
					<li class="flex gap-3">
						<span class="font-mono text-base-content/40">01</span>
						<span>Write Markdown. Publish it as a responsive document at a shareable URL.</span>
					</li>
					<li class="flex gap-3">
						<span class="font-mono text-base-content/40">02</span>
						<span>Headings become a table of contents automatically. Tables scroll, not clip.</span>
					</li>
					<li class="flex gap-3">
						<span class="font-mono text-base-content/40">03</span>
						<span>Your client taps the signature box and draws with a thumb.</span>
					</li>
					<li class="flex gap-3">
						<span class="font-mono text-base-content/40">04</span>
						<span>Signed in 8 seconds, on the phone they already had open.</span>
					</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- How it works -->
	<section class="mx-auto max-w-6xl px-6 py-20">
		<h2 class="text-2xl font-semibold tracking-tight md:text-3xl">Three lines of Markdown</h2>
		<div class="mt-10 grid gap-px border border-base-content/15 bg-base-content/15 md:grid-cols-3">
			<div class="bg-base-100 p-6">
				<p class="font-mono text-xs text-base-content/40">01</p>
				<h3 class="mt-3 font-semibold">Turn signing on</h3>
				<p class="mt-2 text-sm text-base-content/70">
					One frontmatter flag makes any published document signable.
				</p>
				<pre class="mt-4 overflow-x-auto border border-base-content/15 p-3 font-mono text-xs"><code
						>{`---
mdpubs:
sign: true
---`}</code
					></pre>
			</div>
			<div class="bg-base-100 p-6">
				<p class="font-mono text-xs text-base-content/40">02</p>
				<h3 class="mt-3 font-semibold">Drop an anchor</h3>
				<p class="mt-2 text-sm text-base-content/70">
					Put the signature box exactly where it belongs in the document.
				</p>
				<pre class="mt-4 overflow-x-auto border border-base-content/15 p-3 font-mono text-xs"><code
						>{`<!-- mdpubs-sign-here:
     Client Name -->`}</code
					></pre>
			</div>
			<div class="bg-base-100 p-6">
				<p class="font-mono text-xs text-base-content/40">03</p>
				<h3 class="mt-3 font-semibold">Send the link</h3>
				<p class="mt-2 text-sm text-base-content/70">
					No account for signers. Each signature binds to a hash of the signed content, and the
					document locks once signed.
				</p>
				<pre class="mt-4 overflow-x-auto border border-base-content/15 p-3 font-mono text-xs"><code
						>mdpubs.com/abc123</code
					></pre>
			</div>
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
							<span class="text-base-content/40">—</span> Unlimited signable proposals
						</li>
						<li class="flex gap-3">
							<span class="text-base-content/40">—</span> Signature lock: the document freezes once signed
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
			Your next proposal is a Markdown file.
		</h2>
		<a
			href={signupHref}
			class="mt-8 inline-block border border-base-content bg-base-content px-8 py-3 font-mono text-sm text-base-100 transition-colors hover:bg-transparent hover:text-base-content"
		>
			Get your API key →
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
				>.
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
