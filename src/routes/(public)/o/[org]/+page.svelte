<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatDate } from '$lib/helpers/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.org.name} · Docs</title>
</svelte:head>

{#if data.isCustomDomain}
	<!-- Custom domains get a plain branded landing page, not the note index. -->
	<div class="flex min-h-screen flex-col items-center justify-center p-4 text-center">
		<h1 class="text-4xl font-bold">{data.org.name}</h1>
		<p class="mt-3 text-sm text-base-content/60">
			powered by
			<a href="https://mdpubs.com" class="link link-hover font-medium">mdpubs.com</a>
		</p>
	</div>
{:else}
<div class="container mx-auto max-w-4xl p-4">
	<h1 class="mb-4 text-3xl font-bold">{data.org.name}</h1>

	{#if data.notes.length === 0}
		<div class="p-8 text-center">
			<p class="text-lg text-base-content/70">No published documents yet.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.notes as note (note.id)}
				<a
					href={resolve('/(public)/[id]', { id: String(note.id) })}
					class="card block border border-base-300 bg-base-100 shadow-xl transition-colors hover:bg-base-200"
				>
					<div class="card-body">
						<h2 class="card-title">{note.title}</h2>
						<p class="text-sm text-base-content/70">
							{#if note.updatedAt}
								Updated on {formatDate(new Date(note.updatedAt))}
							{/if}
						</p>
						<p class="mt-2 text-base-content/90">
							{note.contentSnippet}{note.contentSnippet && note.contentSnippet.length >= 200
								? '...'
								: ''}
						</p>
						<div class="card-actions mt-2 justify-end">
							{#if note.tags && note.tags.length > 0}
								{#each note.tags as tag (tag)}
									<div class="badge badge-outline">{tag}</div>
								{/each}
							{/if}
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
{/if}
