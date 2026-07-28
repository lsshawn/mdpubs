<script lang="ts">
	import { KeyRound, MailPlus } from 'lucide-svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let members = $state(data.members);
	let invites = $state(data.invites);

	let email = $state('');
	let role = $state<'member' | 'admin'>('member');
	let submitting = $state(false);
	let msg = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	async function refresh() {
		const res = await fetch(`/api/org/${data.org.id}/members`);
		if (res.ok) {
			const r = await res.json();
			members = r.members;
			invites = r.invites;
		}
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (submitting) return;
		submitting = true;
		msg = null;
		try {
			const res = await fetch(`/api/org/${data.org.id}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role })
			});
			const r = await res.json();
			if (res.ok && r.success) {
				// The endpoint reports which of the two happened, because the outcome
				// differs from the user's point of view: an existing account joins
				// immediately, a new address has to log in first.
				msg =
					r.status === 'invited'
						? {
								type: 'success',
								text: `Invited ${email}. They'll join ${data.org.name} automatically when they first sign in.`
							}
						: { type: 'success', text: `${email} is now a member.` };
				email = '';
				await refresh();
			} else {
				msg = { type: 'error', text: r.message ?? 'Could not add that person.' };
			}
		} finally {
			submitting = false;
		}
	}

	async function removeMember(userId: string) {
		if (!confirm('Remove this member? They will no longer be able to publish to this company.'))
			return;
		const res = await fetch(`/api/org/${data.org.id}/members`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		});
		const r = await res.json();
		if (res.ok && r.success) await refresh();
		else msg = { type: 'error', text: r.message ?? 'Could not remove member.' };
	}

	async function revoke(inviteId: string) {
		const res = await fetch(`/api/org/${data.org.id}/invites`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ inviteId })
		});
		if (res.ok) await refresh();
	}
</script>

<svelte:head><title>Members · {data.org.name} | MdPubs</title></svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="text-2xl font-bold">Members</h1>
	<p class="mt-1 mb-8 text-sm text-base-content/60">
		People who can publish notes to <span class="font-medium">{data.org.name}</span> using
		<code class="rounded bg-base-200 px-1">mdpubs-company: {data.org.slug}</code>.
	</p>

	{#if data.canManage}
		<section class="mb-8 rounded-lg border border-base-300 bg-base-100 p-6">
			<h2 class="mb-1 flex items-center gap-2 text-lg font-semibold">
				<MailPlus class="h-5 w-5 text-primary" />
				Add someone by email
			</h2>
			<p class="mb-4 text-sm text-base-content/60">
				No account needed — if they haven't signed up yet, the invite is held and applied
				automatically the first time they sign in.
			</p>

			<form class="flex flex-wrap items-end gap-2" onsubmit={add}>
				<div class="min-w-[16rem] flex-1">
					<label class="text-sm font-medium" for="invite-email">Email address</label>
					<input
						id="invite-email"
						type="email"
						bind:value={email}
						placeholder="teammate@example.com"
						class="input input-bordered w-full"
						required
					/>
				</div>
				<select bind:value={role} class="select select-bordered" aria-label="Role">
					<option value="member">Member</option>
					<option value="admin">Admin</option>
				</select>
				<button class="btn btn-primary" disabled={submitting}>
					{#if submitting}<span class="loading loading-spinner loading-sm"></span>{/if}
					Add
				</button>
			</form>

			{#if msg}
				<p class="mt-3 text-sm {msg.type === 'error' ? 'text-error' : 'text-success'}">
					{msg.text}
				</p>
			{/if}
		</section>
	{/if}

	<!-- Roster -->
	<section class="mb-8 rounded-lg border border-base-300 bg-base-100 p-6">
		<h2 class="mb-4 text-lg font-semibold">
			Members <span class="text-base-content/50">({members.length})</span>
		</h2>
		<div class="space-y-2">
			{#each members as m (m.userId)}
				<div class="flex items-center justify-between rounded border border-base-200 px-3 py-2">
					<div class="min-w-0">
						<div class="truncate font-medium">{m.name || m.email}</div>
						{#if m.name}<div class="truncate text-sm text-base-content/50">{m.email}</div>{/if}
					</div>
					<div class="flex flex-shrink-0 items-center gap-2">
						<span class="badge badge-ghost badge-sm">{m.role}</span>
						{#if m.userId === data.currentUserId}
							<span class="text-xs text-base-content/50">you</span>
						{:else if data.canManage}
							<button
								class="btn btn-ghost btn-xs text-error"
								onclick={() => removeMember(m.userId)}
							>
								Remove
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Pending invites -->
	{#if invites.length}
		<section class="mb-8 rounded-lg border border-base-300 bg-base-100 p-6">
			<h2 class="mb-1 text-lg font-semibold">
				Pending invites <span class="text-base-content/50">({invites.length})</span>
			</h2>
			<p class="mb-4 text-sm text-base-content/60">
				These addresses don't have an MdPubs account yet. They join as soon as they sign in.
			</p>
			<div class="space-y-2">
				{#each invites as i (i.id)}
					<div class="flex items-center justify-between rounded border border-base-200 px-3 py-2">
						<span class="truncate">{i.email}</span>
						<div class="flex flex-shrink-0 items-center gap-2">
							<span class="badge badge-ghost badge-sm">{i.role}</span>
							<span class="badge badge-warning badge-sm">pending</span>
							{#if data.canManage}
								<button class="btn btn-ghost btn-xs text-error" onclick={() => revoke(i.id)}>
									Revoke
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!--
		API keys are per-user, not per-company: membership alone authorizes
		publishing into this org, so a new member just generates their own key. This
		note exists because "how does the new person get a key" is the obvious next
		question after adding them.
	-->
	<section class="rounded-lg border border-base-300 bg-base-100 p-6">
		<h2 class="mb-1 flex items-center gap-2 text-lg font-semibold">
			<KeyRound class="h-5 w-5 text-primary" />
			API keys
		</h2>
		<p class="text-sm text-base-content/70">
			Every member creates their <span class="font-medium">own</span> API key — nobody has to share
			one. Once someone is a member here, their personal key can publish to
			<code class="rounded bg-base-200 px-1">{data.org.slug}</code>; removing them from this company
			revokes that access without touching their key.
		</p>
		<a href="/account" class="btn btn-sm mt-4">Generate my API key</a>
	</section>
</div>
