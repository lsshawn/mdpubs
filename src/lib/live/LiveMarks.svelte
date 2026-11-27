<script lang="ts" module>
	import {
		blockBox,
		blockOfNode,
		indexArticle,
		selectionOffsets,
		textBoxes
	} from '../components/comments/comment-dom.js';
	import { blockAt } from '#lib/helpers/comment-anchor.js';
	import { pageHash, personHue, type LivePerson, type LiveRoom } from './room.svelte.js';

	/** Where on the page (document y) this person last clicked or selected, if it still matches. */
	export function pointerTop(article: HTMLElement, person: LivePerson): number | null {
		const p = person.p;
		if (!p) return null;
		const index = indexArticle(article);
		if (p.h !== pageHash(index.doc.text) || p.b >= index.blocks.length) return null;
		const box = blockBox(index, p.b);
		return box ? box.top + window.scrollY : null;
	}
</script>

<script lang="ts">
	/**
	 * Where other people are in the text: the words they selected, tinted in their
	 * colour, and their face just right of the margin bracket, level with the line
	 * they clicked. Also reports this reader's own clicks and selections to the room.
	 *
	 * Sits in the `position: relative` box around the <article>, like the comments
	 * layer, and draws from positions re-measured whenever the layout changes.
	 * Pointers are block numbers and character offsets into the page text
	 * (comment-dom.ts), so they land on the same words at any screen width. One
	 * made on a different version of the page is skipped (pageHash).
	 */

	let {
		article,
		html,
		room,
		hidden = false
	}: {
		article: HTMLElement | null;
		/** The note's HTML. Only read so marks are re-measured when it changes. */
		html: string;
		room: LiveRoom;
		/** The reader turned other people's marks off (comments menu). */
		hidden?: boolean;
	} = $props();

	const FACE = 18;
	const FACE_GAP = 3;
	/** Past the article's right edge: the comment bracket's width, then a little air. */
	const FACE_OFFSET = 14;

	let layoutTick = $state(0);

	type Line = { left: number; top: number; width: number; height: number };
	type Mark = {
		key: string;
		person: LivePerson;
		hue: number;
		label: string;
		lines: Line[];
		faceTop: number;
		faceLeft: number;
	};

	function label(p: LivePerson): string {
		const who = p.name ?? 'Someone';
		return p.p?.s !== undefined ? `${who} selected this` : `${who} is here`;
	}

	let marks = $derived.by((): Mark[] => {
		void layoutTick;
		void html;
		const wrapper = article?.parentElement;
		const pointing = hidden ? [] : room.others.filter((p) => p.p);
		if (!article || !wrapper || !pointing.length) return [];
		const index = indexArticle(article);
		const hash = pageHash(index.doc.text);
		const base = wrapper.getBoundingClientRect();
		const right = article.getBoundingClientRect().right - base.left + FACE_OFFSET;
		// Never past the screen's right edge (a phone has no margin to spare).
		const maxLeft = document.documentElement.clientWidth - base.left - FACE - 2;
		const perBlock: Record<number, number> = {};
		const out: Mark[] = [];
		for (const person of pointing) {
			const p = person.p!;
			if (p.h !== hash || p.b >= index.blocks.length) continue;
			const box = blockBox(index, p.b);
			if (!box) continue;
			let lines: Line[] = [];
			if (p.s !== undefined && p.e !== undefined) {
				lines = textBoxes(index, p.s, p.e).map((r) => ({
					left: r.left - base.left,
					top: r.top - base.top,
					width: r.right - r.left,
					height: r.bottom - r.top
				}));
			}
			const top = (lines[0]?.top ?? box.top - base.top) + 1;
			const k = (perBlock[p.b] = (perBlock[p.b] ?? -1) + 1);
			out.push({
				key: person.u,
				person,
				hue: personHue(person.u),
				label: label(person),
				lines,
				// Several people on one line stack downwards, clear of the notes column.
				faceTop: top + k * (FACE + FACE_GAP),
				faceLeft: Math.min(right, maxLeft)
			});
		}
		return out;
	});

	/**
	 * This reader's click or selection, as a pointer the room can pass on. A click
	 * uses what was clicked, not the selection: clicking a line opens the comment
	 * box, which takes the focus (and the caret) out of the article.
	 */
	function report(target: Node, y: number) {
		if (!article) return;
		const index = indexArticle(article);
		const h = pageHash(index.doc.text);
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed && sel.rangeCount) {
			const off = selectionOffsets(index, sel.getRangeAt(0));
			if (off) {
				room.setPointer({ b: blockAt(index.doc, off.start), s: off.start, e: off.end, h });
				return;
			}
		}
		let b = blockOfNode(index, target);
		// The space beside a line: the block level with the click.
		if (b === null) {
			let best = Infinity;
			index.blocks.forEach((_, i) => {
				const box = blockBox(index, i);
				if (box && box.top <= y && y <= box.bottom && box.bottom - box.top < best) {
					best = box.bottom - box.top;
					b = i;
				}
			});
		}
		if (b !== null) room.setPointer({ b, h });
	}

	function onPointerUp(e: PointerEvent) {
		const target = e.target as Node;
		if (!article?.contains(target)) return;
		// Let the browser settle the selection first.
		const y = e.clientY;
		requestAnimationFrame(() => report(target, y));
	}

	/** Re-measure when anything moves: the window, the article, an opened <details>. */
	function watchLayout(node: HTMLElement) {
		let queued = 0;
		const relayout = () => {
			if (queued) return;
			queued = requestAnimationFrame(() => {
				queued = 0;
				layoutTick++;
			});
		};
		const sizes = new ResizeObserver(relayout);
		sizes.observe(node.parentElement ?? node);
		window.addEventListener('resize', relayout);
		document.addEventListener('toggle', relayout, true);
		document.addEventListener('pointerup', onPointerUp);
		document.addEventListener('keyup', onKeyUp);
		return () => {
			cancelAnimationFrame(queued);
			sizes.disconnect();
			window.removeEventListener('resize', relayout);
			document.removeEventListener('toggle', relayout, true);
			document.removeEventListener('pointerup', onPointerUp);
			document.removeEventListener('keyup', onKeyUp);
		};
	}

	function onKeyUp(e: KeyboardEvent) {
		// A selection made with Shift and the arrow keys.
		const node = window.getSelection()?.anchorNode ?? null;
		if (e.shiftKey && node && article?.contains(node)) report(node, 0);
	}
