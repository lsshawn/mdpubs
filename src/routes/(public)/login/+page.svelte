<script lang="ts">
	import LoginForm from '#lib/components/LoginForm.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Sign in · mdpubs</title>
</svelte:head>

<div class="flex min-h-svh items-center justify-center px-4 py-16">
	<LoginForm redirectTo={data.redirectTo} />
</div>
