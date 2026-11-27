<script lang="ts">
	/**
	 * Who else is on this note: a small stack of faces. Someone editing gets a
	 * pulsing ring. Readers the room keeps anonymous show as a plain dot.
	 */
	import { fade } from 'svelte/transition';
	import { personHue, type LivePerson, type LiveRoom } from './room.svelte.js';

	let {
		room,
		sectionTitle = () => null
	}: {
		room: LiveRoom;
		/** The heading text for a section link, for the tooltip. */
		sectionTitle?: (link: string) => string | null;
	} = $props();

	const MAX_FACES = 4;
	let shown = $derived(room.others.slice(0, MAX_FACES));
	let extra = $derived(room.others.length - shown.length);

	function label(p: LivePerson): string {
		const who = p.name ?? 'Someone';
		if (p.mode === 'editing') return `${who} is editing`;
		const at = p.s ? sectionTitle(p.s) : null;
		return at ? `${who} is reading "${at}"` : `${who} is reading`;
	}
</script>

{#if room.others.length}
	<div
		class="flex items-center"
		role="group"
		aria-label="{room.others.length} other {room.others.length === 1
			? 'person'
			: 'people'} on this note"
		data-comments-ignore
		transition:fade={{ duration: 150 }}
	>
		{#each shown as p (p.u)}
			<div class="tooltip tooltip-bottom -ml-1.5 first:ml-0" data-tip={label(p)}>
				<span
					class="live-face flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-base-100"
					class:live-editing={p.mode === 'editing'}
					style="--hue: {personHue(p.u)}"
					aria-label={label(p)}
				>
					{p.name ? p.name.slice(0, 1).toUpperCase() : ''}
				</span>
			</div>
		{/each}
		{#if extra > 0}
			<div
				class="tooltip tooltip-bottom -ml-1.5"
				data-tip="{extra} more {extra === 1 ? 'person' : 'people'}"
			>
				<span
					class="flex size-8 items-center justify-center rounded-full bg-base-300 text-xs font-semibold text-base-content ring-2 ring-base-100"
					>+{extra}</span
				>
			</div>
		{/if}
	</div>
{/if}

<style>
	.live-face {
		background: hsl(var(--hue) 55% 48%);
	}
	.live-editing {
		box-shadow: 0 0 0 2px hsl(var(--hue) 70% 55%);
		animation: live-pulse 1.6s ease-in-out infinite;
	}
	@keyframes live-pulse {
		50% {
			box-shadow: 0 0 0 5px hsl(var(--hue) 70% 55% / 0.25);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.live-editing {
			animation: none;
		}
	}
</style>
