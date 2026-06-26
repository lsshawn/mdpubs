<script lang="ts">
	import { config } from '$lib/config';
	import { resolve } from '$app/paths';

	import { Code, FileText, Globe } from 'lucide-svelte';
</script>

<div class="min-h-screen bg-base-100 text-base-content">
	<section class="container mx-auto px-4 py-4 text-center md:py-16">
		<h1
			class="mx-auto mb-6 text-3xl leading-tight font-bold text-base-content md:max-w-4xl md:text-5xl"
		>
			{config.description}
		</h1>

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

		<div class="mx-auto max-w-xl">
			<a
				role="button"
				class="btn btn-primary btn-lg border-none px-12 py-6 text-xl shadow-lg"
				href={resolve('/login')}>Get Your Free API Key</a
			>

			{@render ctaFootnote()}

			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={config.git} class="text-base-content/60 underline"
				>Documentation and Plugin Install Guide</a
			>
		</div>
	</section>

	<!-- Features Section -->
	<section class="container min-w-full bg-base-200 px-10 py-16">
		<h2 class="text-center text-3xl font-bold text-base-content">Built for Neovim Users</h2>
		<div class="mt-12 grid gap-8 md:grid-cols-3">
			<div class="card justify-start border border-base-300 bg-base-100 text-center shadow-lg">
				<div class="card-body grow-0 items-center">
					<Code class="mx-auto mb-4 h-12 w-12 text-primary" />
					<h2 class="card-title justify-center text-base-content">Install Plugin in Neovim</h2>
					<p class="mt-2 text-base-content/70">
						<a href="https://github.com/lsshawn/mdpubs.nvim" class="underline">Github Repo</a>
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

			<div class="card justify-start border border-base-300 bg-base-100 text-center shadow-lg">
				<div class="card-body grow-0 items-center">
					<FileText class="mx-auto mb-4 h-12 w-12 text-primary" />
					<h2 class="card-title justify-center text-base-content">Add to Frontmatter</h2>
					<p class="mt-2 text-base-content/70">
						Add <code class="text-green-400">mdpubs:</code> to the frontmatter of your markdown.
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
					<Globe class="mx-auto mb-4 h-12 w-12 text-primary" />
					<h2 class="card-title justify-center text-base-content">Instant Publishing</h2>
					<p class="mt-2 text-base-content/70">
						Your content is live immediately at https://mdpubs.com/[note_id].
					</p>
					<img src="/sample-published-page.webp" />
				</div>
			</div>
		</div>
		<!-- <div class="mt-8 text-center italic">Coming soon: Obsidian</div> -->
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
