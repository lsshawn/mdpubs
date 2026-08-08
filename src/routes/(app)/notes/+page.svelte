<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { enhance } from '$app/forms';
	// SvelteKit 2.50 no longer exports `SubmitFunction` by name; derive it from
	// `enhance`'s own signature so it tracks whatever the installed version uses.
	type SubmitFunction = NonNullable<Parameters<typeof enhance>[1]>;
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { formatDate } from '$lib/helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import { FolderInput, MoreVertical, Pencil, Trash2 } from 'lucide-svelte';
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
	 * to — after a move, delete, or page change.
	 */
	const selectedIds = new SvelteSet<string>();
	let selected = $derived(visibleNotes.filter((n) => selectedIds.has(n.publicId)));
	let allSelected = $derived(visibleNotes.length > 0 && selected.length === visibleNotes.length);
	// Header checkbox shows a dash when the selection is a strict subset.
	let someSelected = $derived(selected.length > 0 && !allSelected);

	/**
	 * publicId of the row whose mobile action menu is open, or null. Only one is
	 * ever open — opening another replaces it.
	 */
	let openMenuId = $state<string | null>(null);

	$effect(() => {
		const present = new Set(visibleNotes.map((n) => n.publicId));
		for (const id of selectedIds) {
			if (!present.has(id)) selectedIds.delete(id);
		}
		// A menu whose row has gone (moved, deleted, page change) would otherwise
		// stay mounted with no anchor.
		if (openMenuId !== null && !present.has(openMenuId)) openMenuId = null;
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
	let creating = $state(false);
	/**
	 * The action redirects into the new note's editor on success, so the only case
	 * to handle here is failure (note limit reached, storage unconfigured) — a
	 * redirect result is applied by `enhance` itself.
	 */
	const handleCreate: SubmitFunction = () => {
		creating = true;
		return async ({ result, update }) => {
			if (result.type === 'failure' && result.data?.message) {
				showToast(result.data.message as string, 'error');
			}
			await update();
			creating = false;
		};
	};

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

	/**
	 * A note's own page: its editor when we authored it, otherwise the public view
	 * (a colleague's note in a shared company library isn't ours to edit) or the
	 * read-only modal when it's private and so has no public URL.
	 */
	function canEdit(note: (typeof data.notes)[0]) {
		return note.userId === data.user.id;
	}

	/** Same URL with `page` swapped, preserving `org` and anything else present. */
	function getPageURL(p: number) {
		const url = new URL($page.url);
		url.searchParams.set('page', p.toString());
		return url.href;
	}
</script>

<div class="mx-auto max-w-4xl text-base-content">
	<header class="flex flex-wrap items-center gap-x-3 gap-y-2 py-1">
		<h1 class="text-xl leading-tight font-semibold tracking-tight md:text-2xl">
			{data.activeOrg ? data.activeOrg.name : 'My notes'}
		</h1>
		{#if data.totalNotes > 0}
			<span class="text-sm text-base-content/40">{data.totalNotes}</span>
		{/if}

		<!--
			Creates the note server-side then redirects into the editor, so the
			editor always opens against a real note (it needs an id for autosave,
			preview, and asset upload).
		-->
		<form method="POST" action="?/create" use:enhance={handleCreate} class="ml-auto">
			<button type="submit" class="btn btn-primary btn-sm" disabled={creating}>
				{creating ? 'Creating…' : 'New note'}
			</button>
		</form>
	</header>

	<!--
		One fixed-height row that swaps contents rather than two rows that appear and
		disappear: selecting a note replaces the workspace description with the bulk
		actions in place, so the list below never jumps. `h-8` is sized to the tallest
		occupant (the `btn-xs`/`btn-sm` bulk row) and is reserved even when the row
		shows only the description, which is why there is no shift in either
		direction.
	-->
	<div class="mt-1 flex h-8 items-center">
		{#if selected.length > 0}
			<div class="flex w-full items-center gap-2">
				<span class="text-sm font-medium">{selected.length} selected</span>
				<button type="button" class="btn btn-ghost btn-xs" onclick={() => selectedIds.clear()}>
					Clear
				</button>
				<div class="ml-auto flex gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-xs sm:btn-sm"
						onclick={() => {
							bulkMoveTargetOrgId = canBulkMovePersonal ? '' : (data.orgs[0]?.id ?? '');
							bulkMoveModal.showModal();
						}}
					>
						Move
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-xs text-error sm:btn-sm"
						onclick={() => {
							bulkHardDeleteArmed = false;
							bulkDeleteModal.showModal();
						}}
					>
						Delete
					</button>
				</div>
			</div>
		{:else}
			<p class="truncate text-sm text-base-content/50">
				{#if data.activeOrg}
					Shared library — everything filed under <code class="rounded bg-base-200 px-1"
						>{data.activeOrg.slug}</code
					>.
				{:else}
					Your personal notes.
				{/if}
			</p>
		{/if}
	</div>

	{#if visibleNotes.length === 0}
		<div class="mt-10 py-12 text-center">
			<p class="text-sm text-base-content/60">Nothing here yet.</p>
		</div>
	{:else}
		<!--
			Two presentations of one list. Below `md` a table can only be reached by
			horizontal scrolling, so each note becomes a stacked row; from `md` up the
			table returns, since scanning many notes by column is what it's good at.
		-->
		<ul class="mt-3 divide-y divide-base-300 border-y border-base-300 md:hidden">
			{#each visibleNotes as note, i (note.id)}
				<li class="flex items-center gap-3 py-3" class:bg-base-200={selectedIds.has(note.publicId)}>
					<input
						type="checkbox"
						class="checkbox checkbox-sm flex-shrink-0"
						aria-label="Select note {note.title || 'Untitled'}"
						checked={selectedIds.has(note.publicId)}
						onchange={() => toggleOne(note.publicId)}
					/>
					<div class="min-w-0 flex-1">
						{@render noteTitle(note)}
						<div class="mt-1 flex items-center gap-2 text-xs text-base-content/50">
							<span>{formatDate(note.updatedAt)}</span>
							{#if note.isPrivate}
								<span>· Private</span>
							{/if}
						</div>
					</div>
					<!--
						Three inline buttons cost ~120px of a phone's width, squeezing the
						title into a stub. One trigger collapses that to ~40px and gives the
						row back to the title.

						`dropdown-end` right-aligns the menu under the trigger, which sits at
						the row's right edge — without it the menu would hang off-screen.
						The last rows open upward instead, so a menu near the bottom of a
						full page isn't clipped by the viewport.
					-->
					<div
						class="dropdown dropdown-end flex-shrink-0"
						class:dropdown-top={i >= visibleNotes.length - 2 && visibleNotes.length > 3}
					>
						<button
							type="button"
							class="btn btn-ghost btn-sm btn-square"
							aria-label="Actions for {note.title || 'Untitled'}"
							aria-haspopup="menu"
							aria-expanded={openMenuId === note.publicId}
							onclick={() => (openMenuId = openMenuId === note.publicId ? null : note.publicId)}
						>
							<MoreVertical class="h-4 w-4" />
						</button>

						{#if openMenuId === note.publicId}
							<!--
								Explicit open state + a click-away overlay, matching
								CompanySwitcher and the sidebar account menu. DaisyUI's
								CSS-only `:focus-within` dropdown is unreliable on touch —
								tapping an item can blur the trigger and close the menu before
								the click lands.
							-->
							<button
								type="button"
								class="fixed inset-0 z-10 cursor-default"
								aria-label="Close actions menu"
								onclick={() => (openMenuId = null)}
							></button>
							<ul
								class="menu dropdown-content z-20 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
							>
								{#if canEdit(note)}
									<li>
										<a
											href={resolve('/(app)/notes/[id]/edit', { id: note.publicId })}
											class="flex items-center gap-2"
										>
											<Pencil class="h-4 w-4" />
											Edit
										</a>
									</li>
								{/if}
								<li>
									<button
										type="button"
										class="flex items-center gap-2"
										onclick={() => {
											openMenuId = null;
											openMoveModal(note);
										}}
									>
										<FolderInput class="h-4 w-4" />
										Move
									</button>
								</li>
								<li>
									<button
										type="button"
										class="flex items-center gap-2 text-error"
										onclick={() => {
											openMenuId = null;
											noteToDelete = note;
											hardDeleteArmed = false;
											deleteModal.showModal();
										}}
									>
										<Trash2 class="h-4 w-4" />
										Delete
									</button>
								</li>
							</ul>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<table class="mt-3 hidden w-full table-fixed border-collapse text-sm md:table">
			<!--
				Fixed layout with explicit widths on every column but the title: the
				title then absorbs all remaining space and the meta columns stop
				jittering between pages as ID and date lengths change.
			-->
			<thead>
				<tr class="border-b border-base-300 text-left text-xs font-medium text-base-content/50">
					<th class="w-9 py-2 pl-1 font-medium">
						<input
							type="checkbox"
							class="checkbox checkbox-sm align-middle"
							aria-label="Select all notes"
							checked={allSelected}
							indeterminate={someSelected}
							onchange={toggleAll}
						/>
					</th>
					<th class="py-2 pr-3 font-medium">Title</th>
					<th class="w-24 py-2 pr-3 font-medium">Visibility</th>
					<th class="w-28 py-2 pr-3 font-medium">Updated</th>
					<th class="w-28 py-2 font-medium"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each visibleNotes as note (note.id)}
					<!--
						`group` drives the hover-reveal on the action buttons: quiet rows
						while scanning, controls the moment the pointer lands on one. They
						stay in the DOM (opacity only) so tabbing still reaches them, and
						`focus-within` shows them for keyboard users.
					-->
					<tr
						class="group border-b border-base-300/60 hover:bg-base-200/50"
						class:bg-base-200={selectedIds.has(note.publicId)}
					>
						<td class="py-2 pl-1">
							<input
								type="checkbox"
								class="checkbox checkbox-sm align-middle"
								aria-label="Select note {note.title || 'Untitled'}"
								checked={selectedIds.has(note.publicId)}
								onchange={() => toggleOne(note.publicId)}
							/>
						</td>
						<td class="min-w-0 py-2 pr-3">{@render noteTitle(note)}</td>
						<td class="py-2 pr-3 text-xs text-base-content/50">
							{note.isPrivate ? 'Private' : 'Public'}
						</td>
						<td class="py-2 pr-3 text-xs whitespace-nowrap text-base-content/50">
							{formatDate(note.updatedAt)}
						</td>
						<td class="py-2">
							<div
								class="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
							>
								<!--
									Editing is author-only (the editor's load enforces the same
									rule), so a colleague's note in a shared company library shows
									no Edit button rather than a link to a 404.
								-->
								{#if canEdit(note)}
									<a
										href={resolve('/(app)/notes/[id]/edit', { id: note.publicId })}
										class="btn btn-ghost btn-xs btn-square"
										aria-label="Edit {note.title || 'Untitled'}"
									>
										<Pencil class="h-3.5 w-3.5" />
									</a>
								{/if}
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-square"
									aria-label="Move {note.title || 'Untitled'}"
									onclick={() => openMoveModal(note)}
								>
									<FolderInput class="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									class="btn btn-ghost btn-xs btn-square text-error"
									aria-label="Delete {note.title || 'Untitled'}"
									onclick={() => {
										noteToDelete = note;
										hardDeleteArmed = false;
										deleteModal.showModal();
									}}
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if data.totalPages > 1}
		<div class="mt-6 flex items-center justify-center gap-4 text-sm">
			{#if data.currentPage > 1}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={getPageURL(data.currentPage - 1)} class="btn btn-ghost btn-sm">Previous</a>
			{:else}
				<span class="btn btn-ghost btn-sm btn-disabled">Previous</span>
			{/if}
			<span class="text-xs text-base-content/50">
				{data.currentPage} / {data.totalPages}
			</span>
			{#if data.currentPage < data.totalPages}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={getPageURL(data.currentPage + 1)} class="btn btn-ghost btn-sm">Next</a>
			{:else}
				<span class="btn btn-ghost btn-sm btn-disabled">Next</span>
			{/if}
		</div>
	{/if}
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

{#snippet noteTitle(note: (typeof data.notes)[0])}
	<!--
		A private note has no public URL, so its title opens the read-only modal
		instead. Both render as plain text that only underlines on hover — a list of
		blue underlined links reads as noise when every row is one.

		The title carries inline markdown (`**bold**`, `*em*`, `code`, `~~del~~`),
		rendered server-side into `titleHtml` by renderTitleMarkdown and limited to
		those four tags. It is inline-only on purpose: a block parse would wrap the
		title in <p> and break `truncate`. Empty titles fall back to 'Untitled'.
	-->
	{#if note.isPrivate}
		<button
			type="button"
			class="block w-full truncate text-left font-medium hover:underline"
			onclick={() => showViewModal(note)}
		>
			<span class="note-title"
				>{#if note.titleHtml}{@html note.titleHtml}{:else}Untitled{/if}</span
			>
		</button>
	{:else}
		<a
			href={resolve('/(public)/[id]', { id: note.publicId })}
			class="block truncate font-medium hover:underline"
			target="_blank"
			rel="noopener noreferrer"
		>
			<span class="note-title"
				>{#if note.titleHtml}{@html note.titleHtml}{:else}Untitled{/if}</span
			>
		</a>
	{/if}
{/snippet}

{#snippet visibilityBadge(note: Note)}
	<div class={`badge ${note?.isPrivate ? 'badge-neutral' : 'badge-primary'}  badge-outline`}>
		{note?.isPrivate ? 'private' : 'public'}
	</div>
{/snippet}

<style>
	/*
		Titles are injected with {@html}, which Svelte's scoped styles can't reach —
		hence :global() under a wrapper class. Only the four tags renderTitleMarkdown
		can emit are styled.

		`font-medium` on the link/button already sets the row's weight, so <strong>
		is bumped to 700 to stay visually distinct from an unformatted title.
	*/
	.note-title :global(strong) {
		font-weight: 700;
	}

	/*
		`code` needs a surface to read as code, but the full DaisyUI badge treatment
		is too loud at list density: keep it to a faint tint and a smaller size that
		still sits on the row's baseline without changing line height.
	*/
	.note-title :global(code) {
		border-radius: 0.25rem;
		background-color: color-mix(in oklch, var(--color-base-content) 10%, transparent);
		padding: 0.1em 0.3em;
		font-size: 0.9em;
		font-family: var(--font-mono, ui-monospace, monospace);
	}

	.note-title :global(del) {
		opacity: 0.7;
	}
</style>
