<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let slug = $state('');
	let creating = $state(false);
	let msg = $state<{ type: 'success' | 'error'; text: string } | null>(null);
	let savingDefault = $state(false);

	// Suggest a slug from the name as the user types (until they edit slug directly).
	let slugTouched = $state(false);
	$effect(() => {
		if (!slugTouched) {
			slug = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '');
		}
	});

	async function createOrg(e: SubmitEvent) {
		e.preventDefault();
		if (creating) return;
		creating = true;
		msg = null;
		try {
			const res = await fetch('/api/org', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, slug })
			});
			const result = await res.json();
			if (res.ok && result.success) {
				goto(resolve('/(app)/orgs/[id]', { id: result.org.id }));
			} else {
				msg = { type: 'error', text: result.message ?? 'Could not create the account.' };
			}
		} finally {
			creating = false;
		}
	}

	async function setDefault(orgId: string | null) {
		if (savingDefault) return;
		savingDefault = true;
		try {
			const res = await fetch('/api/account/default-org', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ orgId })
			});
			if (res.ok) await invalidateAll();
		} finally {
			savingDefault = false;
		}
	}

	function statusBadge(s: string | null) {
		if (s === 'active') return { cls: 'badge-success', label: 'Domain live' };
		if (s === 'pending') return { cls: 'badge-warning', label: 'Domain pending' };
		if (s === 'failed') return { cls: 'badge-error', label: 'Domain failed' };
		return null;
	}
</script>

<svelte:head><title>Accounts | MdPubs</title></svelte:head>

<div class="mx-auto min-h-screen max-w-2xl px-4 py-8 text-base-content">
	<h1 class="mb-2 text-3xl font-bold">Accounts</h1>
	<p class="mb-8 text-base-content/70">
		An account (organization) lets a team publish under a shared name and custom domain. Tag a note
		with <code class="rounded bg-base-200 px-1">mdpubs-company: &lt;slug&gt;</code> to publish it under
		that account.
	</p>

	<!-- Your accounts -->
	{#if data.orgs.length > 0}
		<div class="mb-10 space-y-3">
			{#each data.orgs as org (org.id)}
				{@const badge = statusBadge(org.domainStatus)}
				<div class="flex items-center justify-between rounded-lg border border-base-300 p-4">
					<div>
						<a
							href={resolve('/(app)/orgs/[id]', { id: org.id })}
							class="font-semibold hover:underline">{org.name}</a
						>
						<div class="text-sm text-base-content/60">
							<code>{org.slug}</code>
							{#if org.customDomain}· {org.customDomain}{/if}
						</div>
						<div class="mt-1 flex items-center gap-2">
							<span class="badge badge-ghost badge-sm">{org.role}</span>
							{#if badge}<span class="badge {badge.cls} badge-sm">{badge.label}</span>{/if}
						</div>
					</div>
					<div class="flex items-center gap-2">
						{#if data.defaultOrgId === org.id}
							<span class="badge badge-primary">Default</span>
							<button
								class="btn btn-ghost btn-xs"
								disabled={savingDefault}
								onclick={() => setDefault(null)}>Unset</button
							>
						{:else}
							<button
								class="btn btn-outline btn-xs"
								disabled={savingDefault}
								onclick={() => setDefault(org.id)}>Make default</button
							>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		<p class="mb-8 -mt-6 text-xs text-base-content/50">
			Your <strong>default</strong> account is used when a synced note has no
			<code>mdpubs-company</code> frontmatter.
		</p>
	{:else}
		<div class="mb-10 rounded-lg border border-dashed border-base-300 p-6 text-center text-base-content/60">
			You don't belong to any accounts yet. Create one below.
		</div>
	{/if}

	<!-- Create -->
	<div class="rounded-lg border border-base-300 p-6">
		<h2 class="mb-4 text-xl font-bold">Create an account</h2>
		<form class="space-y-3" onsubmit={createOrg}>
			<div>
				<label class="text-sm font-medium" for="org-name">Name</label>
				<input
					id="org-name"
					type="text"
					bind:value={name}
					placeholder="108 Labs"
					class="input input-bordered w-full"
					maxlength="80"
					required
				/>
			</div>
			<div>
				<label class="text-sm font-medium" for="org-slug">Slug (used in frontmatter & URLs)</label>
				<input
					id="org-slug"
					type="text"
					bind:value={slug}
					oninput={() => (slugTouched = true)}
					placeholder="108labs"
					class="input input-bordered w-full font-mono"
					maxlength="40"
					required
				/>
			</div>
			{#if msg}
				<p class="text-sm {msg.type === 'error' ? 'text-error' : 'text-success'}">{msg.text}</p>
			{/if}
			<button class="btn btn-primary" disabled={creating}>
				{#if creating}<span class="loading loading-spinner"></span>{/if}
				Create account
			</button>
		</form>
	</div>
</div>
