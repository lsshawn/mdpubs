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
		Settings,
		Users
	} from 'lucide-svelte';
	import { navigating, page } from '$app/state';
	import { resolve } from '$app/paths';
	import CompanySwitcher from '$lib/components/CompanySwitcher.svelte';
	import FeedbackWidget from '$lib/components/FeedbackWidget.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Local to this shell — the root layout owns its own copy for the floating
	// (desktop) widget, and the two are never mounted at the same breakpoint.
	let feedbackMessage = $state('');
	let feedbackEmail = $state(data.user?.email ?? '');
	let feedbackName = $state('');

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

	/**
	 * Sidebar nav. Company-scoped entries (Members, Company settings) appear only
	 * in a company workspace. Personal shows just Notes — companies are reached
	 * through the switcher above, so a "Companies" entry here was a second door to
	 * the same place. API keys are per-user, not per-company, so they live in the
	 * account menu at the bottom rather than in this list.
	 */
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
			: [])
	]);

	// Account menu (gear next to the profile name).
	let accountMenuOpen = $state(false);

	/**
	 * True while a navigation changes the active workspace, i.e. `?org=` differs
	 * between the current and target URLs. Scoped this narrowly on purpose: every
	 * other navigation keeps its own loading affordances, and swapping the whole
	 * page for a skeleton on ordinary link clicks would be a downgrade.
	 */
	let switchingWorkspace = $derived.by(() => {
		const to = navigating.to?.url;
		if (!to) return false;
		return to.searchParams.get('org') !== page.url.searchParams.get('org');
	});

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
			<!--
				Feedback lives here on mobile rather than as a floating button: the FAB
				sat over the note list and collided with the browser's own bottom bar.
				The root layout renders the floating version only from `md` up, so the
				two never appear at once.
			-->
			<div class="ml-auto">
				<FeedbackWidget
					bind:message={feedbackMessage}
					bind:email={feedbackEmail}
					bind:name={feedbackName}
					variant="navbar"
				/>
			</div>
		</header>

		<main class="flex-1 p-4 md:p-8">
			{#if switchingWorkspace}
				<!-- Switching companies refetches every scoped load, so the old
				     workspace's notes would otherwise sit there looking current until
				     the server answers. A skeleton makes the switch feel immediate and
				     stops anyone reading stale rows as the new company's. -->
				<div class="mx-auto max-w-4xl" aria-busy="true" aria-live="polite">
					<span class="sr-only">Loading workspace…</span>
					<div class="py-4">
						<div class="skeleton h-8 w-64"></div>
						<div class="skeleton mt-2 h-4 w-96"></div>
					</div>
					<div class="skeleton mt-4 h-12 w-full max-w-xs"></div>
					<div class="mt-6 space-y-2">
						{#each Array(8), i (i)}
							<div class="skeleton h-12 w-full"></div>
						{/each}
					</div>
				</div>
			{:else}
				{@render children()}
			{/if}
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

			<!-- `w-full` on the menu and its rows so each item's hover/active
			     background spans the full sidebar width instead of hugging its label. -->
			<ul class="menu w-full flex-1 gap-1 px-2 py-3">
				{#each nav as item (item.href)}
					<li class="w-full">
						<a
							href={item.href}
							class="flex w-full items-center gap-2 {isActive(item) ? 'active font-medium' : ''}"
							onclick={() => (drawerOpen = false)}
						>
							<item.icon class="h-4 w-4 flex-shrink-0" />
							<span class="truncate">{item.label}</span>
						</a>
					</li>
				{/each}
			</ul>

			<!-- Account footer: identity plus a gear that opens the account menu. -->
			<div class="border-t border-base-300 p-2">
				<div class="relative flex items-center gap-2 px-2 py-2">
					<CircleUser class="h-8 w-8 flex-shrink-0 text-base-content/60" />
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium">
							{data.user?.username ?? data.user?.email}
						</div>
						<div class="truncate text-xs text-base-content/60">
							{data.user?.plan ?? 'free'} plan
						</div>
					</div>

					<button
						type="button"
						class="btn btn-ghost btn-sm btn-square flex-shrink-0"
						aria-label="Account menu"
						aria-haspopup="menu"
						aria-expanded={accountMenuOpen}
						onclick={() => (accountMenuOpen = !accountMenuOpen)}
					>
						<Settings class="h-4 w-4" />
					</button>

					{#if accountMenuOpen}
						<!-- Click-away closes the menu; a plain overlay avoids a global listener. -->
						<button
							type="button"
							class="fixed inset-0 z-10 cursor-default"
							aria-label="Close account menu"
							onclick={() => (accountMenuOpen = false)}
						></button>
						<!-- Opens upward: the trigger sits at the bottom of the sidebar. -->
						<ul
							class="menu absolute right-0 bottom-full z-20 mb-1 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
						>
							<li>
								<a
									href={resolve('/(app)/account')}
									class="flex items-center gap-2"
									onclick={() => {
										accountMenuOpen = false;
										drawerOpen = false;
									}}
								>
									<KeyRound class="h-4 w-4" />
									API keys
								</a>
							</li>
							<li>
								<button type="button" class="flex items-center gap-2" onclick={signOut}>
									<LogOut class="h-4 w-4" />
									Sign out
								</button>
							</li>
						</ul>
					{/if}
				</div>
			</div>
		</aside>
	</div>
</div>