</script>

<div class="live-marks print:hidden" {@attach watchLayout} data-comments-ignore>
	{#each marks as m (m.key)}
		{#each m.lines as l, i (i)}
			<div
				class="lm-tint"
				style="left: {l.left}px; top: {l.top}px; width: {l.width}px; height: {l.height}px; --hue: {m.hue}"
			></div>
		{/each}
		<div
			class="lm-face tooltip tooltip-left"
			data-tip={m.label}
			style="left: {m.faceLeft}px; top: {m.faceTop}px; width: {FACE}px; height: {FACE}px; --hue: {m.hue}"
		>
			<span aria-label={m.label}
				>{m.person.name ? m.person.name.slice(0, 1).toUpperCase() : ''}</span
			>
		</div>
	{/each}
</div>

<style>
	.live-marks {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
	}
	.lm-tint {
		position: absolute;
		border-radius: 2px;
		background: hsl(var(--hue) 70% 55% / 0.18);
		box-shadow: inset 0 -2px 0 hsl(var(--hue) 60% 50% / 0.7);
		transition:
			top 0.2s,
			left 0.2s,
			width 0.2s;
	}
	.lm-face {
		position: absolute;
		pointer-events: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		background: hsl(var(--hue) 55% 48%);
		color: white;
		font-size: 0.6rem;
		font-weight: 600;
		transition: top 0.2s;
	}
	@media (prefers-reduced-motion: reduce) {
		.lm-tint,
		.lm-face {
			transition: none;
		}
	}
</style>
