<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/stores';
	import { formatDateTime } from '$lib/helpers';
	import type { Note } from '$lib/server/db/schema';

	let { data, form } = $props();

	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let noteToDelete: (typeof data.notes)[0] | null = $state(null);
	let deleteModal: HTMLDialogElement;

	let noteToView: Note | null = $state(null);
	let viewModal: HTMLDialogElement;
	type NoteContent = { html: string; content: string | null };
	let noteContent = $state<NoteContent | null>(null);
	let loadingNote = $state(false);
	let viewMode: 'html' | 'markdown' = $state('html');

	function showToast(message: string, type: 'success' | 'error') {
		toast = { message, type };
		setTimeout(() => {
			toast = null;
		}, 3000);
	}

	async function showViewModal(note: (typeof data.notes)[0]) {
		noteToView = note;
		viewModal?.showModal();
		loadingNote = true;
		noteContent = null;
		viewMode = 'html';

		try {
			// Assuming an API endpoint exists to fetch a single note for the authenticated user
			const res = await fetch(`/api/notes/${note.id}?parse=markdown`);
			if (res.ok) {
				const data = await res.json();
				noteContent = { html: data.html, content: data.content };
			} else {
				const errorText = `Failed to load note. Status: ${res.status}`;
				noteContent = { html: `<p class="text-error">${errorText}</p>`, content: errorText };
			}
		} catch (e) {
			const errorText = 'An error occurred while fetching the note.';
			noteContent = { html: `<p class="text-error">${errorText}</p>`, content: errorText };
			console.error(e);
		} finally {
			loadingNote = false;
		}
	}

	let deleting = $state(false);
	const handleDelete: SubmitFunction = () => {
		deleting = true;
		return ({ result, update }) => {
			if (result.type === 'success' || result.type === 'failure') {
				if (result.data?.success) {
					showToast('Note deleted successfully.', 'success');
					deleteModal?.close();
				} else if (result.data?.message) {
					showToast(result.data.message as string, 'error');
				}
			}
			update();
			deleting = false;
		};
	};

	function getSearchURL(p: number) {
		const url = new URL($page.url);
		url.searchParams.set('page', p.toString());
		if (data.search) {
			url.searchParams.set('search', data.search);
		} else {
			url.searchParams.delete('search');
		}
		return url.href;
	}
</script>

<div class="mx-auto min-h-screen max-w-4xl text-white">
	<section class="container mx-auto px-4 py-4 text-center md:pt-16">
		<h1 class="mb-6 text-3xl leading-tight font-bold text-white md:text-5xl">My Notes</h1>
	</section>

	<section class="container mx-auto px-4">
		<div class="mb-4">
			<form method="GET" class="flex gap-2">
				<input
					type="search"
					name="search"
					placeholder="Search by Note ID"
					class="input input-bordered w-full max-w-xs"
					value={data.search}
				/>
				<button type="submit" class="btn btn-primary">Search</button>
			</form>
		</div>

		<div class="overflow-x-auto">
			<table class="table">
				<thead>
					<tr>
						<th>ID</th>
						<th>Title</th>
						<th>Updated At</th>
						<th>Is Public?</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.notes as note}
						<tr>
							<td>{note.id}</td>
							<td>
								{#if note.isPrivate}
									<button
										type="button"
										class="link p-0 text-left"
										onclick={() => showViewModal(note)}>{note.title || 'Untitled'}</button
									>
								{:else}
									<a href="/{note.id}" class="link" target="_blank" rel="noopener noreferrer"
										>{note.title || 'Untitled'}</a
									>
								{/if}
							</td>
							<td>{formatDateTime(note.updatedAt)}</td>
							<td>
								{@render visibilityBadge(note)}
							</td>
							<td class="text-right">
								<button
									type="button"
									class="btn btn-error btn-sm"
									onclick={() => {
										noteToDelete = note;
										deleteModal.showModal();
									}}
								>
									Delete
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="text-center">No notes found.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if data.totalPages > 1}
			<div class="join mt-4 flex justify-center">
				{#if data.currentPage > 1}
					<a href={getSearchURL(data.currentPage - 1)} class="join-item btn">«</a>
				{:else}
					<button class="join-item btn btn-disabled">«</button>
				{/if}
				<button class="join-item btn">Page {data.currentPage} of {data.totalPages}</button>
				{#if data.currentPage < data.totalPages}
					<a href={getSearchURL(data.currentPage + 1)} class="join-item btn">»</a>
				{:else}
					<button class="join-item btn btn-disabled">»</button>
				{/if}
			</div>
		{/if}
	</section>
</div>

{#if toast}
	<div class="toast toast-top toast-end">
		<div class="alert {toast.type === 'success' ? 'alert-success' : 'alert-error'}">
			<span>{toast.message}</span>
		</div>
	</div>
{/if}

<dialog id="delete_modal" class="modal" bind:this={deleteModal}>
	<div class="modal-box">
		<h3 class="text-lg font-bold">Confirm Deletion</h3>
		{#if noteToDelete}
			<p class="py-4">
				Are you sure you want to delete note "{noteToDelete.title || 'Untitled'}" (ID: {noteToDelete.id})?
				This action cannot be undone.
			</p>
		{/if}
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">Cancel</button>
			</form>
			{#if noteToDelete}
				<form method="POST" action="?/delete" use:enhance={handleDelete}>
					<input type="hidden" name="id" value={noteToDelete.id} />
					<button type="submit" class="btn btn-error" class:btn-disabled={deleting}>
						{#if deleting}
							<span class="loading loading-spinner"></span>
						{/if}
						Confirm Delete</button
					>
				</form>
			{/if}
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button></button>
	</form>
</dialog>

<dialog
	id="view_note_modal"
	class="modal"
	bind:this={viewModal}
	onclose={() => {
		noteToView = null;
		noteContent = null;
	}}
>
	{#if noteToView}
		<div class="modal-box w-11/12 max-w-5xl">
			<div class="flex items-center gap-2">
				<h3 class="text-lg font-bold">{noteToView?.title || 'Untitled'}</h3>
				{@render visibilityBadge(noteToView)}
			</div>

			{#if loadingNote}
				<div class="flex justify-center py-8">
					<span class="loading loading-spinner loading-lg"></span>
				</div>
			{:else if noteContent}
				<div class="tabs-boxed tabs my-4">
					<button
						class="tab"
						class:tab-active={viewMode === 'html'}
						onclick={() => (viewMode = 'html')}>Preview</button
					>
					<button
						class="tab"
						class:tab-active={viewMode === 'markdown'}
						onclick={() => (viewMode = 'markdown')}>Markdown</button
					>
				</div>
				<div class="max-h-[60vh] overflow-y-auto">
					{#if viewMode === 'html'}
						<div class="prose dark:prose-invert max-w-none">
							{@html noteContent.html}
						</div>
					{:else}
						<pre class="rounded-box bg-base-200 p-4 whitespace-pre-wrap"><code
								>{noteContent.content ?? ''}</code
							></pre>
					{/if}
				</div>
			{/if}
			<div class="modal-action">
				<form method="dialog">
					<button class="btn">Close</button>
				</form>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button>close</button>
		</form>
	{/if}
</dialog>

{#snippet visibilityBadge(note: Note)}
	<div class="badge badge-success badge-outline" class:badge-error={note?.isPrivate}>
		{note?.isPrivate ? 'private' : 'public'}
	</div>
{/snippet}
