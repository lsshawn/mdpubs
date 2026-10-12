<script lang="ts">
	/**
	 * The "let this AI tool publish for you?" card, shared by /device (CLI) and
	 * /oauth/authorize (Claude, ChatGPT). New users see a subscribe step first:
	 * there is no free tier, so Allow only appears on a paid plan.
	 */
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';

	let {
		title,
		paid,
		email,
		monthlyLink,
		yearlyLink,
		fields = {},
		children
	}: {
		title: string;
		paid: boolean;
		email: string;
		monthlyLink: string | null;
		yearlyLink: string | null;
		/** Request parameters the Allow/Deny actions need back, sent as hidden inputs. */
		fields?: Record<string, string>;
		children?: Snippet;
	} = $props();
</script>

<div class="mx-auto max-w-md px-6 py-16">
	<div class="border border-base-content/15 bg-base-100 p-8">
		<h1 class="text-xl font-semibold tracking-tight">{title}</h1>
		<p class="mt-2 text-sm text-base-content/60">Signed in as {email}</p>

		{@render children?.()}

		{#if paid}
			<p class="mt-6 text-sm text-base-content/70">
				It will be able to publish documents, edit them, and check who has signed. You can
				disconnect it any time from your account page.
			</p>
			<form method="POST" class="mt-6 flex gap-3">
				{#each Object.entries(fields) as [name, value] (name)}
					<input type="hidden" {name} {value} />
				{/each}
				<button
					formaction="?/deny"
					class="flex-1 border border-base-content/30 px-4 py-3 font-mono text-sm hover:border-base-content"
					>Cancel</button
				>
				<button
					formaction="?/allow"
					class="flex-1 border border-base-content bg-base-content px-4 py-3 font-mono text-sm text-base-100 hover:bg-transparent hover:text-base-content"
					>Allow</button
				>
			</form>
		{:else}
			<div class="mt-6 border-t border-base-content/15 pt-6">
				<p class="font-semibold">Subscribe to finish setup</p>
				<p class="mt-1 text-sm text-base-content/70">
					{page.data.pricing.monthly} a month, flat. Cancel anytime. Checkout opens in a new tab; come
					back here when it's done.
				</p>
				<div class="mt-4 grid gap-3">
					{#if monthlyLink}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a
							href={monthlyLink}
							target="_blank"
							rel="noopener"
							class="border border-base-content bg-base-content px-4 py-3 text-center font-mono text-sm text-base-100 hover:bg-transparent hover:text-base-content"
							>{page.data.pricing.monthly} / month</a
						>
					{/if}
					{#if yearlyLink}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a
							href={yearlyLink}
							target="_blank"
							rel="noopener"
							class="border border-base-content px-4 py-3 text-center font-mono text-sm hover:bg-base-content hover:text-base-100"
							>{page.data.pricing.yearly} / year</a
						>
					{/if}
				</div>
				<!-- A plain reload: the Stripe webhook flips the plan and load() re-reads it. -->
				<button
					type="button"
					onclick={() => location.reload()}
					class="mt-2 w-full font-mono text-xs text-base-content/60 underline underline-offset-4 hover:text-base-content"
					>I've paid, continue</button
				>
			</div>
		{/if}
	</div>
</div>
