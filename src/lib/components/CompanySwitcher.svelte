<script lang="ts">
	import { Building2, Check, ChevronsUpDown, Plus, User } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	type Org = { id: string; slug: string; name: string; role: string };

	let {
		orgs,
		activeOrgId = null
	}: {
		orgs: Org[];
		/** null = the "Personal" workspace. */
		activeOrgId?: string | null;
	} = $props();

	let active = $derived(orgs.find((o) => o.id === activeOrgId) ?? null);
	let open = $state(false);

	/**
	 * Switching workspace is a URL change, not client-only state, so a reload or a
	 * shared link lands in the same workspace. `?org=<slug>` (absent = Personal) is
	 * read by the page loads that scope their data.
	 */
	async function select(org: Org | null) {
		open = false;
		const url = new URL(page.url);
		if (org) url.searchParams.set('org', org.slug);
		else url.searchParams.delete('org');
		// Drop pagination when the workspace changes — page 3 of the old workspace
		// is meaningless in the new one.
		url.searchParams.delete('page');
		await goto(url, { invalidateAll: true });
	}
</script>

<div class="dropdown w-full">
	<button
		type="button"
		class="btn btn-ghost h-auto w-full justify-between px-3 py-2 normal-case"
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="flex min-w-0 items-center gap-2">
			<span class="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-primary/10">
				{#if active}
					<Building2 class="h-4 w-4 text-primary" />
				{:else}
					<User class="h-4 w-4 text-primary" />
				{/if}
			</span>
			<span class="flex min-w-0 flex-col items-start">
				<span class="w-full truncate text-sm font-semibold">
					{active ? active.name : 'Personal'}
				</span>
				<span class="text-xs text-base-content/60">
					{active ? active.role : 'Your own notes'}
				</span>
			</span>
		</span>
		<ChevronsUpDown class="h-4 w-4 flex-shrink-0 text-base-content/50" />
	</button>

	{#if open}
		<!-- Click-away closes the menu; a plain overlay avoids a global listener. -->
		<button
			type="button"
			class="fixed inset-0 z-10 cursor-default"
			aria-label="Close workspace menu"
			onclick={() => (open = false)}
		></button>
		<ul
			class="menu dropdown-content z-20 mt-1 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
			role="listbox"
		>
			<li class="menu-title text-xs">Personal</li>
			<li>
				<button type="button" class="flex items-center gap-2" onclick={() => select(null)}>
					<User class="h-4 w-4" />
					<span class="flex-1 truncate text-left">Personal</span>
					{#if !active}<Check class="h-4 w-4 text-primary" />{/if}
				</button>
			</li>

			{#if orgs.length}
				<li class="menu-title text-xs">Companies</li>
				{#each orgs as org (org.id)}
					<li>
						<button type="button" class="flex items-center gap-2" onclick={() => select(org)}>
							<Building2 class="h-4 w-4" />
							<span class="flex-1 truncate text-left">{org.name}</span>
							{#if active?.id === org.id}<Check class="h-4 w-4 text-primary" />{/if}
						</button>
					</li>
				{/each}
			{/if}

			<li class="mt-1 border-t border-base-300 pt-1">
				<a href="/orgs" onclick={() => (open = false)} class="flex items-center gap-2">
					<Plus class="h-4 w-4" />
					<span>New company</span>
				</a>
			</li>
		</ul>
	{/if}
</div>
