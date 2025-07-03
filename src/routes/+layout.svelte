<script lang="ts">
	import '../app.css';

	let { children } = $props();
	import MetaTag from '$lib/components/MetaTag.svelte';
</script>

<MetaTag></MetaTag>
{@render children()}
