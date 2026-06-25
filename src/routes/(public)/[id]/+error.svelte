<script lang="ts">
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';

	// On a private note, send the viewer to login and bring them back here after.
	const loginHref = $derived(
		`${resolve('/login')}?redirectTo=${encodeURIComponent($page.url.pathname)}`
	);
</script>

<svelte:head>
	<title>Error - MdPubs</title>
</svelte:head>

<div class="min-h-screen bg-white">
	{#if $page.status === 403}
		<!-- Private note -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">🔒</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">This is a private note</h1>
				<p class="mb-6 text-gray-500">
					Log in to MdPubs to view it. If you have access, you'll be brought right back here.
				</p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={loginHref} class="btn btn-primary">Log in to MdPubs</a>
			</div>
		</div>
	{:else if $page.status === 404}
		<!-- 404 State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">📝</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">Page not found</h1>
				<p class="mb-6 text-gray-500">
					The note you're looking for doesn't exist or has been removed.
				</p>
				<a href={resolve('/')} class="btn btn-primary">Go Home</a>
			</div>
		</div>
	{:else}
		<!-- General Error State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">⚠️</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">Something went wrong</h1>
				<p class="mb-6 text-gray-500">{$page.error?.message || 'An unexpected error occurred'}</p>
				<button class="btn btn-primary" onclick={() => location.reload()}>Try Again</button>
			</div>
		</div>
	{/if}
</div>
