<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { enhance } from '$app/forms';
	// SvelteKit 2.50 no longer exports `SubmitFunction` by name; derive it from
	// `enhance`'s own signature so it tracks whatever the installed version uses.
	type SubmitFunction = NonNullable<Parameters<typeof enhance>[1]>;
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { formatDateTime } from '$lib/helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Note } from '$lib/server/db/schema';

	let { data } = $props();

	let toast = $state<{ message: string; type: 'success' | 'error' } | null>(null);
	let noteToDelete: (typeof data.notes)[0] | null = $state(null);
	let deleteModal: HTMLDialogElement;

	let noteToMove: (typeof data.notes)[0] | null = $state(null);
	let moveModal: HTMLDialogElement;
	let moveTargetOrgId = $state('');

	/**
	 * publicIds moved out of this workspace during this page's lifetime. A moved
	 * note no longer belongs in a list scoped to one workspace, so it is hidden
	 * immediately rather than waiting on a reload. Reset whenever `data.notes` is
	 * replaced by a fresh load, which already excludes them.
	 */
	const movedIds = new SvelteSet<string>();
	// A fresh load replaces the array identity and already excludes moved notes,
	// so the optimistic set is stale at that point.
	$effect(() => {
		void data.notes;
		movedIds.clear();
	});
	let visibleNotes = $derived(data.notes.filter((n) => !movedIds.has(n.publicId)));

	/**
	 * Multi-select. Keyed by publicId (what the bulk actions submit). Pruned
	 * against the visible rows so a selection can't outlive the notes it refers
	 * to — after a move, delete, page change or search.
	 */
	const selectedIds = new SvelteSet<string>();
	let selected = $derived(visibleNotes.filter((n) => selectedIds.has(n.publicId)));
	let allSelected = $derived(visibleNotes.length > 0 && selected.length === visibleNotes.length);
	// Header checkbox shows a dash when the selection is a strict subset.
	let someSelected = $derived(selected.length > 0 && !allSelected);

	$effect(() => {
		const present = new Set(visibleNotes.map((n) => n.publicId));
		for (const id of selectedIds) {
			if (!present.has(id)) selectedIds.delete(id);
		}
	});

	function toggleOne(publicId: string) {
		if (selectedIds.has(publicId)) selectedIds.delete(publicId);
		else selectedIds.add(publicId);
	}

	function toggleAll() {
		const wasAll = allSelected;
		selectedIds.clear();
		if (!wasAll) for (const n of visibleNotes) selectedIds.add(n.publicId);
	}

	let bulkMoveModal: HTMLDialogElement;
	let bulkDeleteModal: HTMLDialogElement;
	let bulkMoveTargetOrgId = $state('');
	let bulkHardDeleteArmed = $state(false);
	// Personal is only a valid bulk destination if every selected note is ours.
	let canBulkMovePersonal = $derived(selected.every((n) => n.userId === data.user.id));

	let bulkMoving = $state(false);
	const handleBulkMove: SubmitFunction = ({ formData }) => {
		bulkMoving = true;
		const ids = formData.getAll('ids').filter((v): v is string => typeof v === 'string');
		return async ({ result, update }) => {
			if (result.type === 'success' || result.type === 'failure') {
				if (result.data?.success) {
					const moved = Number(result.data.moved ?? 0);
					const skipped = Number(result.data.skipped ?? 0);
					showToast(
						skipped > 0
							? `Moved ${moved} note${moved === 1 ? '' : 's'}; skipped ${skipped} you can't move.`
							: `Moved ${moved} note${moved === 1 ? '' : 's'}.`,
						'success'
					);
					bulkMoveModal?.close();
					// Moved notes have left this workspace-scoped view; drop them now
					// rather than waiting on the reload (same reason as the single move).
					if (moved > 0) {
						for (const id of ids) movedIds.add(id);
					}
					selectedIds.clear();
				} else if (result.data?.message) {
					showToast(result.data.message as string, 'error');
				}
			}
			await update({ invalidateAll: false });
			bulkMoving = false;
		};
	};

	let bulkDeleting = $state(false);
	const handleBulkDelete: SubmitFunction = () => {
		bulkDeleting = true;
		bulkHardDeleteArmed = false;
		return ({ result, update }) => {
			if (result.type === 'success' || result.type === 'failure') {
				if (result.data?.success) {
					const deleted = Number(result.data.deleted ?? 0);
					// Skipped notes are ones the caller doesn't own — deleting is
					// author-only, so this is expected, not a failure.
					const skipped = Number(result.data.failed ?? 0);
					const verb = result.data.hard ? 'Permanently deleted' : 'Deleted';
					showToast(
						skipped > 0
							? `${verb} ${deleted} note${deleted === 1 ? '' : 's'}; skipped ${skipped} you don't own.`
							: `${verb} ${deleted} note${deleted === 1 ? '' : 's'}.`,
						'success'
					);
					bulkDeleteModal?.close();
					selectedIds.clear();
				} else if (result.data?.message) {
					showToast(result.data.message as string, 'error');
				}
			}
			update();
			bulkDeleting = false;
		};
	};

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

	let hardDeleting = $state(false);
	// Two-click guard: the first click arms the button, the second submits.
	let hardDeleteArmed = $state(false);
	const handleHardDelete: SubmitFunction = () => {
		hardDeleting = true;
		hardDeleteArmed = false;
		return ({ result, update }) => {
			if (result.type === 'success' || result.type === 'failure') {
				if (result.data?.success) {
					showToast('Note permanently deleted.', 'success');
					deleteModal?.close();
				} else if (result.data?.message) {
					showToast(result.data.message as string, 'error');
				}
			}
			update();
			hardDeleting = false;
		};
	};

	let moving = $state(false);
	const handleMove: SubmitFunction = ({ formData }) => {
		moving = true;
		const movedPublicId = formData.get('id');
		return async ({ result, update }) => {
			if (result.type === 'success' || result.type === 'failure') {
				if (result.data?.success) {
					showToast(
						result.data.moved ? 'Note moved.' : 'Note is already in that workspace.',
						'success'
					);
					moveModal?.close();
					// The list is scoped to a single workspace and the destination is
					// always a different one (the submit button is disabled otherwise),
					// so a moved note has left this view — drop the row now instead of
					// waiting on the reload, which would leave it visible in between.
					if (result.data.moved && typeof movedPublicId === 'string') {
						movedIds.add(movedPublicId);
					}
				} else if (result.data?.message) {
					showToast(result.data.message as string, 'error');
				}
			}
			// `invalidateAll: false` keeps our optimistic removal from being clobbered
			// by a re-run of load while the toast is still up; the next navigation
			// re-fetches normally.
			await update({ invalidateAll: false });
			moving = false;
		};
	};

	function openMoveModal(note: (typeof data.notes)[0]) {
		noteToMove = note;
		moveTargetOrgId = note.orgId ?? '';
		moveModal.showModal();
	}

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

