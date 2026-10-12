<script lang="ts">
	import ToolConsent from '#lib/components/ToolConsent.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Connect the mdpubs CLI</title>
</svelte:head>

{#if data.done}
	<div class="mx-auto max-w-md px-6 py-16">
		<div class="border border-base-content/15 p-8">
			<h1 class="text-xl font-semibold tracking-tight">
				{data.done === 'allowed' ? 'Connected' : 'Cancelled'}
			</h1>
			<p class="mt-2 text-sm text-base-content/70">
				{data.done === 'allowed'
					? 'Go back to Claude Code or Codex. It finishes setup on its own.'
					: 'Nothing was connected. You can close this tab.'}
			</p>
		</div>
	</div>
{:else if !data.found}
	<div class="mx-auto max-w-md px-6 py-16">
		<div class="border border-base-content/15 p-8">
			<h1 class="text-xl font-semibold tracking-tight">This link has expired</h1>
			<p class="mt-2 text-sm text-base-content/70">
				Ask Claude Code or Codex to run <code class="font-mono">mdpubs login</code> again for a fresh
				link.
			</p>
		</div>
	</div>
{:else}
	<ToolConsent
		title="Connect Claude Code or Codex?"
		paid={data.paid}
		email={data.email}
		monthlyLink={data.monthlyLink}
		yearlyLink={data.yearlyLink}
		fields={{ code: data.code ?? '' }}
	>
		<p class="mt-6 text-sm text-base-content/70">Check this code matches your terminal:</p>
		<p class="mt-2 font-mono text-2xl tracking-widest">{data.code}</p>
		{#if form?.error}
			<p class="mt-3 text-sm text-error">{form.error}</p>
		{/if}
	</ToolConsent>
{/if}
