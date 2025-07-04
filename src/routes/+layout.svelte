<script lang="ts">
	import '../app.css';
	import { CircleUser, Pencil } from 'lucide-svelte';
	import type { LayoutData } from './$types';
	import { app } from '$lib/config';
	import { page } from '$app/state';
	let { data, children }: { data: LayoutData; children: any } = $props();

	let ogImage = $state(
		data.meta?.ogImage ? `${page.url.origin}${data.meta.ogImage}` : `${page.url.origin}/og/page.png`
	);
</script>

<svelte:head>
	<title>{app.name} - {app.description}</title>
	<meta name="description" content={app.description} />

	<!-- Search engine indexing control -->
	<meta name="robots" content="index, follow" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="article" />
	<meta property="og:url" content={page.url.href} />
	<meta property="og:title" content={app.name} />
	<meta property="og:description" content={app.description} />
	<meta property="og:image" content={ogImage} />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:url" content={page.url.href} />
	<meta name="twitter:title" content={app.name} />
	<meta name="twitter:description" content={app.description} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="navbar shadow-sm md:px-8">
		<div class="flex flex-1">
			<a href="/" role="button" class="flex gap-2">
				<Pencil class="h-8 w-8 text-blue-400" />
				<span class="text-2xl font-bold text-white">NeoNote</span>
			</a>
		</div>
		<div class="flex items-center gap-2">
			<a
				href="/notes"
				role="button"
				class={page.url.pathname.startsWith('/notes')
					? 'btn btn-ghost text-gray-600'
					: 'btn btn-ghost text-white'}
			>
				Notes
			</a>
			<a
				href="/account"
				role="button"
				class={page.url.pathname.startsWith('/account') || page.url.pathname.startsWith('/login')
					? 'text-gray-600'
					: 'text-white'}
			>
				<CircleUser class="h-8 w-8" />
			</a>
		</div>
	</header>
	<main class="flex-1">
		{@render children()}
	</main>
</div>
