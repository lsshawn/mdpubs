<script lang="ts">
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import CopyableText from '$lib/components/CopyableText.svelte';
	import { app } from '$lib/config';
	let apiKey: string | null = $state(null);
	let readOnlyApiKey: string | null = $state(null);

	let { data } = $props();
	let loggingOut = $state(false);
	let regenerating = $state(false);
	let managingSubscription = $state(false);
	async function logout() {
		loggingOut = true;
		const res = await fetch('/api/auth/logout', { method: 'POST' });
		if (res.ok) {
			goto('/', { replaceState: true, invalidateAll: true });
		}
	}

	async function regenerateApiKeys() {
		if (regenerating) return;
		regenerating = true;
		try {
			const res = await fetch('/api/users/regenerate-api-key', { method: 'POST' });
			if (res.ok) {
				const result = await res.json();
				if (result.success) {
					apiKey = result.data.apiKey;
					readOnlyApiKey = result.data.readOnlyApiKey;
				}
			}
		} finally {
			regenerating = false;
		}
	}

	async function manageSubscription() {
		if (managingSubscription) return;
		managingSubscription = true;
		try {
			const res = await fetch('/api/stripe/create-portal-session', { method: 'POST' });
			const result = await res.json();

			if (result.success && result.url) {
				window.location.href = result.url;
			} else {
				console.error(result.message || 'Could not create Stripe portal session.');
				// TODO: You can add a user-facing error message here.
			}
		} catch (err) {
			console.error('Error managing subscription:', err);
		} finally {
			managingSubscription = false;
		}
	}
</script>

<div class=" mx-auto min-h-screen max-w-lg text-white">
	<section class="container mx-auto px-4 py-4 text-center md:pt-16">
		<h1 class="mb-6 text-3xl leading-tight font-bold text-white md:text-5xl">Your Account Page</h1>
	</section>

	<section class="container mx-auto px-4" id="apikey">
		<div class="mb-10">
			<div>You're on <strong>{data.user.plan}</strong> plan.</div>
			<div>You can publish {app.plans[data.user.plan].maxNotes} markdown notes.</div>
			{#if data.user.plan !== 'free'}
				<button
					class="btn btn-primary mt-4"
					onclick={manageSubscription}
					disabled={managingSubscription}
				>
					{#if managingSubscription}
						<span class="loading loading-spinner"></span>
					{/if}
					Manage your subscription
				</button>
			{/if}
		</div>
		<h3 class="text-2xl font-bold text-white">Your API Keys</h3>
		<p class="py-4 text-gray-300">
			Save these keys securely. You'll need them to use the MdPubs plugin.
			<a href={app.git} class="text-gray-400 underline">Documentation and Plugin Install Guide</a>
		</p>
		<div class="my-4 space-y-4">
			<div class="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4">
				<p class="text-sm text-yellow-200">
					For security, API keys are only shown once. If you've lost your keys, you can
					regenerate them. This action will invalidate your old keys.
				</p>
			</div>

			{#if apiKey && readOnlyApiKey}
				<div>
					<label class="text-sm font-bold text-gray-400">API Key (read/write)</label>
					<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
						<span class="break-all">{apiKey}</span>
						<CopyableText text={apiKey} />
					</div>
				</div>
				<div>
					<label class="text-sm font-bold text-gray-400">Read-Only API Key</label>
					<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
						<span class="break-all">{readOnlyApiKey}</span>
						<CopyableText text={readOnlyApiKey} />
					</div>
					<p class="mt-1 text-xs text-gray-500">
						Read-only API key can only be used for GET requests.
					</p>
				</div>
			{/if}
			<button class="btn btn-primary" onclick={regenerateApiKeys} disabled={regenerating}>
				{#if regenerating}
					<span class="loading loading-spinner"></span>
				{/if}
				Regenerate API Keys
			</button>
		</div>

		{#if data.user.plan !== 'paid'}
			<div class="mt-8 rounded-lg border border-blue-500/50 bg-blue-500/10 p-6 text-center">
				<h4 class="text-xl font-bold text-white">Upgrade to Pro</h4>
				<p class="my-2 text-gray-300">
					Publish <strong>unlimited notes</strong> for just $10/month
				</p>
				<a
					role="button"
					class="btn btn-primary"
					href={app.stripePaymentLinks.monthly.link + `?prefilled_email=${data.user.email}`}
					>Upgrade Now</a
				>
			</div>
		{/if}
		<div class="mt-4 text-center">
			<button class="btn text-error btn-ghost" onclick={() => logout()}>
				{#if loggingOut}
					<span class="loading loading-spinner text-error"></span>
				{/if}
				Logout</button
			>
		</div>
		{#if dev}
			<pre class="text-wrap text-gray-600">
        {JSON.stringify(data, null, 2)}
      </pre>
		{/if}
	</section>
</div>
