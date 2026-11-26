<script lang="ts">
	/**
	 * "What changed?" for a published note, for people who have never seen a diff.
	 *
	 * A panel beside the page lists every saved version with a plain summary
	 * ("2 reworded · 1 added") and, opened, the paragraphs that changed with the
	 * new words marked and the old ones struck through. Click a paragraph or a
	 * heading in the page while the panel is open to follow just that paragraph,
	 * or that whole section, back through every version.
	 *
	 * The comparing is done in doc-history.ts.
	 */
	import { untrack } from 'svelte';
	import { indexArticle, blockOfNode } from './comments/comment-dom.js';
	import {
		alike,
		diffBlocks,
		follow,
		splitBlocks,
		summarize,
		type Change,
		type HistoryBlock,
		type Part
	} from '#lib/helpers/doc-history.js';

	type Props = {
		article: HTMLElement | null;
		noteId: string;
		apiUrl: string;
		open?: boolean;
	};
	let { article, noteId, apiUrl, open = $bindable(false) }: Props = $props();

	type Version = { version: number; at: Date | null; blocks: HistoryBlock[] };

	/** Oldest first. */
	let versions = $state.raw<Version[] | null>(null);
	let error = $state('');
	let tab = $state<'all' | 'one'>('all');
	/** Versions opened in the whole-document list, by position in `versions`. */
	let expanded = $state<Record<number, boolean>>({});
	let picked = $state.raw<{ text: string; el: Element } | null>(null);

	const INTERACTIVE =
		'a,button,input,textarea,select,label,video,audio,iframe,[data-comments-ignore]';
	const KIND: Record<HistoryBlock['kind'], string> = {
		heading: 'heading',
		text: 'paragraph',
		item: 'list item',
		row: 'table row',
		code: 'code block',
		media: 'image or video'
	};
	const VERB: Record<Change['type'], string> = {
		changed: 'Reworded',
		added: 'Added',
		removed: 'Removed',
		moved: 'Moved'
	};

	/** What each version changed from the one before it. Index matches `versions`; [0] is the first publish. */
	const changes = $derived.by<Change[][]>(() =>
		(versions ?? []).map((v, i, all) => (i === 0 ? [] : diffBlocks(all[i - 1].blocks, v.blocks)))
	);
	const trail = $derived.by(() =>
		picked && versions
			? follow(
					versions.map((v) => v.blocks),
					picked.text
				)
			: null
	);

	async function load() {
		error = '';
		try {
			const res = await fetch(`${apiUrl}/notes/${noteId}/versions?limit=40`);
			if (!res.ok) throw new Error();
			const data: {
				versions: { version: number; createdAt: string | number | null; content: string | null }[];
			} = await res.json();
			const list = data.versions
				.map((v) => {
					const at = v.createdAt ? new Date(v.createdAt) : null;
					return {
						version: v.version,
						at: at && !isNaN(at.getTime()) ? at : null,
						blocks: splitBlocks(v.content ?? '')
					};
				})
				.sort((a, b) => a.version - b.version);
			versions = list;
			// Start with the latest change open.
			expanded = { [list.length - 1]: true };
		} catch {
			error = 'Could not load the history. Try again.';
		}
	}

	function when(v: Version): string {
		if (!v.at) return `Version ${v.version}`;
		return v.at.toLocaleString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function unpick() {
		picked?.el.classList.remove('mdp-history-picked');
		picked = null;
	}

	function pick(el: Element, text: string) {
		unpick();
		el.classList.add('mdp-history-picked');
		picked = { text, el };
		tab = 'one';
	}

	/** What to call a block of the page that has no text of its own. */
	function textOf(el: Element, text: string): string {
		if (text) return text;
		const img = el.matches('img') ? el : el.querySelector('img');
		if (img) return `Image: ${img.getAttribute('alt') ?? ''}`.trim();
		if (el.matches('video') || el.querySelector('video')) return 'Video';
		if (el.matches('audio') || el.querySelector('audio')) return 'Audio';
		return 'Embed';
	}

	/** Scroll the page to the paragraph a change is about, if it is still there. */
	function showInPage(text: string | undefined) {
		if (!article || !text) return;
		const index = indexArticle(article);
		let best: Element | null = null;
		let score = 0.6;
		for (const b of index.blocks) {
			const s = alike(textOf(b.el, b.text), text);
			if (s > score) {
				score = s;
				best = b.el;
			}
		}
		if (!best) return;
		best.scrollIntoView({ behavior: 'smooth', block: 'center' });
		best.classList.add('mdp-history-flash');
		setTimeout(() => best?.classList.remove('mdp-history-flash'), 1600);
	}

	function close() {
		unpick();
		open = false;
	}

	/** While the panel is open, a click on the page picks a paragraph instead of anything else. */
	function listen() {
		const root = article;
		if (!root) return;
		return untrack(() => {
			if (!versions) load();
			const onClick = (e: MouseEvent) => {
				const target = e.target as Element;
				if (!root.contains(target) || target.closest(INTERACTIVE)) return;
				const index = indexArticle(root);
				const i = blockOfNode(index, target);
				if (i === null) return;
				e.stopPropagation();
				e.preventDefault();
				pick(index.blocks[i].el, textOf(index.blocks[i].el, index.blocks[i].text));
			};
			const onKey = (e: KeyboardEvent) => {
				if (e.key === 'Escape' && !e.defaultPrevented) close();
			};
			document.addEventListener('click', onClick, true);
			document.addEventListener('keydown', onKey);
			root.classList.add('mdp-history-picking');
			return () => {
				document.removeEventListener('click', onClick, true);
				document.removeEventListener('keydown', onKey);
				root.classList.remove('mdp-history-picking');
				unpick();
			};
		});
	}
</script>

{#snippet words(parts: Part[])}
	{#each parts as p, i (i)}{#if p.op === 1}<ins>{p.text}</ins>{:else if p.op === -1}<del
				>{p.text}</del
			>{:else}{p.text}{/if}{/each}
{/snippet}

{#snippet card(c: Change)}
	<button
		type="button"
		class="hp-card hp-{c.type}"
		title={c.type === 'removed' ? undefined : 'Show this in the page'}
		onclick={() => showInPage(c.after)}
	>
		<span class="hp-label">
			{VERB[c.type]}
			{KIND[c.kind]}{c.section && c.kind !== 'heading' ? ` in “${c.section}”` : ''}
		</span>
		<span class="hp-text" class:hp-code={c.kind === 'code'}>
			{#if c.type === 'changed' && c.parts}
				{@render words(c.parts)}
			{:else if c.type === 'added'}
				<ins>{c.after}</ins>
			{:else if c.type === 'removed'}
				<del>{c.before}</del>
			{:else}
				{c.after}
			{/if}
		</span>
	</button>
{/snippet}

{#if open}
	<aside
		class="hp-panel print:hidden"
		aria-label="Document history"
		data-comments-ignore
		{@attach listen}
	>
		<header class="hp-head">
			<h2>History</h2>
			<button type="button" class="hp-close" aria-label="Close history" onclick={close}>✕</button>
		</header>
		<div class="hp-tabs" role="tablist">
			<button type="button" role="tab" aria-selected={tab === 'all'} onclick={() => (tab = 'all')}>
				Whole document
			</button>
			<button type="button" role="tab" aria-selected={tab === 'one'} onclick={() => (tab = 'one')}>
				One paragraph
			</button>
		</div>

		<div class="hp-body">
			{#if error}
				<p class="hp-note">
					{error} <button type="button" class="hp-link" onclick={load}>Retry</button>
				</p>
			{:else if !versions}
				<p class="hp-note">Loading the history…</p>
			{:else if tab === 'all'}
				<p class="hp-note">
					<ins>Green</ins> is new. <del>Red</del> was taken out. Newest first.
				</p>
				{#each versions.toReversed() as v, k (v.version)}
					{@const i = versions.length - 1 - k}
					<section class="hp-version">
						<button
							type="button"
							class="hp-version-head"
							aria-expanded={!!expanded[i]}
							onclick={() => (expanded[i] = !expanded[i])}
						>
							<span class="hp-when">
								{when(v)}{k === 0 ? ' · current' : ''}
							</span>
							<span class="hp-summary">
								{i === 0 ? 'First published' : summarize(changes[i])}
							</span>
						</button>
						{#if expanded[i] && i > 0}
							<div class="hp-cards">
								{#each changes[i] as c, n (n)}
									{@render card(c)}
								{:else}
									<p class="hp-note">Only settings changed, not the text.</p>
								{/each}
							</div>
						{/if}
					</section>
				{/each}
			{:else if !picked}
				<p class="hp-note hp-pick">
					Click any paragraph in the page to see how it changed over time. Click a heading to follow
					its whole section.
				</p>
			{:else if !trail || !trail.steps.length}
				<p class="hp-note">No history found for this part. It may be new since the last save.</p>
			{:else}
				<p class="hp-note">
					{trail.section ? 'This section' : 'This paragraph'} changed
					{trail.steps.length - 1}
					{trail.steps.length - 1 === 1 ? 'time' : 'times'}. Newest first.
				</p>
				{#each trail.steps.toReversed() as s (s.version)}
					<div class="hp-card hp-step">
						<span class="hp-label">
							{when(versions[s.version])} · {s.type === 'first' ? 'first written' : 'reworded'}
						</span>
						<span class="hp-text">
							{#if s.parts}{@render words(s.parts)}{:else}{s.text}{/if}
						</span>
					</div>
				{/each}
			{/if}
		</div>
	</aside>
{/if}

<style>
	.hp-panel {
		position: fixed;
		inset: 0 0 0 auto;
		z-index: 58;
		display: flex;
		flex-direction: column;
		width: min(22rem, 100vw);
		background: var(--color-base-100);
		color: var(--color-base-content);
		box-shadow: -8px 0 30px color-mix(in oklch, var(--color-base-content) 14%, transparent);
		font-size: 0.875rem;
		animation: hp-in 180ms ease-out;
	}
	@keyframes hp-in {
		from {
			transform: translateX(100%);
		}
	}
	/* On a phone the panel takes the bottom of the screen, so the page above it can still be tapped. */
	@media (max-width: 767px) {
		.hp-panel {
			inset: auto 0 0 0;
			width: auto;
			height: 62vh;
			border-radius: 1rem 1rem 0 0;
			box-shadow: 0 -8px 30px color-mix(in oklch, var(--color-base-content) 18%, transparent);
			animation-name: hp-up;
		}
		@keyframes hp-up {
			from {
				transform: translateY(100%);
			}
		}
	}
	.hp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.9rem 1.25rem 0.5rem;
	}
	.hp-head h2 {
		font-size: 1rem;
		font-weight: 600;
	}
	.hp-close,
	.hp-link {
		color: color-mix(in oklch, var(--color-base-content) 50%, transparent);
		cursor: pointer;
	}
	.hp-link {
		text-decoration: underline;
	}
	.hp-tabs {
		display: flex;
		gap: 0.25rem;
		margin: 0 1.25rem;
		padding: 2px;
		border-radius: 0.6rem;
		background: color-mix(in oklch, var(--color-base-content) 7%, transparent);
	}
	.hp-tabs button {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border-radius: 0.5rem;
		color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		cursor: pointer;
	}
	.hp-tabs button[aria-selected='true'] {
		background: var(--color-base-100);
		color: var(--color-base-content);
		box-shadow: 0 1px 2px color-mix(in oklch, var(--color-base-content) 18%, transparent);
	}
	.hp-body {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.75rem 1.25rem max(1.25rem, env(safe-area-inset-bottom));
	}
	.hp-note {
		margin: 0.25rem 0 0.75rem;
		color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		font-size: 0.8125rem;
	}
	.hp-pick {
		padding: 1rem;
		border: 1px dashed color-mix(in oklch, var(--color-base-content) 20%, transparent);
		border-radius: 0.75rem;
		text-align: center;
	}
	.hp-version {
		border-top: 1px solid color-mix(in oklch, var(--color-base-content) 8%, transparent);
	}
	.hp-version-head {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		width: 100%;
		padding: 0.7rem 0;
		text-align: left;
		cursor: pointer;
	}
	.hp-when {
		font-weight: 600;
	}
	.hp-summary {
		color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		font-size: 0.8125rem;
	}
	.hp-cards {
		padding-bottom: 0.5rem;
	}
	.hp-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		width: 100%;
		margin-bottom: 0.6rem;
		padding: 0.6rem 0.75rem;
		border-left: 3px solid color-mix(in oklch, var(--color-base-content) 18%, transparent);
		border-radius: 0 0.5rem 0.5rem 0;
		background: color-mix(in oklch, var(--color-base-content) 3%, transparent);
		text-align: left;
	}
	button.hp-card {
		cursor: pointer;
	}
	button.hp-card:hover {
		background: color-mix(in oklch, var(--color-base-content) 6%, transparent);
	}
	.hp-added {
		border-left-color: oklch(0.7 0.15 150);
	}
	.hp-removed {
		border-left-color: oklch(0.68 0.17 25);
	}
	.hp-changed,
	.hp-step {
		border-left-color: oklch(0.75 0.13 85);
	}
	.hp-label {
		color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		font-size: 0.75rem;
	}
	.hp-text {
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.hp-code {
		font-family: ui-monospace, monospace;
		font-size: 0.8125rem;
	}
	.hp-panel ins {
		border-radius: 2px;
		background: oklch(0.9 0.09 150 / 0.7);
		text-decoration: none;
	}
	.hp-panel del {
		border-radius: 2px;
		background: oklch(0.9 0.07 25 / 0.6);
		color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
		text-decoration: line-through;
	}
	/* A word swapped for another: keep the two apart. */
	.hp-panel del + ins {
		margin-left: 0.2em;
	}
	:global([data-theme='night']) .hp-panel ins {
		background: oklch(0.5 0.11 150 / 0.55);
	}
	:global([data-theme='night']) .hp-panel del {
		background: oklch(0.5 0.12 25 / 0.45);
	}

	/* Marks on the page itself while the panel is open. */
	:global(.mdp-history-picking) {
		cursor: pointer;
	}
	/* A tint, not an outline: the article clips anything drawn outside it. */
	:global(.mdp-history-picked) {
		border-radius: 3px;
		background-color: oklch(0.9 0.11 85 / 0.45);
		box-shadow: inset 3px 0 0 oklch(0.75 0.13 85);
	}
	:global(.mdp-history-flash) {
		animation: mdp-history-flash 1.6s ease-out;
	}
	@keyframes -global-mdp-history-flash {
		from {
			background-color: oklch(0.9 0.12 85 / 0.8);
		}
		to {
			background-color: transparent;
		}
	}
</style>
