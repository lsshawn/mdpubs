<script>
	import Icon from '@iconify/svelte';
	let {
		buttonText = 'Copy',
		classes = '',
		tooltipClasses = '',
		text = '',
		iconOnly = false
	} = $props();
	let copied = $state(false);

	async function copy() {
		const formatted = text.replaceAll('<br>', '\n');
		await navigator.clipboard.writeText(formatted);
		copied = true;

		setTimeout(function () {
			copied = false;
		}, 700);
	}
</script>

<div
	class="tooltip tooltip-bottom {tooltipClasses} "
	data-tip={copied ? 'Copied' : 'Copy'}
	class:tooltip-success={copied}
>
	<button
		class="btn {classes} btn-sm"
		class:btn-circle={iconOnly}
		class:btn-ghost={iconOnly}
		class:btn-success={copied}
		class:text-white={copied}
		onclick={copy}
	>
		{#if iconOnly}
			<Icon icon="ph:copy" width="20" />
		{:else}
			{copied ? 'Copied' : buttonText}
		{/if}
	</button>
</div>