<div class="mx-auto max-w-4xl text-base-content">
	<section class="container mx-auto py-4">
		<h1 class="text-2xl leading-tight font-bold text-base-content md:text-3xl">
			{data.activeOrg ? `${data.activeOrg.name} notes` : 'My notes'}
		</h1>
		<p class="mt-1 text-sm text-base-content/60">
			{#if data.activeOrg}
				Everything published to <code class="rounded bg-base-200 px-1"
					>mdpubs-company: {data.activeOrg.slug}</code
				> by any member.
			{:else}
				Your personal notes — not filed under a company.
			{/if}
		</p>
	</section>

	<section class="container mx-auto">
		<div class="mb-4">
			<form method="GET" class="flex gap-2">
				<!-- Keep the active workspace when searching; a bare GET would drop it. -->
				{#if data.activeOrg}
					<input type="hidden" name="org" value={data.activeOrg.slug} />
				{/if}
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

		{#if selected.length > 0}
			<div
				class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-base-300 bg-base-200 px-4 py-2"
			>
				<span class="text-sm font-medium">
					{selected.length} selected
				</span>
				<button type="button" class="btn btn-ghost btn-xs" onclick={() => selectedIds.clear()}>
					Clear
				</button>
				<div class="ml-auto flex gap-2">
					<button
						type="button"
						class="btn btn-sm"
						onclick={() => {
							bulkMoveTargetOrgId = canBulkMovePersonal ? '' : (data.orgs[0]?.id ?? '');
							bulkMoveModal.showModal();
						}}
					>
						Move
					</button>
					<button
						type="button"
						class="btn btn-error btn-sm"
						onclick={() => {
							bulkHardDeleteArmed = false;
							bulkDeleteModal.showModal();
						}}
					>
						Delete
					</button>
				</div>
			</div>
		{/if}

		<div class="overflow-x-auto">
			<table class="table">
				<thead>
					<tr>
						<th class="w-0">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								aria-label="Select all notes"
								checked={allSelected}
								indeterminate={someSelected}
								disabled={visibleNotes.length === 0}
								onchange={toggleAll}
							/>
						</th>
						<th>ID</th>
						<th>Title</th>
						<th>Updated At</th>
						<th>Is Private?</th>
						<th class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each visibleNotes as note (note.id)}
						<tr class:bg-base-200={selectedIds.has(note.publicId)}>
							<td class="w-0">
								<input
									type="checkbox"
									class="checkbox checkbox-sm"
									aria-label="Select note {note.title || 'Untitled'}"
									checked={selectedIds.has(note.publicId)}
									onchange={() => toggleOne(note.publicId)}
								/>
							</td>
							<td>{note.id}</td>
							<td>
								{#if note.isPrivate}
									<button
										type="button"
										class="link p-0 text-left"
										onclick={() => showViewModal(note)}>{note.title || 'Untitled'}</button
									>
								{:else}
									<a
										href={resolve('/(public)/[id]', { id: note.publicId })}
										class="link"
										target="_blank"
										rel="noopener noreferrer">{note.title || 'Untitled'}</a
									>
								{/if}
							</td>
							<td>{formatDateTime(note.updatedAt)}</td>
							<td>
								{@render visibilityBadge(note)}
							</td>
							<td class="text-right whitespace-nowrap">
								<button type="button" class="btn btn-sm" onclick={() => openMoveModal(note)}>
									Move
								</button>
								<button
									type="button"
									class="btn btn-error btn-sm"
									onclick={() => {
										noteToDelete = note;
										hardDeleteArmed = false;
										deleteModal.showModal();
									}}
								>
									Delete
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="6" class="text-center">No notes found.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if data.totalPages > 1}
			<div class="join mt-4 flex justify-center">
				{#if data.currentPage > 1}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={getSearchURL(data.currentPage - 1)} class="join-item btn">«</a>
				{:else}
					<button class="join-item btn btn-disabled">«</button>
				{/if}
				<button class="join-item btn">Page {data.currentPage} of {data.totalPages}</button>
				{#if data.currentPage < data.totalPages}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
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

<dialog id="move_modal" class="modal" bind:this={moveModal}>
	<div class="modal-box">
		<h3 class="text-lg font-bold">Move note</h3>
		{#if noteToMove}
			<p class="mt-1 text-sm text-base-content/60">
				"{noteToMove.title || 'Untitled'}" — choose the workspace it should be filed under. This is
				the same as changing its <code class="rounded bg-base-200 px-1">mdpubs-company</code>
				frontmatter, so re-syncing from Neovim with the old value will move it back.
			</p>
			<form method="POST" action="?/move" use:enhance={handleMove} class="mt-4">
				<input type="hidden" name="id" value={noteToMove.publicId} />
				<select name="orgId" class="select select-bordered w-full" bind:value={moveTargetOrgId}>
					<option value="" disabled={noteToMove.userId !== data.user.id}>
						Personal (no company)
					</option>
					{#each data.orgs as org (org.id)}
						<option value={org.id}>{org.name}</option>
					{/each}
				</select>
				<div class="modal-action">
					<button type="button" class="btn" onclick={() => moveModal.close()}>Cancel</button>
					<button
						type="submit"
						class="btn btn-primary"
						class:btn-disabled={moving || moveTargetOrgId === (noteToMove.orgId ?? '')}
					>
						{#if moving}
							<span class="loading loading-spinner loading-sm"></span>
						{/if}
						Move
					</button>
				</div>
			</form>
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop">
		<button></button>
	</form>
</dialog>

<dialog id="bulk_move_modal" class="modal" bind:this={bulkMoveModal}>
	<div class="modal-box">
		<h3 class="text-lg font-bold">Move {selected.length} note{selected.length === 1 ? '' : 's'}</h3>
		<p class="mt-1 text-sm text-base-content/60">
			Choose the workspace they should be filed under. This is the same as changing each note's
			<code class="rounded bg-base-200 px-1">mdpubs-company</code> frontmatter, so re-syncing from Neovim
			with the old value will move them back.
		</p>
		{#if !canBulkMovePersonal}
			<p class="mt-2 text-xs text-base-content/50">
				Your selection includes notes authored by someone else, so Personal isn't available — only a
				note's author can move it there.
			</p>
		{/if}
		<form method="POST" action="?/bulkMove" use:enhance={handleBulkMove} class="mt-4">
			{#each selected as note (note.publicId)}
				<input type="hidden" name="ids" value={note.publicId} />
			{/each}
			<select name="orgId" class="select select-bordered w-full" bind:value={bulkMoveTargetOrgId}>
				<option value="" disabled={!canBulkMovePersonal}>Personal (no company)</option>
				{#each data.orgs as org (org.id)}
					<option value={org.id}>{org.name}</option>
				{/each}
			</select>
			<div class="modal-action">
				<button type="button" class="btn" onclick={() => bulkMoveModal.close()}>Cancel</button>
				<button type="submit" class="btn btn-primary" class:btn-disabled={bulkMoving}>
					{#if bulkMoving}
						<span class="loading loading-spinner loading-sm"></span>
					{/if}
					Move
				</button>
			</div>
		</form>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button></button>
	</form>
</dialog>

<dialog
	id="bulk_delete_modal"
	class="modal"
	bind:this={bulkDeleteModal}
	onclose={() => {
		bulkHardDeleteArmed = false;
	}}
>
	<div class="modal-box">
		<h3 class="text-lg font-bold">Confirm Deletion</h3>
		<p class="py-4">
			Delete {selected.length} note{selected.length === 1 ? '' : 's'}? Only notes you authored can
			be deleted — any others in your selection are skipped.
		</p>
		<div class="modal-action">
			<form method="dialog">
				<button class="btn">Cancel</button>
			</form>
			<form method="POST" action="?/bulkDelete" use:enhance={handleBulkDelete}>
				{#each selected as note (note.publicId)}
					<input type="hidden" name="ids" value={note.publicId} />
				{/each}
				<button type="submit" class="btn btn-error" class:btn-disabled={bulkDeleting}>
					{#if bulkDeleting}
						<span class="loading loading-spinner"></span>
					{/if}
					Confirm Delete
				</button>
			</form>
		</div>
		<div class="mt-3 flex flex-col items-center gap-1">
			<form method="POST" action="?/bulkDelete" use:enhance={handleBulkDelete}>
				{#each selected as note (note.publicId)}
					<input type="hidden" name="ids" value={note.publicId} />
				{/each}
				<input type="hidden" name="hard" value="true" />
				{#if bulkHardDeleteArmed}
					<button type="submit" class="btn btn-error btn-xs" class:btn-disabled={bulkDeleting}>
						{#if bulkDeleting}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Click again to permanently delete {selected.length}
					</button>
				{:else}
					<button
						type="button"
						class="btn btn-ghost btn-xs text-error"
						class:btn-disabled={bulkDeleting}
						onclick={() => (bulkHardDeleteArmed = true)}
					>
						Hard delete permanently
					</button>
				{/if}
			</form>
			<span class="text-xs text-base-content/60">
				{#if bulkHardDeleteArmed}
					This cannot be undone. Click the red button to permanently remove them.
				{:else}
					Removes the notes and their images from the database and Cloudflare. Cannot be restored.
				{/if}
			</span>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop">
		<button></button>
	</form>
</dialog>

<dialog
	id="delete_modal"
	class="modal"
	bind:this={deleteModal}
	onclose={() => {
		hardDeleteArmed = false;
	}}
>
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
					<input type="hidden" name="id" value={noteToDelete.publicId} />
					<button type="submit" class="btn btn-error" class:btn-disabled={deleting || hardDeleting}>
						{#if deleting}
							<span class="loading loading-spinner"></span>
						{/if}
						Confirm Delete</button
					>
				</form>
			{/if}
		</div>
		{#if noteToDelete}
			<div class="mt-3 flex flex-col items-center gap-1">
				<form method="POST" action="?/hardDelete" use:enhance={handleHardDelete}>
					<input type="hidden" name="id" value={noteToDelete.publicId} />
					{#if hardDeleteArmed}
						<button
							type="submit"
							class="btn btn-error btn-xs"
							class:btn-disabled={deleting || hardDeleting}
						>
							{#if hardDeleting}
								<span class="loading loading-spinner loading-xs"></span>
							{/if}
							Click again to confirm permanent delete
						</button>
					{:else}
						<button
							type="button"
							class="btn btn-ghost btn-xs text-error"
							class:btn-disabled={deleting || hardDeleting}
							onclick={() => (hardDeleteArmed = true)}
						>
							Hard delete permanently
						</button>
					{/if}
				</form>
				<span class="text-xs text-base-content/60">
					{#if hardDeleteArmed}
						This cannot be undone. Click the red button to permanently remove it.
					{:else}
						Removes the note and its images from the database and Cloudflare. Cannot be restored.
					{/if}
				</span>
			</div>
		{/if}
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
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
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
	<div class={`badge ${note?.isPrivate ? 'badge-neutral' : 'badge-primary'}  badge-outline`}>
		{note?.isPrivate ? 'private' : 'public'}
	</div>
{/snippet}
