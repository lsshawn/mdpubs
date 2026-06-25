<script lang="ts">
	import LoginForm from '$lib/components/LoginForm.svelte';

	let { data } = $props();
</script>

<div class="max-w-xl mx-auto">
	<LoginForm redirectTo={data.redirectTo} />
</div>
