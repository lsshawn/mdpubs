<script lang="ts">
	import { config } from '$lib/config';
	import { resolve } from '$app/paths';

	import Icon from '@iconify/svelte';
</script>

<div class="min-h-screen bg-base-100 text-base-content">
	<!-- ATTENTION -->
	<section class="container mx-auto px-4 py-8 text-center md:py-16">
		<p class="mb-4 font-mono text-sm tracking-wide text-primary">Markdown → public web page, instantly</p>
		<h1
			class="mx-auto mb-6 text-3xl leading-tight font-bold text-base-content md:max-w-4xl md:text-5xl"
		>
			Let your AI publish markdown to the web
		</h1>

		<!-- INTEREST -->
		<p class="mx-auto mb-12 max-w-xl text-lg text-base-content/70">
			Publish-to-web for your markdown, built for agents. Drop one line of
			frontmatter and any file goes live at a shareable URL — no copy-paste, no CMS.
		</p>

		<!-- Code Example -->
		<div class="mx-auto mb-12 max-w-2xl">
			<div class="rounded-lg border border-gray-700 bg-gray-800 shadow-2xl">
				<div
					class="flex items-center justify-between rounded-t-lg border-b border-gray-600 bg-gray-700 px-4 py-2"
				>
					<div class="flex items-center space-x-2">
						<div class="h-3 w-3 rounded-full bg-red-500"></div>
						<div class="h-3 w-3 rounded-full bg-yellow-500"></div>
						<div class="h-3 w-3 rounded-full bg-green-500"></div>
					</div>
					<span class="text-sm text-gray-400">.md</span>
				</div>
				<div class="p-6 text-left">
					<pre class="font-mono text-sm leading-relaxed text-wrap text-green-400"><code
							>---
title: "My Note"
// 👇 just add this to publish
mdpubs:
---

This markdown file will be instantly available at:
https://mdpubs.com/[id]

