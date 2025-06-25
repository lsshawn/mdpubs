<script lang="ts">
	import {
		Pencil,
		Mail,
		MessageCircle,
		Calendar,
		Zap,
		Shield,
		Code,
		FileText,
		Globe
	} from 'lucide-svelte';

	let deliveryMethod = $state('email');
	let twitterInput = $state('');
	let email = $state('');
	let telegram = $state('');

	function handleSubmit() {
		// Handle form submission and redirect to Stripe
		console.log({
			twitterInput,
			deliveryMethod,
			email: deliveryMethod === 'email' ? email : '',
			telegram: deliveryMethod === 'telegram' ? telegram : ''
		});
		// On success, you can programmatically close the modal like this:
		// (document.getElementById('subscribe_modal') as HTMLDialogElement).close();
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white">
	<!-- Header -->
	<header class="container mx-auto px-4 py-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center space-x-2">
				<Pencil class="h-8 w-8 text-blue-400" />
				<span class="text-2xl font-bold text-white">NeoNote</span>
			</div>
		</div>
	</header>

	<!-- Hero Section -->
	<section class="container mx-auto px-4 py-16 text-center">
		<h1 class="mb-6 text-5xl leading-tight font-bold text-white">Publish Markdown From Neovim</h1>

		<p class="mx-auto mb-12 max-w-3xl text-xl text-gray-300">
			Transform your local markdown files into beautiful, shareable web pages with a simple API.
			Perfect for developers who want to publish documentation, blogs, or notes instantly.
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
					<span class="text-sm text-gray-400">README.md</span>
				</div>
				<div class="p-6 text-left">
					<pre class="font-mono text-sm leading-relaxed text-green-400"><code
							>---
title: "My Awesome Project"
// 👇 just add these two lines to your frontmatter
neonote:  
neonote-is-public: true
---

This markdown file will be instantly available at:
https://neonote.sshawn.com/public/[your-neonote-id]

</code></pre>
				</div>
			</div>
		</div>

		<!-- Simplified Main CTA -->
		<div class="mx-auto max-w-xl">
			<!-- Open the modal using ID.showModal() method -->
			<button
				class="btn btn-lg border-none bg-blue-600 px-12 py-6 text-xl text-white shadow-lg hover:bg-blue-700"
				onclick={() => subscribe_modal.showModal()}>Get Your Free API Key</button
			>

			<p class="mt-4 text-gray-400">Free tier: 5 publishable markdown files, unlimited views.</p>

			<dialog id="subscribe_modal" class="modal">
				<div class="modal-box max-w-2xl border border-gray-700 bg-gray-800 text-white">
					<form method="dialog">
						<button
							class="btn btn-circle btn-ghost btn-sm absolute top-2 right-2 text-gray-400 hover:text-white"
							>✕</button
						>
					</form>
					<h3 class="text-2xl font-bold text-white">Get Started with NeoNote</h3>
					<p class="py-4 text-gray-300">
						Sign up to get your API key and start publishing markdown files instantly
					</p>

					<form onsubmit={handleSubmit} class="mt-4 space-y-6">
						<!-- Email Input -->
						<div class="form-control w-full">
							<label for="email-input" class="label">
								<span class="label-text text-gray-300">Email Address</span>
							</label>
							<input
								type="email"
								id="email-input"
								placeholder="your@email.com"
								bind:value={email}
								class="input input-bordered w-full border-gray-600 bg-gray-700 text-lg text-white placeholder-gray-400 focus:border-blue-500"
								required
							/>
						</div>

						<!-- Pricing and CTA -->
						<div
							class="rounded-lg border border-gray-600 bg-gradient-to-r from-gray-700 to-gray-600 p-6"
						>
							<div class="mb-4 text-center">
								<div class="mb-2 flex items-center justify-center space-x-2">
									<span class="text-3xl font-bold text-white">Free</span>
									<div class="badge border-none bg-green-600 text-white">Developer Tier</div>
								</div>
								<p class="text-sm text-gray-300">5 files • Unlimited views • Upgrade anytime</p>
							</div>

							<button
								type="submit"
								class="btn btn-lg w-full border-none bg-blue-600 py-3 text-lg text-white shadow-lg hover:bg-blue-700"
							>
								Get Free API Key
							</button>
						</div>
					</form>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button>close</button>
				</form>
			</dialog>
		</div>
	</section>

	<!-- Features Section -->
	<section class="container mx-auto bg-gray-800/50 px-4 py-16">
		<h2 class="text-center text-3xl font-bold text-white">Built for Neovim Users</h2>
		<div class="mt-12 grid gap-8 md:grid-cols-3">
			<div class="card border border-gray-700 bg-gray-800/50 text-center shadow-lg">
				<div class="card-body items-center">
					<Code class="mx-auto mb-4 h-12 w-12 text-blue-400" />
					<h2 class="card-title justify-center text-white">Simple API</h2>
					<p class="text-gray-300">
						Just add frontmatter to your markdown files. Our API handles the rest - no complex setup
						required.
					</p>
				</div>
			</div>

			<div class="card border border-gray-700 bg-gray-800/50 text-center shadow-lg">
				<div class="card-body items-center">
					<FileText class="mx-auto mb-4 h-12 w-12 text-blue-400" />
					<h2 class="card-title justify-center text-white">Markdown Native</h2>
					<p class="text-gray-300">
						Write in plain markdown. We render it beautifully with syntax highlighting, tables, and
						more.
					</p>
				</div>
			</div>

			<div class="card border border-gray-700 bg-gray-800/50 text-center shadow-lg">
				<div class="card-body items-center">
					<Globe class="mx-auto mb-4 h-12 w-12 text-blue-400" />
					<h2 class="card-title justify-center text-white">Instant Publishing</h2>
					<p class="text-gray-300">
						Your content is live immediately. Perfect for documentation, blogs, or sharing quick
						notes.
					</p>
				</div>
			</div>
		</div>
		<div class="mt-8 text-center italic">Coming soon: Obsidian</div>
	</section>

	<!-- Footer -->
	<footer class="border-t border-gray-800 bg-gray-900 py-12 text-white">
		<div class="container mx-auto flex justify-between px-4">
			<div class="text-sm text-gray-400">
				<p>
					&copy; {new Date().getFullYear()} NeoNote, built by
					<a
						href="https://x.com/me_sshawn"
						target="_blank"
						class="text-blue-400 hover:text-blue-300">Shawn</a
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
