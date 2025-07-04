<script lang="ts">
	import { goto } from '$app/navigation';
	import CopyableText from '$lib/components/CopyableText.svelte';
	import { app } from '$lib/config';
	let apiKey = '123';
	let readOnlyApiKey = '123';

	async function logout() {
		const res = await fetch('/api/auth/logout', { method: 'POST' });
		if (res.ok) {
			goto('/', { replaceState: true, invalidateAll: true });
		}
	}
</script>

<div class=" mx-auto min-h-screen max-w-lg text-white">
	<section class="container mx-auto px-4 py-4 text-center md:pt-16">
		<h1 class="mb-6 text-3xl leading-tight font-bold text-white md:text-5xl">Your Account Page</h1>
	</section>

	<section class="container mx-auto px-4" id="apikey">
		<h3 class="text-2xl font-bold text-white">Your API Keys</h3>
		<p class="py-4 text-gray-300">
			Save these keys securely. You'll need them to use the NeoNote plugin.
			<a href={app.git} class="text-gray-400 underline">Documentation and Plugin Install Guide</a>
		</p>
		<div class="my-4 space-y-4">
			<div>
				<label class="text-sm font-bold text-gray-400">API Key (read/write)</label>
				<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
					<span class="break-all">{apiKey.slice(0, 12)}...{apiKey.slice(-12)}</span>
					<CopyableText text={apiKey} />
				</div>
			</div>
			<div>
				<label class="text-sm font-bold text-gray-400">Read-Only API Key</label>
				<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
					<span class="break-all">{readOnlyApiKey.slice(0, 12)}...{readOnlyApiKey.slice(-12)}</span>
					<CopyableText text={readOnlyApiKey} />
				</div>
				<p class="mt-1 text-xs text-gray-500">
					Read-only API key can only be used for GET requests.
				</p>
			</div>
		</div>

		<div class="mt-8 rounded-lg border border-blue-500/50 bg-blue-500/10 p-6 text-center">
			<h4 class="text-xl font-bold text-white">Upgrade to Pro</h4>
			<p class="my-2 text-gray-300">Publish unlimited notes for just $10/month</p>
			<button class="btn btn-primary">Upgrade Now</button>
		</div>
		<div class="mt-4 text-center">
			<button class="btn text-error btn-ghost" onclick={() => logout()}>Logout</button>
		</div>
	</section>
</div>
