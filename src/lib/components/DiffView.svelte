<script lang="ts">
	let { diff }: { diff: string } = $props();

	const lines = $derived(diff ? diff.split('\n') : []);

	function parseLine(line: string) {
		if (line.startsWith('+') && !line.startsWith('+++')) {
			return { sign: '+', content: line.substring(1), class: 'bg-green-50' };
		}
		if (line.startsWith('-') && !line.startsWith('---')) {
			return { sign: '-', content: line.substring(1), class: 'bg-red-50' };
		}
		if (line.startsWith('@@')) {
			return { sign: ' ', content: line, class: 'bg-blue-50 text-gray-500' };
		}
		return { sign: ' ', content: line, class: '' };
	}
</script>

<div class="overflow-hidden rounded-sm border border-gray-400 bg-white px-2 py-4 font-mono text-sm">
	<div class="overflow-x-auto">
		{#each lines as line, i (i)}
			{@const { sign, content, class: lineClass } = parseLine(line)}
			<div class="flex {lineClass}">
				<span class="text-gray-400">
					{i + 1}
				</span>
				<span class="inline-block w-8 flex-shrink-0 text-center text-gray-400 select-none"
					>{sign}</span
				>
				<span class="inline-block flex-grow pr-4 whitespace-pre-wrap">{content}</span>
			</div>
		{/each}
	</div>
</div>
