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

	/**
	 * The anchor shown in the subhead, as a string rather than inline markup.
	 *
	 * Two reasons. It is the anchor the parser actually matches
	 * (custom-components-parser.ts matches `mdpubs-sign-here`, not the bare
	 * `sign-here` shorthand), so the page is not advertising a syntax that
	 * silently renders as a comment and never produces a signing box. And writing
	 * it as a literal keeps the `-->` out of the template, where it would close
	 * the surrounding HTML comment early.
	 */
	const SIGN_ANCHOR = '<!-- mdpubs-sign-here -->';
</script>

<svelte:head>
	<title>MdPubs — sign proposals on a phone in 8 seconds, without DocuSign</title>
	<meta
		name="description"
		content="Write plain Markdown, add a sign-here anchor, and send an audit-locked contract your client signs on their phone. From $19/mo, not $40."
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

<div class="landing min-h-screen bg-base-200/50 text-base-content">
	<!--
		Hero: the headline and the card are one centred column, so the first screen
		is a single object rather than a left-aligned marketing page. max-w-3xl
		keeps the card the width of the document it contains.
	-->
	<section class="mx-auto max-w-3xl px-5 pt-14 pb-12 text-center md:pt-20">
		<p class="font-mono text-[11px] tracking-widest text-base-content/50 uppercase">
			Markdown → signed contract
		</p>
		<h1
			class="mx-auto mt-5 max-w-2xl text-[1.75rem] leading-[1.15] font-semibold tracking-tight md:text-[2.75rem]"
		>
			Proposals your clients can sign on a phone in 8 seconds. Without paying DocuSign $40/mo.
		</h1>
		<p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-base-content/70 md:text-lg">
			Write plain text. Add
			<code class="rounded bg-base-content/8 px-1.5 py-0.5 text-[0.85em] whitespace-nowrap"
				>{SIGN_ANCHOR}</code
			>. Get an audit-locked contract that never pinches or zooms on an iPhone.
		</p>

		<div class="mt-8 flex flex-col items-center gap-3">
			<a
				href="#playground"
				class="rounded-xl bg-base-content px-7 py-3.5 font-mono text-sm text-base-100 transition-opacity hover:opacity-85"
			>
				Drop in Markdown &amp; Get E-Sign Link →
			</a>
			<p class="font-mono text-[11px] text-base-content/50">
				No card required. First 3 signatures free.
			</p>
		</div>

		<!-- The card itself: tabs, live preview, one-tap signing. -->
		<div id="playground" class="mt-10 scroll-mt-6 text-left">
			<SignPlayground />
		</div>

		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={config.git}
			class="mt-5 inline-block font-mono text-[12px] text-base-content/50 underline underline-offset-4 hover:text-base-content"
		>
			API &amp; Neovim plugin
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</section>

	<!--
		The two ways this goes, side by side. Red carries the old way because the
		cost there is a stalled deal, not a style preference.
	-->
	<section class="mx-auto max-w-3xl px-5 pb-16">
		<div class="grid gap-4 md:grid-cols-2">
			<div class="rounded-2xl border border-error/30 bg-error/5 p-6">
				<p class="font-mono text-[11px] tracking-widest text-error/80 uppercase">The old way</p>
				<h2 class="mt-3 text-lg font-semibold tracking-tight">A PDF, pinched to read</h2>

				<!-- A4 at 390px: the shape of the problem, not a screenshot of it. -->
				<div
					class="mt-5 flex h-36 items-center justify-center rounded-xl border border-error/20 bg-base-100"
				>
					<div
						class="w-14 rounded-sm border border-base-content/20 bg-white px-1.5 py-2 shadow-sm"
						aria-hidden="true"
					>
						<div class="h-1 w-8 rounded-full bg-base-content/40"></div>
						<div class="mt-1.5 space-y-[3px]">
							<!-- Nine ruled lines: body text too small to read at this scale. -->
							{#each Array.from({ length: 9 }, (_, i) => i) as i (i)}
								<div class="h-[2px] rounded-full bg-base-content/15"></div>
							{/each}
						</div>
					</div>
				</div>
				<p class="mt-2 text-center font-mono text-[10px] text-base-content/50">
					A4 on a 390px screen. Unreadable without zooming.
				</p>

				<!-- The text that actually costs you the week. -->
				<div class="mt-5 max-w-[16rem] rounded-2xl rounded-bl-sm bg-base-content/8 px-4 py-2.5">
					<p class="text-sm leading-snug">“Will sign on Monday from my laptop”</p>
				</div>
				<p class="mt-2 font-mono text-[11px] font-medium text-error">4 days lost.</p>
			</div>

			<div class="rounded-2xl border border-base-content/15 bg-base-100 p-6 shadow-sm">
				<p class="font-mono text-[11px] tracking-widest text-base-content/50 uppercase">mdpubs</p>
				<h2 class="mt-3 text-lg font-semibold tracking-tight">A page built for 390px</h2>

				<div
					class="mt-5 flex h-36 items-center justify-center rounded-xl border border-base-content/10 bg-base-200/60"
				>
					<div
						class="w-[5.5rem] rounded-lg border border-base-content/20 bg-white px-2 py-2 shadow-sm"
						aria-hidden="true"
					>
						<div class="h-1.5 w-10 rounded-full bg-base-content/50"></div>
						<div class="mt-2 space-y-1">
							<div class="h-[3px] w-full rounded-full bg-base-content/15"></div>
							<div class="h-[3px] w-11/12 rounded-full bg-base-content/15"></div>
							<div class="h-[3px] w-10/12 rounded-full bg-base-content/15"></div>
						</div>
						<div
							class="mt-2 rounded border border-dashed border-base-content/50 py-1 text-center text-[7px] font-medium"
						>
							Sign Now
						</div>
					</div>
				</div>
				<p class="mt-2 text-center font-mono text-[10px] text-base-content/50">
					Mobile-first. Full width, no zooming.
				</p>

				<ul class="mt-5 space-y-2.5 text-sm text-base-content/80">
					<li class="flex gap-2.5">
						<span class="text-success">✓</span> Table of contents built from your headings
					</li>
					<li class="flex gap-2.5"><span class="text-success">✓</span> Tables scroll, not clip</li>
					<li class="flex gap-2.5">
						<span class="text-success">✓</span> Thumb-drawn signature, no app to install
					</li>
				</ul>
				<p class="mt-4 font-mono text-[11px] font-medium text-success">Signed in 8 seconds.</p>
			</div>
		</div>
	</section>

	<!-- How it works: three steps, one line of markdown each. -->
	<section class="mx-auto max-w-3xl px-5 pb-16">
		<h2 class="text-center text-xl font-semibold tracking-tight">Three lines of Markdown</h2>
		<div class="mt-6 grid gap-3 md:grid-cols-3">
			<div class="rounded-2xl border border-base-content/15 bg-base-100 p-5">
				<p class="font-mono text-[11px] text-base-content/40">01</p>
				<h3 class="mt-2 text-sm font-semibold">Turn signing on</h3>
				<pre class="mt-3 overflow-x-auto rounded-lg bg-base-200/70 p-3 font-mono text-[11px]"><code
						>{`---
mdpubs:
  sign: true
---`}</code
					></pre>
			</div>
			<div class="rounded-2xl border border-base-content/15 bg-base-100 p-5">
				<p class="font-mono text-[11px] text-base-content/40">02</p>
				<h3 class="mt-2 text-sm font-semibold">Drop an anchor</h3>
				<pre class="mt-3 overflow-x-auto rounded-lg bg-base-200/70 p-3 font-mono text-[11px]"><code
						>{`<!-- mdpubs-sign-here:
     Client Name -->`}</code
					></pre>
			</div>
			<div class="rounded-2xl border border-base-content/15 bg-base-100 p-5">
				<p class="font-mono text-[11px] text-base-content/40">03</p>
				<h3 class="mt-2 text-sm font-semibold">Send the link</h3>
				<pre class="mt-3 overflow-x-auto rounded-lg bg-base-200/70 p-3 font-mono text-[11px]"><code
						>mdpubs.com/abc123</code
					></pre>
			</div>
		</div>
		<p class="mt-4 text-center text-sm text-base-content/60">
			No account for signers. Each signature binds to a hash of the signed content, and the document
			locks once signed.
		</p>
	</section>

	<!-- Pricing: two tiers, the branded domain is what separates them. -->
	<section id="pricing" class="mx-auto max-w-3xl px-5 pb-16">
		<h2 class="text-center text-xl font-semibold tracking-tight">Pricing</h2>
		<p class="mt-2 text-center text-sm text-base-content/60">
			One signed proposal pays for the year.
		</p>

		<div class="mt-6 grid gap-3 md:grid-cols-2">
			<div class="flex flex-col rounded-2xl border border-base-content/15 bg-base-100 p-6">
				<p class="font-mono text-[11px] tracking-widest text-base-content/50 uppercase">Solo</p>
				<p class="mt-3 text-3xl font-semibold tracking-tight">
					$19<span class="font-mono text-sm font-normal text-base-content/50">/mo</span>
				</p>
				<ul class="mt-5 flex-1 space-y-2.5 text-sm text-base-content/80">
					<li class="flex gap-2.5">
						<span class="text-base-content/35">—</span> Unlimited signable proposals
					</li>
					<li class="flex gap-2.5">
						<span class="text-base-content/35">—</span> Audit log of every view and signature
					</li>
					<li class="flex gap-2.5">
						<span class="text-base-content/35">—</span> Locked SHA hash of the signed content
					</li>
				</ul>
				<a
					href={signupHref}
					class="mt-6 rounded-xl border border-base-content px-6 py-2.5 text-center font-mono text-sm transition-colors hover:bg-base-content hover:text-base-100"
				>
					Start Solo
				</a>
			</div>

			<div class="flex flex-col rounded-2xl border border-base-content bg-base-100 p-6 shadow-sm">
				<p class="font-mono text-[11px] tracking-widest text-base-content/50 uppercase">Studio</p>
				<p class="mt-3 text-3xl font-semibold tracking-tight">
					$49<span class="font-mono text-sm font-normal text-base-content/50">/mo</span>
				</p>
				<ul class="mt-5 flex-1 space-y-2.5 text-sm text-base-content/80">
					<li class="flex gap-2.5">
						<span class="text-base-content/35">—</span> Everything in Solo
					</li>
					<!--
						The label and the example domain are one flex item, not two, so the
						domain wraps with the sentence instead of being pushed onto its own
						line beside it.
					-->
					<li class="flex gap-2.5">
						<span class="text-base-content/35">—</span>
						<span>
							Custom branded domain, e.g.
							<span class="font-mono text-[0.9em]">doc.yourcompany.com</span>
						</span>
					</li>
				</ul>
				<a
					href={signupHref}
					class="mt-6 rounded-xl bg-base-content px-6 py-2.5 text-center font-mono text-sm text-base-100 transition-opacity hover:opacity-85"
				>
					Start Studio
				</a>
			</div>
		</div>
	</section>

	<!-- Closing CTA -->
	<section class="mx-auto max-w-3xl px-5 pb-20 text-center">
		<h2 class="text-xl font-semibold tracking-tight md:text-2xl">
			Your next proposal is a Markdown file.
		</h2>
		<a
			href={signupHref}
			class="mt-6 inline-block rounded-xl bg-base-content px-7 py-3 font-mono text-sm text-base-100 transition-opacity hover:opacity-85"
		>
			Drop in Markdown &amp; Get E-Sign Link →
		</a>
		<p class="mt-3 font-mono text-[11px] text-base-content/50">
			No card required. First 3 signatures free.
		</p>
	</section>

	<footer class="border-t border-base-content/15">
		<div
			class="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-4 px-5 py-8 font-mono text-[11px] text-base-content/50"
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
