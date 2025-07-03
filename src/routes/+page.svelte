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

	let email = $state('');
	let otp = $state('');
	let modalStep = $state<'email' | 'otp' | 'success'>('email');
	let apiKey = $state('');
	let readOnlyApiKey = $state('');
	let apiKeyCopyText = $state('Copy');
	let readOnlyApiKeyCopyText = $state('Copy');
	let error = $state('');
	let isLoading = $state(false);

	async function handleSubmitEmail() {
		isLoading = true;
		error = '';

		if (email === 'sub@sshawn.com') {
			setTimeout(() => {
				// Mock API call
				modalStep = 'otp';
				isLoading = false;
			}, 500);
			return;
		}

		try {
			const res = await fetch('http://localhost:1323/users', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ email })
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.message || 'Failed to send OTP.');
			}
			modalStep = 'otp';
		} catch (e: any) {
			error = e.message;
		} finally {
			isLoading = false;
		}
	}

	async function handleResendOtp() {
		isLoading = true;
		error = '';

		if (email === 'sub@sshawn.com') {
			setTimeout(() => {
				// Mock API call, just show loading and finish
				isLoading = false;
			}, 500);
			return;
		}

		try {
			const res = await fetch('http://localhost:1323/users/resend', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ email })
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.message || 'Failed to resend OTP.');
			}
			// Maybe show a small success message here. For now, nothing.
		} catch (e: any) {
			error = e.message;
		} finally {
			isLoading = false;
		}
	}

	async function handleSubmitOtp() {
		isLoading = true;
		error = '';

		if (email === 'sub@sshawn.com') {
			setTimeout(() => {
				if (otp === '888888') {
					apiKey = 'MOCK_API_KEY_329380ce64f4b0a8c9ef0c7e529c17ec71a4d57a6ab3d9ba56bf7b107873de18';
					readOnlyApiKey =
						'MOCK_RO_KEY_ro_005b021b55bcf2f70c9db6d1ded201eb0b93aee03b5d376c368cc7b3f254ccd5';
					modalStep = 'success';
				} else {
					error = 'Invalid OTP.';
				}
				isLoading = false;
			}, 500);
			return;
		}

		try {
			const res = await fetch('http://localhost:1323/users/activate', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ email, otp })
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.message || 'Invalid OTP.');
			}
			const data = await res.json();
			apiKey = data.api_key;
			readOnlyApiKey = data.read_only_api_key;
			modalStep = 'success';
		} catch (e: any) {
			error = e.message;
		} finally {
			isLoading = false;
		}
	}

	function resetModal() {
		email = '';
		otp = '';
		modalStep = 'email';
		apiKey = '';
		readOnlyApiKey = '';
		error = '';
		isLoading = false;
		apiKeyCopyText = 'Copy';
		readOnlyApiKeyCopyText = 'Copy';
	}

	function openModal() {
		resetModal();
		(document.getElementById('subscribe_modal') as HTMLDialogElement).showModal();
	}

	function copyToClipboard(text: string, keyType: 'api' | 'ro') {
		navigator.clipboard.writeText(text);
		if (keyType === 'api') {
			apiKeyCopyText = 'Copied!';
			setTimeout(() => {
				apiKeyCopyText = 'Copy';
			}, 2000);
		} else {
			readOnlyApiKeyCopyText = 'Copied!';
			setTimeout(() => {
				readOnlyApiKeyCopyText = 'Copy';
			}, 2000);
		}
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
	<section class="container mx-auto px-4 py-4 text-center md:py-16">
		<h1 class="mb-6 text-3xl leading-tight font-bold text-white md:text-5xl">
			Publish Markdown From Neovim
		</h1>

		<p class="mx-auto mb-2 max-w-3xl text-lg text-gray-300 md:mb-12 md:text-xl">
			Perfect for writers who want to publish and sync note instantly.
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
// 👇 just add these 2 lines 
neonote:  
neonote-is-public: true
---

This markdown file will be instantly available at:
https://neonote.sshawn.com/[id]

</code></pre>
				</div>
			</div>
		</div>

		<!-- Simplified Main CTA -->
		<div class="mx-auto max-w-xl">
			<!-- Open the modal using ID.showModal() method -->
			<button
				class="btn btn-lg border-none bg-blue-600 px-12 py-6 text-xl text-white shadow-lg hover:bg-blue-700"
				onclick={openModal}>Get Your Free API Key</button
			>

			<p class="my-4 text-gray-400">Free tier: 5 publishable markdown files, unlimited views.</p>

			<a href="https://github.com/lsshawn/neonote.nvim" class="text-gray-400 underline"
				>Documentation and Plugin Install Guide</a
			>

			<dialog id="subscribe_modal" class="modal" onclose={resetModal}>
				<div class="modal-box max-w-2xl border border-gray-700 bg-gray-800 text-white">
					<form method="dialog">
						<button
							class="btn btn-circle btn-ghost btn-sm absolute top-2 right-2 text-gray-400 hover:text-white"
							>✕</button
						>
					</form>

					{#if modalStep === 'email'}
						<h3 class="text-2xl font-bold text-white">Get Started with NeoNote</h3>
						<p class="py-4 text-gray-300">
							Sign up to get your API key and start publishing markdown files instantly
						</p>

						<form onsubmit={handleSubmitEmail} class="mt-4 space-y-6">
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
									disabled={isLoading}
								>
									{#if isLoading}
										<span class="loading loading-spinner"></span>
									{/if}
									Get Free API Key
								</button>
							</div>
							{#if error}
								<p class="text-center text-red-500">{error}</p>
							{/if}
						</form>
					{:else if modalStep === 'otp'}
						<h3 class="text-2xl font-bold text-white">Verify Your Email</h3>
						<p class="py-4 text-gray-300">
							We've sent a one-time password to <strong>{email}</strong>. Please enter it below.
						</p>

						<form onsubmit={handleSubmitOtp} class="mt-4 space-y-6">
							<!-- OTP Input -->
							<div class="form-control w-full">
								<label for="otp-input" class="label">
									<span class="label-text text-gray-300">One-Time Password</span>
								</label>
								<input
									type="text"
									id="otp-input"
									placeholder="123456"
									bind:value={otp}
									class="input input-bordered w-full border-gray-600 bg-gray-700 text-lg text-white placeholder-gray-400 focus:border-blue-500"
									required
								/>
							</div>

							<button
								type="submit"
								class="btn btn-lg w-full border-none bg-blue-600 py-3 text-lg text-white shadow-lg hover:bg-blue-700"
								disabled={isLoading}
							>
								{#if isLoading}
									<span class="loading loading-spinner"></span>
								{/if}
								Verify & Get API Key
							</button>

							<div class="text-center text-sm">
								<button
									type="button"
									onclick={handleResendOtp}
									class="text-blue-400 hover:underline"
									disabled={isLoading}>Resend OTP</button
								>
							</div>
							{#if error}
								<p class="text-center text-red-500">{error}</p>
							{/if}
						</form>
					{:else if modalStep === 'success'}
						<h3 class="text-2xl font-bold text-white">Success! Account Activated</h3>
						<p class="py-4 text-gray-300">
							Save these keys securely. You'll need them to use the NeoNote plugin.
						</p>
						<div
							class="mt-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-300"
						>
							<strong>Warning:</strong> These are the only times the API keys will be shown. Save them
							securely!
						</div>
						<div class="my-4 space-y-4">
							<div>
								<label class="text-sm font-bold text-gray-400">API Key (read/write)</label>
								<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
									<span class="break-all">{apiKey.slice(0, 12)}...{apiKey.slice(-12)}</span>
									<button
										onclick={() => copyToClipboard(apiKey, 'api')}
										class="btn btn-neutral btn-sm absolute top-2 right-2"
										disabled={apiKeyCopyText === 'Copied!'}
									>
										{apiKeyCopyText}
									</button>
								</div>
							</div>
							<div>
								<label class="text-sm font-bold text-gray-400">Read-Only API Key</label>
								<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
									<span class="break-all"
										>{readOnlyApiKey.slice(0, 12)}...{readOnlyApiKey.slice(-12)}</span
									>
									<button
										onclick={() => copyToClipboard(readOnlyApiKey, 'ro')}
										class="btn btn-neutral btn-sm absolute top-2 right-2"
										disabled={readOnlyApiKeyCopyText === 'Copied!'}
									>
										{readOnlyApiKeyCopyText}
									</button>
								</div>
								<p class="mt-1 text-xs text-gray-500">
									Read-only API key can only be used for GET requests.
								</p>
							</div>
						</div>

						<div class="mt-8 rounded-lg border border-blue-500/50 bg-blue-500/10 p-6 text-center">
							<h4 class="text-xl font-bold text-white">Upgrade to Pro</h4>
							<p class="my-2 text-gray-300">Get 10,000 notes for just $10/month.</p>
							<button class="btn btn-primary bg-blue-600 hover:bg-blue-700">Upgrade Now</button>
						</div>

						<p class="mt-6 text-center text-gray-400">You can now close this window.</p>
					{/if}
				</div>
				<form method="dialog" class="modal-backdrop">
					<button>close</button>
				</form>
			</dialog>
		</div>
	</section>

	<!-- Features Section -->
	<section class="container min-w-full bg-gray-800/50 px-10 py-16">
		<h2 class="text-center text-3xl font-bold text-white">Built for Neovim Users</h2>
		<div class="mt-12 grid gap-8 md:grid-cols-3">
			<div class="card border border-gray-700 bg-gray-800/50 text-center shadow-lg">
				<div class="card-body items-center">
					<Code class="mx-auto mb-4 h-12 w-12 text-blue-400" />
					<h2 class="card-title justify-center text-white">Simple API</h2>
					<p class="text-gray-300">
						<a href="https://github.com/lsshawn/neonote.nvim" class="underline"
							>Install the plugin</a
						> and add frontmatter to your markdown files.
					</p>
				</div>
			</div>

			<div class="card border border-gray-700 bg-gray-800/50 text-center shadow-lg">
				<div class="card-body items-center">
					<FileText class="mx-auto mb-4 h-12 w-12 text-blue-400" />
					<h2 class="card-title justify-center text-white">Markdown Native</h2>
					<p class="text-gray-300">
						Write in plain markdown. We render it beautifully with syntax highlighting, tables, and
						more. Inline images and videos are supported.
					</p>
				</div>
			</div>

			<div class="card border border-gray-700 bg-gray-800/50 text-center shadow-lg">
				<div class="card-body items-center">
					<Globe class="mx-auto mb-4 h-12 w-12 text-blue-400" />
					<h2 class="card-title justify-center text-white">Instant Publishing</h2>
					<p class="text-gray-300">
						Your content is live immediately. You can also get the content via our API.
					</p>
				</div>
			</div>
		</div>
		<!-- <div class="mt-8 text-center italic">Coming soon: Obsidian</div> -->
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
