<script lang="ts">
	import { dev } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CopyableText from '$lib/components/CopyableText.svelte';
	import { config } from '$lib/config';
	import Icon from '@iconify/svelte';
	let apiKey: string | null = $state(null);
	let readOnlyApiKey: string | null = $state(null);

	let { data } = $props();

	let username = $state(data.user.username ?? '');
	let updatingUsername = $state(false);
	let usernameMessage: { type: 'success' | 'error'; text: string } | null = $state(null);

	let loggingOut = $state(false);
	let regenerating = $state(false);
	let managingSubscription = $state(false);

	async function updateUsername() {
		if (updatingUsername) return;
		updatingUsername = true;
		usernameMessage = null;
		try {
			const res = await fetch('/api/account/username', {
				method: 'POST',
				body: JSON.stringify({ username }),
				headers: { 'Content-Type': 'application/json' }
			});
			const result = await res.json();
			if (res.ok) {
				usernameMessage = { type: 'success', text: result.message };
			} else {
				usernameMessage = { type: 'error', text: result.message };
			}
		} catch (err) {
			console.error('Error updating username:', err);
			usernameMessage = { type: 'error', text: 'An unexpected error occurred.' };
		} finally {
			updatingUsername = false;
		}
	}

	async function logout() {
		loggingOut = true;
		const res = await fetch('/api/auth/logout', { method: 'POST' });
		if (res.ok) {
			goto(resolve('/'), { replaceState: true, invalidateAll: true });
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

<div class=" mx-auto min-h-screen max-w-lg text-base-content">
	<section class="container mx-auto px-4 py-4 text-center md:pt-16">
		<h1 class="mb-6 text-3xl leading-tight font-bold text-base-content md:text-5xl">
			Your Account Page
		</h1>
	</section>

	<section class="container mx-auto px-4" id="apikey">
		<div class="mb-10">
			<div>{data.user.email}</div>
			<div>You're on <strong>{data.user.plan}</strong> plan.</div>
			<div>You can publish {config.plans[data.user.plan].maxNotes} markdown notes.</div>
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

		<div class="mb-10">
			<div class="flex items-center gap-2">
				<h3 class="text-xl font-bold text-base-content">Username</h3>
				<div class="badge badge-ghost badge-sm" class:badge-info={data.user.plan === 'free'}>
					{#if data.user?.plan === 'free'}
						<Icon icon="mdi:lock" style="font-size: 1rem;" />
					{/if}
					Paid plan
				</div>
			</div>
			<p class="flex items-center py-2 text-base-content/70">
				<span>
					Set a unique username. It can be used for your public notes index page, e.g.
					https://mdpubs.com/{username || 'shawn'}
				</span>
			</p>
			<form class="flex items-center gap-2" onsubmit={updateUsername}>
				<input
					type="text"
					bind:value={username}
					placeholder="your_username"
					class="input input-bordered w-full max-w-xs"
					minlength="3"
					maxlength="20"
					disabled={data.user.plan === 'free'}
				/>
				<button
					role="submit"
					class="btn btn-primary"
					disabled={updatingUsername || data.user.plan === 'free'}
				>
					{#if updatingUsername}
						<span class="loading loading-spinner"></span>
					{/if}
					Save username
				</button>
			</form>
			{#if usernameMessage}
				<p
					class="mt-2 text-sm {usernameMessage.type === 'success'
						? 'text-success'
						: 'text-error'}"
				>
					{usernameMessage.text}
				</p>
			{/if}
		</div>

		<div class="mb-10">
			<div class="flex items-center gap-2">
				<h3 class="text-xl font-bold text-base-content">Accounts (organizations)</h3>
			</div>
			<p class="flex items-center py-2 text-base-content/70">
				<span>
					Publish under a shared team name and a custom domain (e.g. docs.108labs.ai). Tag notes
					with <code class="rounded bg-base-200 px-1">mdpubs-company: &lt;slug&gt;</code>.
				</span>
			</p>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href="/orgs" class="btn btn-outline">Manage accounts</a>
		</div>

		<h3 class="text-2xl font-bold text-base-content">Your API Keys</h3>
		<p class="py-4 text-base-content/70">
			Save these keys securely. You'll need them to use the MdPubs plugin.
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={config.git} class="text-base-content/60 underline">Documentation and Plugin Install Guide</a
			>
		</p>
		<div class="my-4 space-y-4">
			<div class="rounded-lg border border-warning/50 bg-warning/10 p-4">
				<p class="text-sm text-warning">
					For security, API keys are only shown once. If you've lost your keys, you can regenerate
					them. This action will invalidate your old keys.
				</p>
			</div>

			{#if apiKey && readOnlyApiKey}
				<div>
					<label class="text-sm font-bold text-base-content/60">API Key (read/write)</label>
					<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
						<span class="break-all">{apiKey}</span>
						<CopyableText text={apiKey} />
					</div>
				</div>
				<div>
					<label class="text-sm font-bold text-base-content/60">Read-Only API Key</label>
					<div class="relative mt-1 rounded-lg bg-gray-900 p-4 font-mono text-green-400">
						<span class="break-all">{readOnlyApiKey}</span>
						<CopyableText text={readOnlyApiKey} />
					</div>
					<p class="mt-1 text-xs text-base-content/50">
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
			<div class="mt-8 rounded-lg border border-info/50 bg-info/10 p-6 text-center">
				<h4 class="text-xl font-bold text-base-content">Upgrade to Pro</h4>
				<p class="my-2 text-base-content/70">
					Publish <strong>unlimited notes</strong> for just $10/month
				</p>
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					role="button"
					class="btn btn-primary"
					href={config.stripePaymentLinks.monthly.link + `?prefilled_email=${data.user.email}`}
					>Upgrade Now</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		{/if}
		<div class="mt-4 text-center">
			<button class="btn btn-ghost text-error" onclick={() => logout()}>
				{#if loggingOut}
					<span class="loading loading-spinner text-error"></span>
				{/if}
				Logout</button
			>
		</div>
		{#if dev}
			<pre class="text-wrap text-base-content/60">
        {JSON.stringify(data, null, 2)}
      </pre>
		{/if}
	</section>
</div>
