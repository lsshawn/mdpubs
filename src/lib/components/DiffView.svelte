<script lang="ts">
	let { diff }: { diff: string } = $props();

	const lines = $derived(diff ? diff.split('\n') : []);

	function parseLine(line: string) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			return { sign: '+', content: line.substring(1), class: 'bg-success/15' };
		}
		if (line.startsWith('-') && !line.startsWith('---')) {
			return { sign: '-', content: line.substring(1), class: 'bg-error/15' };
		}
		if (line.startsWith('@@')) {
			return { sign: ' ', content: line, class: 'bg-info/15 text-base-content/60' };
		}
		return { sign: ' ', content: line, class: '' };
	}
</script>

<div
	class="overflow-hidden rounded-sm border border-base-300 bg-base-100 px-2 py-4 font-mono text-sm"
>
	<div class="overflow-x-auto">
		{#each lines as line, i (i)}
			{@const { sign, content, class: lineClass } = parseLine(line)}
			<div class="flex {lineClass}">
				<span class="text-base-content/40">
					{i + 1}
				</span>
				<span class="inline-block w-8 flex-shrink-0 text-center text-base-content/40 select-none"
					>{sign}</span
				>
				<span class="inline-block flex-grow pr-4 whitespace-pre-wrap">{content}</span>
			</div>
		{/each}
	</div>
</div>