</code></pre>
				</div>
			</div>
		</div>

		<!-- ACTION -->
		<div class="mx-auto max-w-xl">
			<a
				role="button"
				class="btn btn-primary btn-lg border-none px-12 py-6 text-xl shadow-lg"
				href={resolve('/login')}>Get Your Free API Key</a
			>

			{@render ctaFootnote()}

			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={config.git} class="text-base-content/60 underline">API & plugin docs</a>
		</div>
	</section>

	<!-- DESIRE -->
	<section class="container min-w-full bg-base-200 px-10 py-16">
		<h2 class="text-center text-3xl font-bold text-base-content">Publishing as a single API call</h2>
		<p class="mx-auto mt-3 max-w-xl text-center text-base-content/70">
			Hand your agent an API key. It writes markdown, MdPubs hosts it — clean, fast, public.
		</p>
		<div class="mt-12 grid gap-8 md:grid-cols-3">
			<div class="card justify-start border border-base-300 bg-base-100 text-center shadow-lg">
				<div class="card-body grow-0 items-center">
					<Icon icon="ph:robot" class="mx-auto mb-4 h-12 w-12 text-primary" />
					<h2 class="card-title justify-center text-base-content">Built for AI</h2>
					<p class="mt-2 text-base-content/70">
						One frontmatter flag and a simple API. No browser, no CMS dashboard — exactly the
						interface an agent wants.
					</p>
					<pre
						class="w-full overflow-x-auto rounded-md bg-gray-900 p-4 text-left font-mono text-sm text-green-400"><code
							>{`---
title: "My Note"
mdpubs:
---`}</code
						></pre>
				</div>
			</div>

			<div class="card justify-start border border-base-300 bg-base-100 text-center shadow-lg">
				<div class="card-body grow-0 items-center">
					<Icon icon="ph:globe" class="mx-auto mb-4 h-12 w-12 text-primary" />
					<h2 class="card-title justify-center text-base-content">Live in a second</h2>
					<p class="mt-2 text-base-content/70">
						Your content is online immediately at a clean, shareable
						<code class="text-green-400">mdpubs.com/[id]</code>.
					</p>
					<img src="/sample-published-page.webp" alt="A published MdPubs page" />
				</div>
			</div>

			<div class="card justify-start border border-base-300 bg-base-100 text-center shadow-lg">
				<div class="card-body grow-0 items-center">
					<Icon icon="ph:terminal-window" class="mx-auto mb-4 h-12 w-12 text-primary" />
					<h2 class="card-title justify-center text-base-content">Works from your editor too</h2>
					<p class="mt-2 text-base-content/70">
						Prefer to write yourself? The
						<a href="https://github.com/lsshawn/mdpubs.nvim" class="underline">Neovim plugin</a>
						publishes the file you're editing without leaving the buffer.
					</p>
					<pre
						class="w-full overflow-x-auto rounded-md bg-gray-900 p-4 text-left font-mono text-sm text-green-400"><code
							>{`  {
    "lsshawn/mdpubs.nvim",
    config = function()
      require("mdpubs").setup({
        api_key = "your_key",
      })
    end,
  }`}</code
						></pre>
				</div>
			</div>
		</div>
	</section>

	<!-- E-signing -->
	<section class="container mx-auto px-4 py-16 md:px-10">
		<p class="text-center font-mono text-sm tracking-wide text-primary">New</p>
		<h2 class="mt-2 text-center text-3xl font-bold text-base-content">
			Sign documents, no DocuSign
		</h2>
		<p class="mx-auto mt-3 max-w-2xl text-center text-base-content/70">
			Add one line to any HTML pub and it becomes a signable document. Share the link — each party
			draws their signature in the browser. No accounts for signers, no PDF export, no per-envelope
			fees.
		</p>

		<div class="mx-auto mt-12 grid max-w-5xl items-center gap-8 md:grid-cols-2">
			<!-- The one-line opt-in -->
			<div class="rounded-lg border border-base-300 bg-base-200 p-4 shadow-lg">
				<pre
					class="w-full overflow-x-auto rounded-md bg-gray-900 p-4 text-left font-mono text-sm text-green-400"><code
						>{`<!-- mdpubs-sign: true -->
<!-- mdpubs-signer: You <you@co.com> -->
<!-- mdpubs-signer-open: Other party -->
<!-- mdpubs-sign-order: sequential -->

<h1>Non-Disclosure Agreement</h1>
...`}</code
					></pre>
			</div>

			<!-- What you get -->
			<div class="grid gap-4">
				<div class="flex items-start gap-3">
					<Icon icon="ph:pencil-simple-line" class="mt-1 h-6 w-6 shrink-0 text-primary" />
					<div>
						<h3 class="font-semibold text-base-content">Draw-to-sign in the browser</h3>
						<p class="text-sm text-base-content/70">
							Signers type their name and draw a signature. Don't know the other party's email?
							Use an open slot — they fill in their own details. Sequential or parallel order.
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<Icon icon="ph:lock-key" class="mt-1 h-6 w-6 shrink-0 text-primary" />
					<div>
						<h3 class="font-semibold text-base-content">Tamper-evident</h3>
						<p class="text-sm text-base-content/70">
							Each signature binds to a SHA-256 of the exact signed content. Once signed, the
							document locks — no silent edits.
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<Icon icon="ph:list-checks" class="mt-1 h-6 w-6 shrink-0 text-primary" />
					<div>
						<h3 class="font-semibold text-base-content">Full audit trail</h3>
						<p class="text-sm text-base-content/70">
							Every view, signature, and completion is recorded with timestamp and IP. Download the
							signed document as a PDF.
						</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-base-300 bg-base-200 py-12 text-base-content">
		<div class="container mx-auto flex justify-between px-4">
			<div class="text-sm text-base-content/60">
				<p>
					&copy; {new Date().getFullYear()} MdPubs, built by
					<a
						href="https://x.com/me_sshawn"
						target="_blank"
						class="text-primary hover:underline">Shawn</a
					>.
				</p>
			</div>
			<div class="flex flex-col items-center justify-between md:flex-row">
				<div class="flex space-x-6 text-sm">
					<!-- <a href="#" class="hover:text-blue-400"> Privacy Policy </a> -->
					<!-- <a href="#" class="hover:text-blue-400"> Terms of Service </a> -->
					<!-- <a href="#" class="hover:text-blue-400"> Contact </a> -->
				</div>
			</div>
		</div>
	</footer>
</div>

{#snippet ctaFootnote()}
	<div class="my-4 text-center text-sm text-base-content/70">
		<p>Free tier: 5 publishable markdown files, unlimited views.</p>
		<p>For unlimited markdown files, it's $10 per month.</p>
	</div>
{/snippet}
