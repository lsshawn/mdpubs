<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';

	let { data, form } = $props();

	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let noteToDelete: (typeof data.notes)[0] | null = $state(null);
	let deleteModal: HTMLDialogElement;

	$effect(() => {
		if (form?.success) {
			toast = { message: 'Note deleted successfully.', type: 'success' };
			deleteModal?.close();
		} else if (form?.message) {
			toast = { message: form.message as string, type: 'error' };
		}
		if (toast) {
			const timer = setTimeout(() => {
				toast = null;
			}, 3000);
			return () => clearTimeout(timer);
		}
	});

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
						<th>Created At</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.notes as note}
						<tr>
							<td>{note.id}</td>
							<td>
								<a href="/{note.id}" class="link" target="_blank" rel="noopener noreferrer"
									>{note.title || 'Untitled'}</a
								>
							</td>
							<td>{new Date(note.createdAt).toLocaleString()}</td>
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
				<form method="POST" action="?/delete" use:enhance>
					<input type="hidden" name="id" value={noteToDelete.id} />
					<button type="submit" class="btn btn-error">Confirm Delete</button>
				</form>
			{/if}
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button></button>
	</form>
</dialog>
