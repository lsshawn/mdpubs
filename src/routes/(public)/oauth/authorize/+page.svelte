<script lang="ts">
	import ToolConsent from '#lib/components/ToolConsent.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Connect {data.clientName} to mdpubs</title>
</svelte:head>

<ToolConsent
	title="Connect {data.clientName} to mdpubs?"
	paid={data.paid}
	email={data.email}
	monthlyLink={data.monthlyLink}
	yearlyLink={data.yearlyLink}
	fields={data.fields}
>
	<p class="mt-6 text-sm text-base-content/70">
		You'll go back to <span class="font-mono">{data.redirectHost}</span> when you're done.
	</p>
	{#if form?.error}
		<p class="mt-3 text-sm text-error">{form.error}</p>
	{/if}
</ToolConsent>
