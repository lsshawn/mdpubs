<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let notFound = $state(false);
	let loading = $state(true);
	let note = $state({});
	let error = $state('');

	onMount(async () => {
		try {
			const res = await fetch(
				`https://api-neonote.sshawn.com/public/notes/${page.params.id}?parse=markdown`
			);
			if (!res.ok) {
				if (res.status === 404) {
					notFound = true;
				} else {
					error = 'Failed to load note';
				}
			} else {
				note = await res.json();
			}
		} catch (e) {
			error = 'Network error occurred';
		}
		loading = false;
	});
</script>

<svelte:head>
	<title>{note?.title || 'Note'} - NeoNote</title>
	<meta name="description" content={note?.description || 'A published note'} />
</svelte:head>

<div class="min-h-screen bg-white">
	{#if loading}
		<!-- Loading State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="loading loading-spinner loading-lg text-gray-400"></div>
				<p class="mt-4 text-gray-500">Loading note...</p>
			</div>
		</div>
	{:else if notFound}
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
	{:else if error}
		<!-- Error State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">⚠️</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">Something went wrong</h1>
				<p class="mb-6 text-gray-500">{error}</p>
				<button class="btn btn-primary" onclick={() => location.reload()}>Try Again</button>
			</div>
		</div>
	{:else}
		<!-- Main Content -->
		{#if note}
			<div class="mx-auto max-w-4xl px-6 py-12">
				<!-- Header -->
				<header class="mb-8">
					{#if note?.frontmatter?.title}
						<h1 class="mb-4 text-4xl leading-tight font-bold text-gray-900">
							{note.frontmatter.title}
						</h1>
					{/if}

					{#if note?.frontmatter?.description}
						<p class="text-xl leading-relaxed text-gray-600">
							{note?.frontmatter?.description}
						</p>
					{/if}

					{#if note.updatedAt}
						<div class="mt-6 flex items-center text-sm text-gray-500">
							<time datetime={note.updatedAt}>
								{new Date(note.updatedAt).toLocaleDateString('en-US', {
									year: 'numeric',
									month: 'long',
									day: 'numeric'
								})}
							</time>
						</div>
					{/if}
				</header>

				<!-- Divider -->
				<div class="mb-8 border-t border-gray-200"></div>

				<!-- Content -->
				<article class="prose prose-base prose-gray max-w-none">
					{@html note.html}
				</article>

				<!-- Footer -->
				<footer class="mt-16 border-t border-gray-200 pt-8">
					<div class="flex flex-col items-center justify-center text-gray-500">
						<a
							href="http://neonote.sshawn.com"
							class="inline-flex items-center text-sm text-gray-500 underline transition-colors hover:text-gray-700"
						>
							<span class="mr-2">📝</span>
							Powered by NeoNote
						</a>
						<div class="mt-1 text-xs">The Easiest Way to Publish Markdown from Neovim</div>
					</div>
				</footer>
			</div>
		{/if}
	{/if}
</div>
