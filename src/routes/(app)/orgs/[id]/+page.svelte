<script lang="ts">
	import CopyableText from '$lib/components/CopyableText.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// --- Custom domain --------------------------------------------------------
	let domainInput = $state(data.org.customDomain ?? '');
	let domainStatus = $state(data.org.domainStatus ?? 'none');
	let domainMsg = $state<{ type: 'success' | 'error'; text: string } | null>(null);
	let dns = $state<{ type: string; name: string; value: string } | null>(
		data.org.customDomain
			? { type: 'CNAME', name: data.org.customDomain, value: data.cnameTarget }
			: null
	);
	let savingDomain = $state(false);
	let checking = $state(false);

	async function connectDomain(e: SubmitEvent) {
		e.preventDefault();
		if (savingDomain) return;
		savingDomain = true;
		domainMsg = null;
		try {
			const res = await fetch(`/api/org/${data.org.id}/domain`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domain: domainInput })
			});
			const r = await res.json();
			if (res.ok && r.success) {
				domainStatus = r.status;
				dns = r.dns;
				domainMsg = { type: 'success', text: 'Domain registered. Add the DNS record below.' };
			} else {
				domainMsg = { type: 'error', text: r.message ?? 'Could not connect the domain.' };
			}
		} finally {
			savingDomain = false;
		}
	}

	async function checkStatus() {
		if (checking) return;
		checking = true;
		try {
			const res = await fetch(`/api/org/${data.org.id}/domain`);
			const r = await res.json();
			if (res.ok && r.success) {
				domainStatus = r.status;
				if (r.dns) dns = r.dns;
				domainMsg =
					r.status === 'active'
						? { type: 'success', text: 'Domain is live! 🎉' }
						: r.status === 'failed'
							? { type: 'error', text: 'Verification failed. Check the DNS record.' }
							: { type: 'success', text: 'Still pending — DNS/cert can take a few minutes.' };
			}
		} finally {
			checking = false;
		}
	}

	async function removeDomain() {
		if (savingDomain) return;
		if (!confirm('Disconnect this custom domain?')) return;
		savingDomain = true;
		try {
			const res = await fetch(`/api/org/${data.org.id}/domain`, { method: 'DELETE' });
			if (res.ok) {
				domainStatus = 'none';
				dns = null;
				domainInput = '';
				domainMsg = null;
			}
		} finally {
			savingDomain = false;
		}
	}

	const statusMeta = $derived(
		domainStatus === 'active'
			? { cls: 'badge-success', label: 'Live' }
			: domainStatus === 'pending'
				? { cls: 'badge-warning', label: 'Pending verification' }
				: domainStatus === 'failed'
					? { cls: 'badge-error', label: 'Failed' }
					: { cls: 'badge-ghost', label: 'Not connected' }
	);

	// --- Members --------------------------------------------------------------
	let members = $state(data.members);
	let inviteEmail = $state('');
	let inviteRole = $state<'member' | 'admin'>('member');
	let inviting = $state(false);
	let memberMsg = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	async function refreshMembers() {
		const res = await fetch(`/api/org/${data.org.id}/members`);
		if (res.ok) members = (await res.json()).members;
	}

	async function addMember(e: SubmitEvent) {
		e.preventDefault();
		if (inviting) return;
		inviting = true;
		memberMsg = null;
		try {
			const res = await fetch(`/api/org/${data.org.id}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: inviteEmail, role: inviteRole })
			});
			const r = await res.json();
			if (res.ok && r.success) {
				inviteEmail = '';
				await refreshMembers();
			} else {
				memberMsg = { type: 'error', text: r.message ?? 'Could not add member.' };
			}
		} finally {
			inviting = false;
		}
	}

	async function removeMember(userId: string) {
		const res = await fetch(`/api/org/${data.org.id}/members`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		});
		const r = await res.json();
		if (res.ok && r.success) await refreshMembers();
		else memberMsg = { type: 'error', text: r.message ?? 'Could not remove member.' };
	}
</script>

<svelte:head><title>{data.org.name} · Account | MdPubs</title></svelte:head>

<div class="mx-auto min-h-screen max-w-2xl px-4 py-8 text-base-content">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href="/orgs" class="text-sm text-primary hover:underline">&larr; All accounts</a>
	<h1 class="mt-2 mb-1 text-3xl font-bold">{data.org.name}</h1>
	<p class="mb-8 text-base-content/60">
		Slug <code class="rounded bg-base-200 px-1">{data.org.slug}</code> · your role: {data.role}
	</p>

	<!-- Custom domain -->
	<section class="mb-10 rounded-lg border border-base-300 p-6">
		<div class="mb-3 flex items-center gap-3">
			<h2 class="text-xl font-bold">Custom domain</h2>
			<span class="badge {statusMeta.cls}">{statusMeta.label}</span>
		</div>

		{#if !data.canManage}
			<p class="text-sm text-base-content/60">Only owners and admins can manage the domain.</p>
		{:else}
			<p class="mb-4 text-sm text-base-content/70">
				Serve this account's public docs from your own domain, e.g.
				<code>docs.example.com</code>.
			</p>

			<form class="flex flex-wrap items-end gap-2" onsubmit={connectDomain}>
				<div class="flex-1">
					<label class="text-sm font-medium" for="domain">Domain</label>
					<input
						id="domain"
						type="text"
						bind:value={domainInput}
						placeholder="docs.example.com"
						class="input input-bordered w-full font-mono"
					/>
				</div>
				<button class="btn btn-primary" disabled={savingDomain}>
					{#if savingDomain}<span class="loading loading-spinner"></span>{/if}
					{domainStatus === 'none' ? 'Connect' : 'Change'}
				</button>
				{#if domainStatus !== 'none'}
					<button type="button" class="btn btn-ghost text-error" onclick={removeDomain}>Remove</button
					>
				{/if}
			</form>

			{#if domainMsg}
				<p class="mt-2 text-sm {domainMsg.type === 'error' ? 'text-error' : 'text-success'}">
					{domainMsg.text}
				</p>
			{/if}

			<!-- DNS instruction: the single record the customer adds in their own DNS. -->
			{#if dns && domainStatus !== 'none'}
				<div class="mt-4 rounded-lg bg-base-200 p-4">
					<p class="mb-2 text-sm font-medium">Add this record in your DNS provider:</p>
					<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-sm">
						<span class="text-base-content/50">Type</span><span>{dns.type}</span>
						<span class="text-base-content/50">Name</span><span class="break-all">{dns.name}</span>
						<span class="text-base-content/50">Value</span>
						<span class="flex items-center gap-2 break-all">
							{dns.value}
							<CopyableText text={dns.value} />
						</span>
					</div>
					<div class="mt-3 flex items-center gap-3">
						<button class="btn btn-sm" onclick={checkStatus} disabled={checking}>
							{#if checking}<span class="loading loading-spinner loading-xs"></span>{/if}
							Check status
						</button>
						{#if domainStatus === 'pending'}
							<span class="text-xs text-base-content/50">
								A TLS certificate is issued automatically once the record resolves.
							</span>
						{/if}
					</div>
				</div>
			{/if}
		{/if}
	</section>

	<!-- Members -->
	<section class="rounded-lg border border-base-300 p-6">
		<h2 class="mb-4 text-xl font-bold">Members</h2>
		<div class="mb-4 space-y-2">
			{#each members as m (m.userId)}
				<div class="flex items-center justify-between rounded border border-base-200 px-3 py-2">
					<div>
						<span class="font-medium">{m.name || m.email}</span>
						<span class="ml-2 text-sm text-base-content/50">{m.email}</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="badge badge-ghost badge-sm">{m.role}</span>
						{#if data.canManage && m.userId !== data.currentUserId}
							<button class="btn btn-ghost btn-xs text-error" onclick={() => removeMember(m.userId)}
								>Remove</button
							>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		{#if data.canManage}
			<form class="flex flex-wrap items-end gap-2" onsubmit={addMember}>
				<div class="flex-1">
					<label class="text-sm font-medium" for="invite">Add member by email</label>
					<input
						id="invite"
						type="email"
						bind:value={inviteEmail}
						placeholder="teammate@example.com"
						class="input input-bordered w-full"
						required
					/>
				</div>
				<select bind:value={inviteRole} class="select select-bordered">
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</select>
				<button class="btn btn-primary" disabled={inviting}>
					{#if inviting}<span class="loading loading-spinner"></span>{/if}
					Add
				</button>
			</form>
			<p class="mt-1 text-xs text-base-content/50">
				The person must already have an MdPubs account.
			</p>
			{#if memberMsg}
				<p class="mt-2 text-sm {memberMsg.type === 'error' ? 'text-error' : 'text-success'}">
					{memberMsg.text}
				</p>
			{/if}
		{/if}
	</section>
</div>
