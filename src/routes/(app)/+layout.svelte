<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		Building2,
		CircleUser,
		FileText,
		KeyRound,
		LogOut,
		Menu,
		Pencil,
		Users
	} from 'lucide-svelte';
	import { page } from '$app/state';
	import CompanySwitcher from '$lib/components/CompanySwitcher.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	/**
	 * The active workspace comes from `?org=<slug>` so it survives reloads and
	 * shared links. An unknown or non-member slug resolves to null (Personal)
	 * rather than erroring — the list here only ever contains orgs the user
	 * belongs to, so this doubles as the membership check.
	 */
	let activeOrg = $derived(
		data.orgs.find((o) => o.slug === page.url.searchParams.get('org')) ?? null
	);

	/** Preserve the workspace across sidebar navigation. */
	function withOrg(path: string): string {
		return activeOrg ? `${path}?org=${activeOrg.slug}` : path;
	}

	let nav = $derived([
		{ label: 'Notes', href: withOrg('/notes'), icon: FileText, match: '/notes' },
		...(activeOrg
			? [
					{
						label: 'Members',
						href: `/orgs/${activeOrg.id}/members`,
						icon: Users,
						match: `/orgs/${activeOrg.id}/members`
					},
					{
						label: 'Company settings',
						href: `/orgs/${activeOrg.id}`,
						icon: Building2,
						// Exact-match so "Company settings" isn't highlighted on the
						// nested /members page, which has its own entry above.
						match: `/orgs/${activeOrg.id}`,
						exact: true
					}
				]
			: [{ label: 'Companies', href: '/orgs', icon: Building2, match: '/orgs', exact: true }]),
		{ label: 'API keys', href: '/account', icon: KeyRound, match: '/account' }
	]);

	function isActive(item: { match: string; exact?: boolean }): boolean {
		return item.exact ? page.url.pathname === item.match : page.url.pathname.startsWith(item.match);
	}

	// Mobile drawer state; the sidebar is always visible from `lg` up.
	let drawerOpen = $state(false);

	/**
	 * /api/auth/logout is a JSON endpoint (not a form action), so POST via fetch and
	 * navigate ourselves — a plain form submit would render the JSON response.
	 */
	async function signOut() {
		await fetch('/api/auth/logout', { method: 'POST' });
		// Full document navigation so all cached load data for the (now dead)
		// session is discarded.
		window.location.href = '/login';
	}
</script>

<div class="drawer lg:drawer-open">
	<input id="dashboard-drawer" type="checkbox" class="drawer-toggle" bind:checked={drawerOpen} />

	<div class="drawer-content flex min-h-screen flex-col bg-base-200/40">
		<!-- Mobile top bar: the sidebar collapses into a drawer below `lg`. -->
		<header
			class="sticky top-0 z-10 flex items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2 lg:hidden"
		>
			<label for="dashboard-drawer" class="btn btn-ghost btn-sm" aria-label="Open menu">
				<Menu class="h-5 w-5" />
			</label>
			<a href="/notes" class="flex items-center gap-2">
				<Pencil class="h-5 w-5 text-primary" />
				<span class="font-bold">MdPubs</span>
			</a>
		</header>

		<main class="flex-1 p-4 md:p-8">
			{@render children()}
		</main>
	</div>

	<div class="drawer-side z-20">
		<label for="dashboard-drawer" aria-label="Close menu" class="drawer-overlay"></label>

		<aside class="flex h-full w-72 flex-col border-r border-base-300 bg-base-100">
			<div class="flex items-center gap-2 px-4 py-4">
				<Pencil class="h-6 w-6 text-primary" />
				<span class="text-lg font-bold">MdPubs</span>
			</div>

			<!-- Company switcher (Personal + every org the user belongs to). -->
			<div class="border-y border-base-300 px-2 py-2">
				<CompanySwitcher orgs={data.orgs} activeOrgId={activeOrg?.id ?? null} />
			</div>

			<ul class="menu flex-1 gap-1 px-2 py-3">
				{#each nav as item (item.href)}
					<li>
						<a
							href={item.href}
							class={isActive(item) ? 'active font-medium' : ''}
							onclick={() => (drawerOpen = false)}
						>
							<item.icon class="h-4 w-4" />
							{item.label}
						</a>
					</li>
				{/each}
			</ul>

			<!-- Account footer -->
			<div class="border-t border-base-300 p-2">
				<div class="flex items-center gap-2 px-2 py-2">
					<CircleUser class="h-8 w-8 flex-shrink-0 text-base-content/60" />
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium">
							{data.user?.username ?? data.user?.email}
						</div>
						<div class="truncate text-xs text-base-content/60">
							{data.user?.plan ?? 'free'} plan
						</div>
					</div>
				</div>
				<button
					type="button"
					class="btn btn-ghost btn-sm w-full justify-start gap-2"
					onclick={signOut}
				>
					<LogOut class="h-4 w-4" />
					Sign out
				</button>
			</div>
		</aside>
	</div>
</div>
