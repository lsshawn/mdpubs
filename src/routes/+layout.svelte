<script lang="ts">
	import '../app.css';
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

{@render children()}
