<script lang="ts">
	import { page } from '$app/stores';
</script>

<svelte:head>
	<title>Error - NeoNote</title>
</svelte:head>

<div class="min-h-screen bg-white">
	{#if $page.error?.status === 404}
		<!-- 404 State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">📝</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">Page not found</h1>
				<p class="mb-6 text-gray-500">
					The note you're looking for doesn't exist or has been removed.
				</p>
				<a href="/" class="btn btn-primary">Go Home</a>
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