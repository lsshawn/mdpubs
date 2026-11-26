<script lang="ts">
	/**
	 * Margin comments for a published note.
	 *
	 * Sits inside the `position: relative` box that wraps the <article>. Nothing
	 * in the article's HTML is touched: brackets, highlights and notes are drawn in
	 * a layer over it, from positions re-measured whenever the layout changes.
	 *
	 * Wide screens: a hand-drawn `]` beside the commented block and the comment in
	 * the right margin. Narrow screens: the bracket sits in the page gutter and the
	 * comments open in a sheet.
	 */
	import '@fontsource/reenie-beanie/latin-400.css';
	import { untrack } from 'svelte';
	import { MessageSquare, MessageSquareOff } from 'lucide-svelte';
	import {
		blockAt as docBlockAt,
		makeAnchor,
		resolveAnchor,
		type CommentAnchor,
		type ResolvedAnchor
	} from '#lib/helpers/comment-anchor.js';
	import type { CommentDto, CommentsState } from '#lib/server/api/services/comments.js';
	import {
		blockBox,
		blockOfNode,
		indexArticle,
		selectionOffsets,
		textBoxes,
		type Box,
		type DomIndex
	} from './comment-dom.js';
	import { bracket, type BracketStroke } from './bracket.js';
	import CommentComposer, { commenterKey } from './CommentComposer.svelte';

	type Props = {
		article: HTMLElement | null;
		/** The note's HTML. Only read so the article is re-indexed when it changes. */
		html: string;
		noteId: string;
		apiUrl: string;
		initial: CommentsState;
		/** Comments shown (true) or the clean reading view (false). */
		visible?: boolean;
	};
	let { article, html, noteId, apiUrl, initial, visible = $bindable(true) }: Props = $props();

	const HIDDEN_KEY = 'mdpubs:comments-hidden';
	/** Clicks on these belong to the thing clicked, not to commenting. */
	const INTERACTIVE =
		'a,button,input,textarea,select,label,summary,video,audio,iframe,[role="button"],[contenteditable="true"],[data-mdpubs-sign-here],[data-comments-ignore]';
	const NOTE_GAP = 32;
	const NOTE_WIDTH = 256;

	// The page keys this component by note, so `initial` is this note's for good.
	const config = untrack(() => initial);
	let comments = $state<CommentDto[]>(untrack(() => initial.comments));
	let index = $state.raw<DomIndex | null>(null);
	let layoutTick = $state(0);
	let showResolved = $state(false);
	let active = $state<string | null>(null);
	let replyTo = $state<string | null>(null);
	let hover = $state<number | null>(null);
	let sheetOpen = $state(false);
	let heights = $state<Record<string, number>>({});
	let rootEl = $state<HTMLElement | null>(null);

	type Draft = {
		anchor: CommentAnchor;
		block: number;
		endBlock: number;
		start?: number;
		end?: number;
	};
	let draft = $state.raw<Draft | null>(null);
	/** A text selection waiting for the "Comment" button. */
	let pending = $state.raw<{ start: number; end: number; x: number; y: number } | null>(null);

	type Placed = {
		root: CommentDto;
		replies: CommentDto[];
		r: ResolvedAnchor;
		block: number;
		endBlock: number;
		detached: boolean;
	};

	const resolvedIds = $derived(new Set(comments.filter((c) => c.resolvedAt).map((c) => c.id)));
	const openCount = $derived(comments.filter((c) => !c.parentId && !c.resolvedAt).length);
	const resolvedCount = $derived(comments.filter((c) => !c.parentId && c.resolvedAt).length);

	/** Every thread, with the place its anchor resolves to in the page as it is now. */
	const placed = $derived.by<Placed[]>(() => {
		if (!index || !index.blocks.length) return [];
		const last = index.blocks.length - 1;
		const out: Placed[] = [];
		for (const c of comments) {
			if (c.parentId || !c.anchor) continue;
			if (c.resolvedAt && !showResolved) continue;
			const r = resolveAnchor(c.anchor, index.doc);
			const detached = r.status === 'detached';
			const block = r.block ?? last;
			out.push({
				root: c,
				replies: comments.filter((x) => x.parentId === c.id),
				r,
				block,
				endBlock: detached ? block : (r.endBlock ?? block),
				detached
			});
		}
		return out;
	});

	function hostRect(): DOMRect {
		return index!.root.parentElement!.getBoundingClientRect();
	}

	/** Block positions, relative to the box that wraps the article. */
	const frame = $derived.by(() => {
		void layoutTick;
		if (!index || !visible) return null;
		const host = hostRect();
		const art = index.root.getBoundingClientRect();
		const boxes = index.blocks.map((_, i): Box | null => {
			const b = blockBox(index!, i);
			return (
				b && {
					left: b.left - host.left,
					right: b.right - host.left,
					top: b.top - host.top,
					bottom: b.bottom - host.top
				}
			);
		});
		return {
			boxes,
			right: art.right - host.left,
			width: art.width,
			// Room for the notes column beside the article?
			wide: document.documentElement.clientWidth - art.right >= NOTE_GAP + NOTE_WIDTH
		};
	});

	type Mark = {
		key: string;
		ids: string[];
		strokes: BracketStroke[];
	};

	function span(block: number, endBlock: number): { top: number; bottom: number } | null {
		const a = frame?.boxes[block];
		const b = frame?.boxes[endBlock];
		if (!a || !b) return null;
		// Table rows and list items sit close together: keep their brackets apart.
		const tight = /^(tr|li|dt|dd)$/.test(index!.blocks[block].tag);
		const pad = tight ? 0 : 4;
		return { top: a.top - pad, bottom: Math.max(b.bottom, a.bottom) + pad };
	}

	/** One bracket per commented stretch of the page, however many threads share it. */
	const marks = $derived.by<Mark[]>(() => {
		if (!frame) return [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this pass, never read reactively
		const map = new Map<string, Mark>();
		const add = (block: number, endBlock: number, id: string) => {
			const s = span(block, endBlock);
			if (!s) return;
			const key = `${block}:${endBlock}`;
			let m = map.get(key);
			if (!m) {
				m = { key, ids: [], strokes: bracket(frame.right + 2, s.top, s.bottom, key) };
				map.set(key, m);
			}
			m.ids.push(id);
		};
		for (const p of placed) if (!p.detached) add(p.block, p.endBlock, p.root.id);
		if (draft) add(draft.block, draft.endBlock, 'draft');
		return [...map.values()];
	});

	/** Comments whose text was removed: a dot where the text used to be. */
	const dots = $derived.by(() => {
		if (!frame) return [];
		const out: { id: string; y: number }[] = [];
		for (const p of placed) {
			const b = p.detached ? frame.boxes[p.block] : null;
			if (b) out.push({ id: p.root.id, y: b.bottom + 2 });
		}
		return out;
	});

	const hoverStrokes = $derived.by(() => {
		if (!frame || hover === null || !config.canComment) return null;
		if (marks.some((m) => m.key === `${hover}:${hover}`)) return null;
		const s = span(hover, hover);
		return s && bracket(frame.right + 2, s.top, s.bottom, `${hover}:${hover}`);
	});

	const highlights = $derived.by(() => {
		if (!frame || !index) return [];
		const host = hostRect();
		const width = frame.width;
		const out: { id: string; boxes: Box[] }[] = [];
		const add = (id: string, start: number, end: number) => {
			const boxes = textBoxes(index!, start, end)
				.map((b) => ({
					left: Math.max(0, b.left - host.left - 2),
					right: Math.min(width, b.right - host.left + 2),
					top: b.top - host.top - 1,
					bottom: b.bottom - host.top + 1
				}))
				.filter((b) => b.right > b.left);
			if (boxes.length) out.push({ id, boxes });
		};
		for (const p of placed) {
			if (!p.detached && p.r.start !== undefined) add(p.root.id, p.r.start, p.r.end!);
		}
		if (draft?.start !== undefined) add('draft', draft.start, draft.end!);
		return out;
	});

	/** Notes down the margin: each beside its block, pushed apart where they would overlap. */
	const tops = $derived.by<Record<string, number>>(() => {
		if (!frame?.wide) return {};
		const items: { id: string; center: number; order: number }[] = [];
		for (const p of placed) {
			const a = frame.boxes[p.block];
			const b = frame.boxes[p.endBlock];
			if (!a || !b) continue;
			items.push({
				id: p.root.id,
				center: p.detached ? a.bottom + 2 : (a.top + b.bottom) / 2,
				order: p.root.createdAt
			});
		}
		if (draft) {
			const s = span(draft.block, draft.endBlock);
			if (s) items.push({ id: 'draft', center: (s.top + s.bottom) / 2, order: Infinity });
		}
		items.sort((x, y) => x.center - y.center || x.order - y.order);
		const h = (id: string) => heights[id] ?? 60;
		const gap = 14;
		const out: Record<string, number> = {};
		// The note being written keeps its place; the others make room around it.
		const focus = items.findIndex((i) => i.id === (draft ? 'draft' : replyTo));
		const from = Math.max(focus, 0);
		let floor = -Infinity;
		for (let i = from; i < items.length; i++) {
			const top = Math.max(items[i].center - h(items[i].id) / 2, floor, i === from ? 0 : -Infinity);
			out[items[i].id] = top;
			floor = top + h(items[i].id) + gap;
		}
		let ceiling = from < items.length ? out[items[from].id] : Infinity;
		for (let i = from - 1; i >= 0; i--) {
			const top = Math.min(items[i].center - h(items[i].id) / 2, ceiling - gap - h(items[i].id));
			out[items[i].id] = top;
			ceiling = top;
		}
		return out;
	});

	/** Threads on the block picked on a narrow screen. */
	const sheetThreads = $derived(
		draft ? placed.filter((p) => p.block <= draft!.block && draft!.block <= p.endBlock) : []
	);

	// ─── Picking a place to comment ─────────────────────────────────────────────

	function blockAtPoint(target: Element, clientY: number): number | null {
		if (!index || !frame) return null;
		const y = clientY - hostRect().top;
		const inside = (i: number) => {
			const b = frame!.boxes[i];
			return !!b && y >= b.top && y <= b.bottom;
		};
		const direct = index.root.contains(target) ? blockOfNode(index, target) : null;
		if (direct !== null && inside(direct)) return direct;
		let best: number | null = null;
		let bestGap = 20;
		frame.boxes.forEach((b, i) => {
			if (!b) return;
			const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
			if (d < bestGap) {
				bestGap = d;
				best = i;
			}
		});
		return best ?? direct;
	}

	function startDraft(block: number, range?: { start: number; end: number }) {
		if (!index) return;
		draft = {
			anchor: makeAnchor(index.doc, block, range),
			block,
			endBlock: range ? Math.max(block, docBlockAt(index.doc, range.end - 1)) : block,
			start: range?.start,
			end: range?.end
		};
		replyTo = null;
		pending = null;
		if (range) window.getSelection()?.removeAllRanges();
		// On a narrow screen a tapped line only shows its bracket and a button; a
		// selection has already been through the button, so open the sheet.
		sheetOpen = !frame?.wide && !!range;
	}

	function closeDraft() {
		draft = null;
		sheetOpen = false;
	}

	function onZoneClick(e: MouseEvent) {
		if (!visible || !index || !frame || e.button !== 0 || e.defaultPrevented) return;
		const target = e.target as Element;
		if (rootEl?.contains(target) || target.closest(INTERACTIVE)) return;
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) return;

		// A click on highlighted text goes to its comment.
		const host = hostRect();
		const x = e.clientX - host.left;
		const y = e.clientY - host.top;
		for (const h of highlights) {
			if (h.id === 'draft') continue;
			if (h.boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)) {
				const p = placed.find((q) => q.root.id === h.id);
				if (!p) continue;
				active = h.id;
				if (!frame.wide) {
					startDraft(p.block);
					sheetOpen = true;
				}
				return;
			}
		}

		const i = blockAtPoint(target, e.clientY);
		if (i === null) return;
		// Someone who can't comment can still open a line's comments on a narrow screen.
		if (
			!config.canComment &&
			(frame.wide || !placed.some((p) => p.block <= i && i <= p.endBlock))
		) {
			return;
		}
		if (draft && draft.block === i && draft.start === undefined) return closeDraft();
		startDraft(i);
	}

	function readSelection() {
		if (!visible || !index || !config.canComment) return (pending = null);
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !sel.rangeCount) return (pending = null);
		const range = sel.getRangeAt(0);
		if (rootEl?.contains(range.commonAncestorContainer)) return;
		const found = selectionOffsets(index, range);
		const rect = range.getClientRects()[0];
		if (!found || !rect) return (pending = null);
		const host = hostRect();
		pending = { ...found, x: rect.left + rect.width / 2 - host.left, y: rect.top - host.top };
	}

	function commentOnSelection() {
		if (!pending || !index) return;
		startDraft(docBlockAt(index.doc, pending.start), { start: pending.start, end: pending.end });
	}

	// ─── Talking to the server ──────────────────────────────────────────────────

	async function api(path: string, method: string, body?: unknown) {
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		const key = commenterKey();
		if (key) headers['x-comment-key'] = key;
		const res = await fetch(`${apiUrl}/notes/${noteId}/comments${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data?.error || 'Could not reach the server. Try again.');
		return data;
	}

	async function post(input: object): Promise<string | null> {
		try {
			const created: CommentDto = await api('', 'POST', input);
			comments = [...comments, created];
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : 'Could not post the comment.';
		}
	}

	async function submitDraft(input: object) {
		if (!draft) return 'Pick a line first.';
		const problem = await post({ ...input, anchor: draft.anchor });
		if (!problem) closeDraft();
		return problem;
	}

	async function submitReply(rootId: string, input: object) {
		const problem = await post({ ...input, parentId: rootId });
		if (!problem) replyTo = null;
		return problem;
	}

	async function setResolved(id: string, resolved: boolean) {
		const before = comments;
		comments = comments.map((c) =>
			c.id === id ? { ...c, resolvedAt: resolved ? Date.now() : null } : c
		);
		try {
			await api(`/${id}`, 'PATCH', { resolved });
		} catch (e) {
			comments = before;
			alert(e instanceof Error ? e.message : 'Could not update the comment.');
		}
	}

	async function remove(c: CommentDto) {
		if (!confirm(c.parentId ? 'Delete this reply?' : 'Delete this comment and its replies?'))
			return;
		try {
			await api(`/${c.id}`, 'DELETE');
			comments = comments.filter((x) => x.id !== c.id && x.parentId !== c.id);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Could not delete the comment.');
		}
	}

	/**
	 * The owner's browser keeps anchors fresh. When a comment was only found by a
	 * near match (its text was edited), save a description of where it is now, so
	 * the next edit is compared against today's text, not the original.
	 */
	function refreshAnchors(at: DomIndex) {
		if (!config.canModerate) return;
		for (const c of comments) {
			if (c.parentId || !c.anchor) continue;
			const r = resolveAnchor(c.anchor, at.doc);
			if (r.status !== 'changed' || r.block === null) continue;
			const hasRange = r.start !== undefined && r.end !== undefined;
			// A quote that can't be placed keeps its old anchor: the words may come back.
			if (c.anchor.kind === 'text' && !hasRange) continue;
			const anchor = makeAnchor(
				at.doc,
				r.block,
				hasRange ? { start: r.start!, end: r.end! } : undefined
			);
			api(`/${c.id}`, 'PATCH', { anchor })
				.then(() => {
					comments = comments.map((x) => (x.id === c.id ? { ...x, anchor } : x));
				})
				.catch(() => {});
		}
	}

	// ─── Wiring to the page ─────────────────────────────────────────────────────

	function toggle() {
		visible = !visible;
		if (!visible) {
			draft = null;
			pending = null;
			sheetOpen = false;
		}
		try {
			if (visible) localStorage.removeItem(HIDDEN_KEY);
			else localStorage.setItem(HIDDEN_KEY, '1');
		} catch {
			// The choice just won't be remembered.
		}
	}

	function setup(node: HTMLElement) {
		const root = article;
		void html;
		if (!root) return;
		return untrack(() => {
			rootEl = node;
			const at = indexArticle(root);
			index = at;
			try {
				if (localStorage.getItem(HIDDEN_KEY)) visible = false;
			} catch {
				// Storage blocked: comments stay on.
			}
			refreshAnchors(at);
			// A returning guest: ask again with their key so their own comments are marked.
			if (!config.viewer && commenterKey() && comments.length) {
				api('', 'GET')
					.then((s: CommentsState) => (comments = s.comments))
					.catch(() => {});
			}

			let queued = 0;
			const relayout = () => {
				if (queued) return;
				queued = requestAnimationFrame(() => {
					queued = 0;
					layoutTick++;
				});
			};
			const zone = (node.closest('[data-comments-zone]') as HTMLElement | null) ?? root;
			const sizes = new ResizeObserver(relayout);
			sizes.observe(root);
			sizes.observe(zone);
			document.fonts?.ready.then(relayout);

			let pointerDown = false;
			let selTimer = 0;
			const onSelection = () => {
				clearTimeout(selTimer);
				if (pointerDown) return;
				selTimer = window.setTimeout(readSelection, 120);
			};
			const onDown = () => (pointerDown = true);
			const onUp = () => {
				pointerDown = false;
				onSelection();
			};
			const onMove = (e: PointerEvent) => {
				if (e.pointerType !== 'mouse' || !visible) return;
				const target = e.target as Element;
				hover =
					rootEl?.contains(target) || target.closest(INTERACTIVE)
						? null
						: blockAtPoint(target, e.clientY);
			};
			const onLeave = () => (hover = null);
			const onKey = (e: KeyboardEvent) => {
				if (e.key !== 'Escape' || e.defaultPrevented) return;
				if (draft || replyTo) {
					closeDraft();
					replyTo = null;
				}
			};

			const ac = new AbortController();
			const opts = { signal: ac.signal };
			window.addEventListener('resize', relayout, opts);
			// Tables and code blocks scroll sideways inside the article.
			root.addEventListener('scroll', relayout, {
				signal: ac.signal,
				capture: true,
				passive: true
			});
			root.addEventListener('load', relayout, { signal: ac.signal, capture: true });
			root.addEventListener('toggle', relayout, { signal: ac.signal, capture: true });
			zone.addEventListener('click', onZoneClick, opts);
			zone.addEventListener('pointermove', onMove, opts);
			zone.addEventListener('pointerleave', onLeave, opts);
			document.addEventListener('selectionchange', onSelection, opts);
			document.addEventListener('pointerdown', onDown, opts);
			document.addEventListener('pointerup', onUp, opts);
			document.addEventListener('keydown', onKey, opts);

			return () => {
				ac.abort();
				sizes.disconnect();
				cancelAnimationFrame(queued);
				clearTimeout(selTimer);
				index = null;
			};
		});
	}

	function ago(ms: number): string {
		const s = Math.max(0, (Date.now() - ms) / 1000);
		if (s < 60) return 'now';
		if (s < 3600) return `${Math.floor(s / 60)}m`;
		if (s < 86400) return `${Math.floor(s / 3600)}h`;
		if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
		return new Date(ms).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	const viewerName = $derived(config.viewer ? config.viewer.name : null);
</script>

{#snippet entry(c: CommentDto)}
	<div class="mc-entry">
		<p class="mc-hand">{c.body}</p>
		<p class="mc-meta">
			<span>{c.authorName}{c.byOwner ? ' (author)' : ''}</span>
			<span>· {ago(c.createdAt)}</span>
			{#if c.authorEmail && !c.byOwner}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href="mailto:{c.authorEmail}" title={c.authorEmail}>· email</a>
			{/if}
			{#if c.mine || config.canModerate}
				<button type="button" class="mc-act" onclick={() => remove(c)}>· delete</button>
			{/if}
		</p>
	</div>
{/snippet}

{#snippet thread(p: Placed, inSheet: boolean)}
	{#if p.detached}
		{@const was = p.root.anchor?.quote || p.root.anchor?.text}
		<p class="mc-meta mc-note-flag">
			The text this was on was removed{was ? `: “${was.slice(0, 120)}”` : ''}
		</p>
	{:else if p.r.status === 'changed' && p.root.anchor?.kind === 'text' && p.r.start === undefined}
		<p class="mc-meta mc-note-flag">Was on: “{p.root.anchor.quote?.slice(0, 120)}”</p>
	{/if}
	{@render entry(p.root)}
	{#each p.replies as reply (reply.id)}
		{@render entry(reply)}
	{/each}
	<p class="mc-meta mc-actions" class:mc-shown={inSheet}>
		{#if config.canComment && !p.root.resolvedAt}
			<button
				type="button"
				onclick={() => {
					replyTo = replyTo === p.root.id ? null : p.root.id;
					if (!inSheet) draft = null;
				}}>Reply</button
			>
		{/if}
		{#if config.canModerate}
			<button type="button" onclick={() => setResolved(p.root.id, !p.root.resolvedAt)}>
				{p.root.resolvedAt ? 'Reopen' : 'Resolve'}
			</button>
		{:else if p.root.resolvedAt}
			<span>Resolved</span>
		{/if}
	</p>
	{#if replyTo === p.root.id}
		<div class="mc-reply">
			<CommentComposer
				{viewerName}
				email={config.email}
				placeholder="Reply"
				onsubmit={(input) => submitReply(p.root.id, input)}
				oncancel={() => (replyTo = null)}
			/>
		</div>
	{/if}
{/snippet}

<div class="mc-root print:hidden" data-comments-ignore {@attach setup}>
	{#if visible && frame}
		<div class="mc-layer" class:mc-wide={frame.wide}>
			{#each highlights as h (h.id)}
				{#each h.boxes as b, i (i)}
					<span
						class="mc-highlight"
						class:mc-on={active === h.id || h.id === 'draft'}
						style="left:{b.left}px;top:{b.top}px;width:{b.right - b.left}px;height:{b.bottom -
							b.top}px"
					></span>
				{/each}
			{/each}

			<svg class="mc-svg" aria-hidden="true">
				{#if hoverStrokes}
					<g class="mc-hover">
						{#each hoverStrokes as s, i (i)}
							<path d={s.d} />
						{/each}
					</g>
				{/if}
				{#each marks as m (m.key)}
					<g
						class="mc-mark"
						class:mc-on={m.ids.includes(active ?? '') || m.ids.includes('draft')}
						class:mc-faded={m.ids.every((id) => resolvedIds.has(id))}
					>
						{#each m.strokes as s, i (i)}
							<path d={s.d} pathLength="1" />
						{/each}
					</g>
				{/each}
				{#each dots as d (d.id)}
					<circle class="mc-dot" cx={frame.right + 8} cy={d.y} r="2.5" />
				{/each}
			</svg>

			{#if pending && frame.wide}
				<button
					type="button"
					class="mc-pill mc-pill-float"
					style="left:{pending.x}px;top:{pending.y}px"
					onpointerdown={(e) => e.preventDefault()}
					onclick={commentOnSelection}
				>
					Comment
				</button>
			{/if}

			{#if frame.wide}
				<div class="mc-column" style="left:{frame.right + NOTE_GAP}px;width:{NOTE_WIDTH}px">
					{#each placed as p (p.root.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="mc-note"
							class:mc-resolved={!!p.root.resolvedAt}
							class:mc-on={active === p.root.id || replyTo === p.root.id}
							style="top:{tops[p.root.id] ?? 0}px"
							bind:offsetHeight={heights[p.root.id]}
							onpointerenter={() => (active = p.root.id)}
							onpointerleave={() => (active = active === p.root.id ? null : active)}
							onfocusin={() => (active = p.root.id)}
						>
							{@render thread(p, false)}
						</div>
					{/each}
					{#if draft}
						<div class="mc-note" style="top:{tops.draft ?? 0}px" bind:offsetHeight={heights.draft}>
							{#if config.canComment}
								<CommentComposer
									{viewerName}
									email={config.email}
									onsubmit={submitDraft}
									oncancel={closeDraft}
								/>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if !frame.wide}
			{#if pending && !sheetOpen}
				<button
					type="button"
					class="mc-pill mc-pill-fixed"
					onpointerdown={(e) => e.preventDefault()}
					onclick={commentOnSelection}
				>
					Comment on selection
				</button>
			{:else if draft && !sheetOpen}
				<button type="button" class="mc-pill mc-pill-fixed" onclick={() => (sheetOpen = true)}>
					{sheetThreads.length
						? `${sheetThreads.length} comment${sheetThreads.length === 1 ? '' : 's'}`
						: 'Comment on this line'}
				</button>
			{/if}
			{#if draft && sheetOpen}
				<button type="button" class="mc-backdrop" aria-label="Close comments" onclick={closeDraft}
				></button>
				<div class="mc-sheet" role="dialog" aria-label="Comments">
					{#each sheetThreads as p (p.root.id)}
						<div class="mc-sheet-thread" class:mc-resolved={!!p.root.resolvedAt}>
							{@render thread(p, true)}
						</div>
					{/each}
					{#if config.canComment && !replyTo}
						<CommentComposer
							{viewerName}
							email={config.email}
							focus={!sheetThreads.length}
							onsubmit={submitDraft}
							oncancel={closeDraft}
						/>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}

	<div class="mc-toggle">
		{#if visible && resolvedCount}
			<button type="button" class="mc-toggle-text" onclick={() => (showResolved = !showResolved)}>
				{showResolved ? 'Hide' : 'Show'}
				{resolvedCount} resolved
			</button>
		{/if}
		<button
			type="button"
			class="mc-toggle-btn"
			aria-pressed={visible}
			title={visible
				? config.canComment
					? 'Hide comments. Click a line or select text to comment.'
					: 'Hide comments. Log in to MdPubs to add one.'
				: 'Show comments'}
			onclick={toggle}
		>
			{#if visible}
				<MessageSquare size={16} />
			{:else}
				<MessageSquareOff size={16} />
			{/if}
			{#if openCount}<span>{openCount}</span>{/if}
		</button>
	</div>
</div>

<style>
	.mc-root {
		--mc-ink: var(--color-base-content);
		--mc-soft: color-mix(in oklch, var(--color-base-content) 45%, transparent);
	}
	.mc-layer {
		position: absolute;
		inset: 0;
		z-index: 10;
		pointer-events: none;
	}
	.mc-highlight {
		position: absolute;
		border-radius: 2px;
		background: color-mix(in oklch, var(--color-base-content) 9%, transparent);
		transition: background-color 150ms;
	}
	.mc-highlight.mc-on {
		background: color-mix(in oklch, var(--color-base-content) 17%, transparent);
	}
	.mc-svg {
		position: absolute;
		top: 0;
		left: 0;
		/* The brackets sit just past the article's right edge: keep them inside
		   the SVG's own box so they are never culled. */
		width: calc(100% + 24px);
		height: 100%;
		overflow: visible;
		color: var(--mc-ink);
	}
	.mc-svg path {
		fill: none;
		stroke: currentColor;
		stroke-width: 1;
		stroke-linecap: round;
	}
	.mc-mark path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		/* Top tick, upright, bottom tick, one after another. Fixed timings, so a
		   re-measure never restarts a finished stroke. */
		animation: mc-draw 120ms ease-out forwards;
	}
	.mc-mark path:nth-child(2) {
		animation-duration: 520ms;
		animation-delay: 120ms;
	}
	.mc-mark path:nth-child(3) {
		animation-delay: 640ms;
	}
	.mc-mark.mc-on path {
		stroke-width: 1.5;
	}
	.mc-hover {
		opacity: 0.28;
	}
	.mc-faded {
		opacity: 0.35;
	}
	.mc-dot {
		fill: var(--mc-soft);
	}
	@keyframes mc-draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mc-mark path {
			animation: none;
			stroke-dashoffset: 0;
		}
	}

	.mc-column {
		position: absolute;
		top: 0;
		bottom: 0;
	}
	.mc-note {
		position: absolute;
		left: 0;
		width: 100%;
		pointer-events: auto;
		transition:
			top 180ms ease,
			opacity 150ms;
	}
	.mc-resolved {
		opacity: 0.45;
	}
	.mc-entry + .mc-entry {
		margin-top: 0.625rem;
	}
	.mc-hand {
		font-family: 'Reenie Beanie', 'Bradley Hand', 'Segoe Print', cursive;
		font-size: 1.625rem;
		line-height: 0.95;
		color: color-mix(in oklch, var(--color-base-content) 78%, transparent);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		text-wrap: balance;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		overflow: hidden;
	}
	.mc-note.mc-on .mc-hand,
	.mc-sheet .mc-hand {
		-webkit-line-clamp: unset;
		line-clamp: unset;
	}
	.mc-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.25rem;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		line-height: 1.25rem;
		color: var(--mc-soft);
	}
	.mc-meta button,
	.mc-meta a {
		cursor: pointer;
	}
	.mc-meta button:hover,
	.mc-meta a:hover {
		color: var(--mc-ink);
	}
	.mc-note-flag {
		margin: 0 0 0.25rem;
		font-style: italic;
	}
	.mc-act,
	.mc-actions {
		opacity: 0;
		transition: opacity 150ms;
	}
	.mc-actions {
		gap: 0 0.75rem;
	}
	.mc-note.mc-on .mc-act,
	.mc-note.mc-on .mc-actions,
	.mc-note:focus-within .mc-act,
	.mc-note:focus-within .mc-actions,
	.mc-sheet .mc-act,
	.mc-actions.mc-shown {
		opacity: 1;
	}
	@media (hover: none) {
		.mc-act,
		.mc-actions {
			opacity: 1;
		}
	}
	.mc-reply {
		margin-top: 0.375rem;
	}

	.mc-pill {
		z-index: 55;
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		background: var(--color-base-content);
		color: var(--color-base-100);
		font-size: 0.75rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		pointer-events: auto;
		box-shadow: 0 4px 16px color-mix(in oklch, var(--color-base-content) 22%, transparent);
	}
	.mc-pill-float {
		position: absolute;
		transform: translate(-50%, calc(-100% - 8px));
	}
	.mc-pill-fixed {
		position: fixed;
		left: 50%;
		bottom: max(1rem, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		padding: 0.55rem 1rem;
		font-size: 0.875rem;
	}
	.mc-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in oklch, var(--color-base-content) 25%, transparent);
	}
	.mc-sheet {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 61;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 75vh;
		overflow-y: auto;
		padding: 1.25rem 1.25rem max(1.25rem, env(safe-area-inset-bottom));
		border-radius: 1rem 1rem 0 0;
		background: var(--color-base-100);
		box-shadow: 0 -8px 30px color-mix(in oklch, var(--color-base-content) 15%, transparent);
	}

	.mc-toggle {
		position: fixed;
		top: 0.5rem;
		/* Clear of the 48px corner that SecretThemeToggle listens on for a
		   double-tap, so switching comments off and on never flips the theme. */
		right: 3.5rem;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}
	/* On a phone the top corner is the title's; the bottom-left corner is free. */
	@media (max-width: 767px) {
		.mc-toggle {
			top: auto;
			right: auto;
			left: 0.75rem;
			bottom: max(0.75rem, env(safe-area-inset-bottom));
			flex-direction: row-reverse;
		}
	}
	.mc-toggle-text {
		color: var(--mc-soft);
		cursor: pointer;
	}
	.mc-toggle-text:hover {
		color: var(--mc-ink);
	}
	.mc-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 2rem;
		min-width: 2rem;
		justify-content: center;
		padding: 0 0.55rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--color-base-100) 85%, transparent);
		backdrop-filter: blur(6px);
		color: color-mix(in oklch, var(--color-base-content) 70%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-content) 10%, transparent);
		cursor: pointer;
	}
	.mc-toggle-btn:hover {
		color: var(--mc-ink);
	}
</style>
