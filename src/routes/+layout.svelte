<script lang="ts">
	import '../app.css';
	import type { LayoutData } from './$types';
	import { app } from '$lib/config';
	import { page } from '$app/state';
	console.log('[LS] -> src/routes/+layout.svelte:5 -> page: ', page.url);
	let { data, children }: { data: LayoutData; children: any } = $props();
</script>

<svelte:head>
	<title>{app.name} - {app.description}</title>
	<meta name="description" content={app.description} />

	<!-- Search engine indexing control -->
	<meta name="robots" content="index, follow" />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="article" />
	<meta property="og:url" content={page.url} />
	<meta property="og:title" content={app.name} />
	<meta property="og:description" content={app.description} />
	<!-- <meta property="og:image" content={data.meta.ogImage} /> -->

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:url" content={page.url} />
	<meta name="twitter:title" content={app.name} />
	<meta name="twitter:description" content={app.description} />
	<!-- <meta name="twitter:image" content={data.meta.ogImage} /> -->
</svelte:head>

{@render children()}
