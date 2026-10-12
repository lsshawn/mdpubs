<script lang="ts">
	import '../app.css';
	import type { LayoutData, Snapshot } from './$types';
	import { config } from '#lib/config.js';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import FeedbackWidget from '#lib/components/FeedbackWidget.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import { checkoutHref } from '#lib/helpers/checkout.js';
	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Site-wide fallback OG image for routes that don't supply their own meta.
	// Use the 1200x630 card (the standard aspect ratio Discord/Slack/Twitter
	// expect); `ogimage.webp` is 1200x684 and gets cropped oddly. Pages that own
	// their meta (e.g. the public note view) render their own og:image and this
	// block is skipped for them below.
	let ogImage = $derived(`${page.url.origin}/og-default.png`);

	/**
	 * Logged-in routes render their own dashboard shell (sidebar + mobile top bar)
	 * in src/routes/(app)/+layout.svelte, so the public navbar is suppressed there
	 * to avoid two stacked headers. The public note view (/(public)/[id]) and the
	 * login screen opt out of the navbar too.
	 */
	let hideSiteChrome = $derived(
		page.route.id === '/(public)/[id]' ||
			page.route.id === '/(public)/login' ||
			page.route.id?.startsWith('/(app)') === true
	);

	let message = $state('');
	let email = $state(data.user?.email ?? '');
	let name = $state('');

	export const snapshot: Snapshot<{ message: string; email: string; name: string }> = {
		capture: () => ({ message, email, name }),
		restore: (value) => {
			if (value) {
				message = value.message;
				email = value.email;
				name = value.name;
			}
		}
	};
</script>

<svelte:head>
	<title>{config.name} - {config.description}</title>

	{#if page.route.id !== '/(public)/[id]'}
		<!--
			Only emit site-wide social/meta tags on routes that don't supply their own.
			`<svelte:head>` does NOT dedupe `og:*`/`twitter:*` tags, so emitting these
			alongside the public note page's own set ships two competing og:image tags
			— Discord et al. then render both. The note view owns its meta, so skip the
			site-wide set there.
		-->
		<!-- The landing page writes its own description. -->
		{#if page.route.id !== '/(public)'}
			<meta name="description" content={config.description} />
		{/if}

		<!-- Search engine indexing control -->
		<meta name="robots" content="index, follow" />

		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="article" />
		<meta property="og:url" content={page.url.href} />
		<meta property="og:title" content={config.name} />
		<meta property="og:description" content={config.description} />
		<meta property="og:image" content={ogImage} />

		<!-- Twitter -->
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:url" content={page.url.href} />
		<meta name="twitter:title" content={config.name} />
		<meta name="twitter:description" content={config.description} />
		<meta name="twitter:image" content={ogImage} />
	{/if}
</svelte:head>

<div class="flex min-h-screen flex-col">
	{#if !hideSiteChrome}
		<header class="navbar shadow-sm md:px-8">
			<div class="flex flex-1">
				<a href={resolve('/(public)')} class="flex items-center text-base-content">
					<Logo class="h-11 w-auto" />
				</a>
			</div>
			<div class="flex items-center gap-2">
				<!-- Mobile-only: the floating widget is suppressed below `md`. The
					landing page has its own in the footer; login has none. -->
				{#if page.route.id !== '/(public)' && page.route.id !== '/(public)/login'}
					<div class="md:hidden">
						<FeedbackWidget bind:message bind:email bind:name variant="navbar" />
					</div>
				{/if}
				{#if data.user}
					<a href={resolve('account')} class="btn btn-sm btn-ghost">My account</a>
				{:else if page.route.id !== '/(public)/login'}
					<!--
						The primary button goes straight to Stripe monthly checkout, in the
						same window. Returning users still have a quiet way back in, so a
						visitor with an account is not pushed at a second subscription.
					-->
					<a href={resolve('login')} class="btn btn-sm btn-ghost">Log in</a>
					<!-- `!`: the landing page's scrolldemo.css sets an unlayered `a { color: inherit }`. -->
					<a
						href={checkoutHref(config.stripePaymentLinks.monthly.link)}
						class="btn btn-sm btn-neutral text-neutral-content!">Start for $20/mo</a
					>
				{/if}
			</div>
		</header>
	{/if}
	<main class="flex-1">
		{@render children()}
	</main>
	<!-- The landing page puts its feedback button in its own footer instead. -->
	{#if !['/(public)/[id]', '/(public)', '/(public)/login'].includes(page.route.id ?? '')}
		<!--
			Floating variant is desktop-only — the component hides its own root below
			`md`. On mobile the trigger lives in the navbar instead (public navbar
			above, dashboard top bar in (app)/+layout.svelte), where it can't cover
			content or clash with the browser's bottom chrome.
		-->
		<FeedbackWidget bind:message bind:email bind:name />
	{/if}
</div>
