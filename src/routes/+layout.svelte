<script lang="ts">
	import '../app.css';
	import { CircleUser, Pencil } from 'lucide-svelte';
	import type { LayoutData, Snapshot } from './$types';
	import { config } from '$lib/config';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import FeedbackWidget from '$lib/components/FeedbackWidget.svelte';
	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Site-wide fallback OG image for routes that don't supply their own meta.
	// Use the 1200x630 card (the standard aspect ratio Discord/Slack/Twitter
	// expect); `ogimage.webp` is 1200x684 and gets cropped oddly. Pages that own
	// their meta (e.g. the public note view) render their own og:image and this
	// block is skipped for them below.
	// The URL is inlined in `<svelte:head>` (see below) rather than computed
	// with a top-level `$derived`, because `$derived` runs outside the SvelteKit
	// SSR render context where `page.url` isn't available — that raised
	// `ReferenceError: ogImage is not defined` during server-side rendering.

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
		<meta name="description" content={config.description} />

		<!-- Search engine indexing control -->
		<meta name="robots" content="index, follow" />

		<!-- Open Graph / Facebook -->
		<meta property="og:type" content="article" />
		<meta property="og:url" content={page.url.href} />
		<meta property="og:title" content={config.name} />
		<meta property="og:description" content={config.description} />
		<meta property="og:image" content={`${page.url.origin}/og-default.png`} />

		<!-- Twitter -->
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:url" content={page.url.href} />
		<meta name="twitter:title" content={config.name} />
		<meta name="twitter:description" content={config.description} />
		<meta name="twitter:image" content={`${page.url.origin}/og-default.png`} />
	{/if}
</svelte:head>

<div class="flex min-h-screen flex-col">
	{#if page.route.id !== '/(public)/[id]'}
		<header class="navbar shadow-sm md:px-8">
			<div class="flex flex-1">
				<a href={resolve('/')} role="button" class="flex gap-2">
					<Pencil class="h-8 w-8 text-primary" />
					<span class="text-2xl font-bold text-base-content">MdPubs</span>
				</a>
			</div>
			<div class="flex items-center gap-2">
				<a
					href={resolve('/notes')}
					role="button"
					class={page.url.pathname.startsWith('/notes')
						? 'btn btn-ghost text-primary'
						: 'btn btn-ghost text-base-content'}
				>
					Notes
				</a>
				<a
					href={resolve('/account')}
					role="button"
					class={page.url.pathname.startsWith('/account') || page.url.pathname.startsWith('/login')
						? 'text-primary'
						: 'text-base-content'}
				>
					<CircleUser class="h-8 w-8" />
				</a>
			</div>
		</header>
	{/if}
	<main class="flex-1">
		{@render children()}
	</main>
	{#if page.route.id !== '/(public)/[id]'}
		<FeedbackWidget bind:message bind:email bind:name />
	{/if}
</div>
