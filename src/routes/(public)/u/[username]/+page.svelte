<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { formatDate } from '$lib/helpers/dates';
	import type { PageData } from './$types';

	export let data: PageData;

	let notes = data.notes;
	let page = 2; // Start with page 2 since page 1 is from SSR
	let loading = false;
	let noMoreNotes = data.notes.length < 10;
	let sentinel: HTMLElement;

	async function loadMoreNotes() {
		if (loading || noMoreNotes || !browser) return;
		loading = true;

		const res = await fetch(`/api/users/${data.username}/notes?page=${page}&limit=10`);

		if (res.ok) {
			const newNotes = await res.json();
			if (newNotes.length > 0) {
				notes = [...notes, ...newNotes];
				page++;
				if (newNotes.length < 10) {
					noMoreNotes = true;
				}
			} else {
				noMoreNotes = true;
			}
		} else {
			console.error('Failed to load more notes');
			noMoreNotes = true; // stop trying on error
		}

		loading = false;
	}

	onMount(() => {
		if (!browser) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					loadMoreNotes();
				}
			},
			{
				rootMargin: '0px 0px 200px 0px'
			}
		);

		if (sentinel) {
			observer.observe(sentinel);
		}

		return () => {
			if (sentinel) {
				observer.unobserve(sentinel);
			}
		};
	});
</script>

<svelte:head>
	<title>{data.username}'s Notes</title>
</svelte:head>

<div class="container mx-auto p-4 max-w-4xl">
	<h1 class="text-3xl font-bold mb-4">{data.username}'s Public Notes</h1>

	{#if notes.length === 0}
		<div class="text-center p-8">
			<p class="text-lg text-base-content/70">{data.username} has no public notes yet.</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#each notes as note (note.id)}
				<a
					href={`/${note.id}`}
					class="card bg-base-100 shadow-xl hover:bg-base-200 transition-colors block border border-base-300"
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
						<div class="card-actions justify-end mt-2">
							{#if note.tags && note.tags.length > 0}
								{#each note.tags as tag}
									<div class="badge badge-outline">{tag}</div>
								{/each}
							{/if}
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}

	<!-- Sentinel for infinite scroll -->
	<div bind:this={sentinel} class="h-10" />

	{#if loading}
		<div class="text-center p-4">
			<span class="loading loading-spinner loading-lg" />
		</div>
	{/if}

	{#if noMoreNotes && notes.length > 0}
		<p class="text-center text-base-content/70 p-4">You've reached the end!</p>
	{/if}
</div>
