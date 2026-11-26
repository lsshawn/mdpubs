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
	import '@fontsource/caveat/latin-500.css';
	import { untrack, type Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
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
	import { bracket, marker, type BracketStroke } from './bracket.js';
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
		/** More buttons for the corner bar, beside the comments toggle. */
		tools?: Snippet;
	};
	let {
		article,
		html,
		noteId,
		apiUrl,
		initial,
		visible = $bindable(true),
		tools
	}: Props = $props();

	const HIDDEN_KEY = 'mdpubs:comments-hidden';
	const PREFS_KEY = 'mdpubs:comments-prefs';

	/** How this reader likes comments to look. Kept in their browser. */
	type Prefs = { font: 'hand' | 'plain'; size: 's' | 'm' | 'l'; colours: boolean };
	let prefs = $state<Prefs>({ font: 'hand', size: 'm', colours: true });
	let menuOpen = $state(false);
	let toggleEl = $state<HTMLElement | null>(null);

	function setPref(patch: Partial<Prefs>) {
		prefs = { ...prefs, ...patch };
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
		} catch {
			// The choice just won't be remembered.
		}
	}
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
	/** The thread shown whole in the side drawer (its first comment's id). */
	let openThread = $state<string | null>(null);
	/** The comment the drawer should open on. Null: open on the newest, at the bottom. */
	let focusComment = $state<string | null>(null);

	function showThread(rootId: string, commentId: string | null = null) {
		focusComment = commentId;
		if (commentId) expandedBody[commentId] = true;
		openThread = rootId;
		const p = placed.find((x) => x.root.id === rootId);
		if (p && !p.detached) reveal(p.block);
	}

	/**
	 * A thread reads oldest to newest, so the drawer opens scrolled to the end,
	 * where the conversation is. Opened from "Read more", it opens on that comment.
	 */
	function placeDrawer(body: HTMLElement) {
		const target = focusComment;
		void openThread;
		requestAnimationFrame(() => {
			const el = target ? body.querySelector(`[data-comment="${target}"]`) : null;
			if (el) {
				el.scrollIntoView({ block: 'start' });
				el.classList.add('mc-flash');
			} else {
				body.scrollTop = body.scrollHeight;
			}
		});
	}
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

	/**
	 * One hue per person, in the order they first commented. The hues are spread
	 * round the wheel at one lightness and strength, so any set of them sits
	 * well together.
	 */
	const HUES = [250, 25, 150, 320, 85, 200, 355, 115];
	const hues = $derived.by(() => {
		const out: Record<string, number> = {};
		let n = 0;
		for (const c of comments) if (!(c.authorId in out)) out[c.authorId] = HUES[n++ % HUES.length];
		return out;
	});
	/** Everyone who has commented, for the legend: name, colour, how many. */
	const people = $derived.by(() => {
		const out: { id: string; name: string; hue: number; count: number }[] = [];
		for (const c of comments) {
			const p = out.find((x) => x.id === c.authorId);
			if (p) p.count++;
			else out.push({ id: c.authorId, name: c.authorName, hue: hues[c.authorId], count: 1 });
		}
		return out;
	});
	const hueOf = (id: string) => {
		const c = comments.find((x) => x.id === id);
		return c ? hues[c.authorId] : undefined;
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
		const out: { id: string; boxes: Box[]; paths: string[] }[] = [];
		const add = (id: string, start: number, end: number) => {
			const boxes = textBoxes(index!, start, end)
				.map((b) => ({
					left: Math.max(0, b.left - host.left - 2),
					right: Math.min(width, b.right - host.left + 2),
					top: b.top - host.top - 1,
					bottom: b.bottom - host.top + 1
				}))
				.filter((b) => b.right > b.left);
			if (!boxes.length) return;
			const paths = boxes.map((b, i) => marker(b.left, b.top, b.right, b.bottom, `${id}:${i}`));
			out.push({ id, boxes, paths });
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

	/** Too much for the margin: more than two replies, or a comment that runs long. */
	function isLong(p: Placed): boolean {
		return p.replies.length > 1;
	}

	/** A comment long enough to be cut short until the reader asks for the rest. */
	function isWordy(c: CommentDto, roomy: boolean): boolean {
		return c.body.length > (roomy ? 600 : 140) || c.body.split('\n').length > (roomy ? 10 : 4);
	}
	/** Comments the reader has opened in full. */
	let expandedBody = $state<Record<string, boolean>>({});

	/** The comment being reworded by its writer, and the text so far. */
	let editing = $state<{ id: string; text: string; saving: boolean; error: string } | null>(null);
	/** Earlier wording of edited comments, loaded on request. */
	let earlier = $state<Record<string, { before: string; at: number }[] | undefined>>({});

	async function saveEdit() {
		if (!editing || editing.saving) return;
		const { id, text } = editing;
		if (!text.trim()) return;
		editing.saving = true;
		editing.error = '';
		try {
			const res: { body: string; editedAt: number | null } = await api(`/${id}`, 'PATCH', {
				body: text
			});
			comments = comments.map((c) =>
				c.id === id ? { ...c, body: res.body, editedAt: res.editedAt ?? c.editedAt } : c
			);
			delete earlier[id];
			editing = null;
		} catch (e) {
			if (editing) {
				editing.saving = false;
				editing.error = e instanceof Error ? e.message : 'Could not save the change.';
			}
		}
	}

	async function toggleEarlier(id: string) {
		if (earlier[id]) return void delete earlier[id];
		try {
			const res: { edits: { before: string; at: number }[] } = await api(`/${id}`, 'GET');
			earlier[id] = res.edits;
		} catch {
			earlier[id] = [];
		}
	}
	const drawer = $derived(
		openThread ? (placed.find((p) => p.root.id === openThread) ?? null) : null
	);

	/**
	 * While a thread is open the page behind is tinted and the part being
	 * discussed is left bright, so nobody has to be told which paragraph it is.
	 */
	const spot = $derived.by(() => {
		if (drawer) return drawer.detached ? null : span(drawer.block, drawer.endBlock);
		if (sheetOpen && draft) return span(draft.block, draft.endBlock);
		return null;
	});

	/** Bring a block into the part of the screen the thread pane leaves free. */
	function reveal(block: number) {
		const el = index?.blocks[block]?.el;
		if (!el) return;
		requestAnimationFrame(() => {
			if (frame?.wide) return el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			// On a phone the sheet takes the lower part of the screen: park the block near the top.
			window.scrollTo({
				top: el.getBoundingClientRect().top + window.scrollY - 90,
				behavior: 'smooth'
			});
		});
	}

	function openSheet() {
		sheetOpen = true;
		if (draft) reveal(draft.block);
	}

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

	function startDraft(
		block: number,
		range?: { start: number; end: number },
		keepSelection = false
	) {
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
		if (range && !keepSelection) window.getSelection()?.removeAllRanges();
		// On a narrow screen a tapped line only shows its bracket and a button; a
		// selection has already been through the button, so open the sheet.
		sheetOpen = false;
		if (!frame?.wide && range) openSheet();
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
					openSheet();
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
		// With a margin to write in, selecting is enough: the comment box opens
		// beside the selection straight away. The selection itself is left alone,
		// so it can still be copied.
		if (frame?.wide) {
			if (draft?.start === found.start && draft?.end === found.end) return;
			startDraft(docBlockAt(index.doc, found.start), found, true);
			return;
		}
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
		if (!problem && openThread === rootId) {
			// Keep the newest reply in view.
			requestAnimationFrame(() => {
				const body = rootEl?.querySelector('.mc-drawer-body');
				body?.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
			});
		}
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
			if (openThread === c.id) openThread = null;
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
				const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
				if (saved) {
					prefs = {
						font: saved.font === 'plain' ? 'plain' : 'hand',
						size: saved.size === 's' || saved.size === 'l' ? saved.size : 'm',
						colours: saved.colours !== false
					};
				}
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
			const onDown = (e: PointerEvent) => {
				pointerDown = true;
				// A tap anywhere else closes the settings menu.
				if (menuOpen && !toggleEl?.contains(e.target as Node)) menuOpen = false;
			};
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
				if (openThread) return void (openThread = null);
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

{#snippet entry(c: CommentDto, roomy = false)}
	{@const wordy = isWordy(c, roomy)}
	<div class="mc-entry" class:mc-turn={roomy} data-comment={c.id}>
		{#if roomy}
			<span
				class="mc-avatar"
				class:mc-hue={prefs.colours}
				style="--h:{hues[c.authorId]}"
				aria-hidden="true">{c.authorName.trim().charAt(0).toUpperCase()}</span
			>
		{/if}
		<div class="mc-entry-main">
			{#if editing?.id === c.id}
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					class="mc-edit"
					rows="4"
					maxlength="4000"
					aria-label="Edit your comment"
					autofocus
					bind:value={editing.text}
					onkeydown={(e) => {
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							saveEdit();
						} else if (e.key === 'Escape') {
							e.preventDefault();
							editing = null;
						}
					}}></textarea>
				{#if editing.error}<p class="mc-meta mc-edit-error">{editing.error}</p>{/if}
				<p class="mc-meta mc-edit-row">
					<button type="button" onclick={() => (editing = null)}>Cancel</button>
					<button
						type="button"
						class="mc-save"
						disabled={editing.saving || !editing.text.trim()}
						onclick={saveEdit}
					>
						{editing.saving ? 'Saving' : 'Save'}
					</button>
				</p>
			{:else}
				<p
					class="mc-hand"
					class:mc-clamp={wordy && !(roomy && expandedBody[c.id])}
					class:mc-roomy={roomy}
				>
					{c.body}
				</p>
				{#if wordy}
					<!-- In the margin "Read more" opens the thread on this comment, in full.
					     In the drawer it opens and closes the comment in place. -->
					<button
						type="button"
						class="mc-meta mc-readmore"
						aria-expanded={roomy ? !!expandedBody[c.id] : undefined}
						onclick={() =>
							roomy
								? (expandedBody[c.id] = !expandedBody[c.id])
								: showThread(c.parentId ?? c.id, c.id)}
					>
						{roomy && expandedBody[c.id] ? 'Show less' : 'Read more'}
					</button>
				{/if}
			{/if}
			<p class="mc-meta">
				<span class="mc-author" class:mc-hue={prefs.colours} style="--h:{hues[c.authorId]}"
					>{c.authorName}{c.byOwner ? ' (author)' : ''}</span
				>
				<span>· {ago(c.createdAt)}</span>
				{#if c.editedAt}
					{#if c.mine || config.canModerate}
						<button
							type="button"
							title="See the earlier wording"
							aria-expanded={!!earlier[c.id]}
							onclick={() => toggleEarlier(c.id)}>· edited</button
						>
					{:else}
						<span title="Edited {ago(c.editedAt)} ago">· edited</span>
					{/if}
				{/if}
				{#if c.authorEmail && !c.byOwner}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href="mailto:{c.authorEmail}" title={c.authorEmail}>· email</a>
				{/if}
				{#if c.mine && editing?.id !== c.id}
					<button
						type="button"
						class="mc-act"
						onclick={() => (editing = { id: c.id, text: c.body, saving: false, error: '' })}
						>· edit</button
					>
				{/if}
				{#if c.mine || config.canModerate}
					<button type="button" class="mc-act" onclick={() => remove(c)}>· delete</button>
				{/if}
			</p>
			{#if earlier[c.id]}
				<div class="mc-earlier">
					{#each earlier[c.id] ?? [] as e, i (i)}
						<p class="mc-meta">
							Before the edit {ago(e.at) === 'now' ? 'just now' : `${ago(e.at)} ago`}:
						</p>
						<p class="mc-was">{e.before}</p>
					{:else}
						<p class="mc-meta">No earlier wording on record.</p>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet flag(p: Placed)}
	{#if p.detached}
		{@const was = p.root.anchor?.quote || p.root.anchor?.text}
		<p class="mc-meta mc-note-flag">
			The text this was on was removed{was ? `: “${was.slice(0, 120)}”` : ''}
		</p>
	{:else if p.r.status === 'changed' && p.root.anchor?.kind === 'text' && p.r.start === undefined}
		<p class="mc-meta mc-note-flag">Was on: “{p.root.anchor.quote?.slice(0, 120)}”</p>
	{/if}
{/snippet}

{#snippet moderation(p: Placed)}
	{#if config.canModerate}
		<button type="button" onclick={() => setResolved(p.root.id, !p.root.resolvedAt)}>
			{p.root.resolvedAt ? 'Reopen' : 'Resolve'}
		</button>
	{:else if p.root.resolvedAt}
		<span>Resolved</span>
	{/if}
{/snippet}

<!-- A thread in the margin (cut short when long) or in the phone sheet (whole). -->
{#snippet thread(p: Placed, inSheet: boolean)}
	{@const long = !inSheet && isLong(p)}
	{@const shown = inSheet ? p.replies : p.replies.slice(-1)}
	{@render flag(p)}
	{@render entry(p.root, inSheet)}
	{#if p.replies.length > shown.length}
		<button type="button" class="mc-meta mc-more" onclick={() => showThread(p.root.id)}>
			{p.replies.length - shown.length} earlier
			{p.replies.length - shown.length === 1 ? 'reply' : 'replies'}
		</button>
	{/if}
	{#each shown as reply (reply.id)}
		{@render entry(reply, inSheet)}
	{/each}
	<p class="mc-meta mc-actions" class:mc-shown={inSheet || long}>
		{#if long}
			<button type="button" class="mc-open" onclick={() => showThread(p.root.id)}>
				Open thread ({p.replies.length + 1})
			</button>
		{:else if config.canComment && !p.root.resolvedAt}
			<button
				type="button"
				onclick={() => {
					replyTo = replyTo === p.root.id ? null : p.root.id;
					if (!inSheet) draft = null;
				}}>Reply</button
			>
		{/if}
		{@render moderation(p)}
	</p>
	{#if replyTo === p.root.id && !long}
		<div class="mc-reply">
			<CommentComposer
				{viewerName}
				email={config.email}
				placeholder="Reply"
				draftKey="{noteId}:{p.root.id}"
				onsubmit={(input) => submitReply(p.root.id, input)}
				oncancel={() => (replyTo = null)}
			/>
		</div>
	{/if}
{/snippet}

<div
	class="mc-root print:hidden"
	class:mc-font-plain={prefs.font === 'plain'}
	class:mc-size-s={prefs.size === 's'}
	class:mc-size-l={prefs.size === 'l'}
	data-comments-ignore
	{@attach setup}
>
	{#if visible && frame}
		<div class="mc-layer" class:mc-wide={frame.wide} transition:fade={{ duration: 140 }}>
			<svg class="mc-svg" aria-hidden="true">
				{#each highlights as h (h.id)}
					<g
						class="mc-hl"
						class:mc-on={active === h.id || openThread === h.id}
						class:mc-hue={h.id !== 'draft' && prefs.colours}
						class:mc-plain={h.id === 'draft' || !prefs.colours}
						style="--h:{hueOf(h.id)}"
					>
						{#each h.paths as d, i (i)}
							<path class="mc-highlight" {d} />
						{/each}
					</g>
				{/each}
			</svg>

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
						class:mc-hue={m.ids[0] !== 'draft' && prefs.colours}
						class:mc-plain={m.ids[0] === 'draft' || !prefs.colours}
						style="--h:{hueOf(m.ids[0])}"
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

			{#if frame.wide}
				<div class="mc-column" style="left:{frame.right + NOTE_GAP}px;width:{NOTE_WIDTH}px">
					{#each placed as p (p.root.id)}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="mc-note"
							class:mc-resolved={!!p.root.resolvedAt}
							class:mc-on={active === p.root.id || replyTo === p.root.id}
							class:mc-long={isLong(p)}
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
								<!-- After a click the box takes the keyboard. After a selection it
								     does not, or the selection (and Ctrl+C) would be lost. -->
								<CommentComposer
									{viewerName}
									email={config.email}
									focus={draft.start === undefined}
									draftKey="{noteId}:new"
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
				<button type="button" class="mc-pill mc-pill-fixed" onclick={openSheet}>
					{sheetThreads.length
						? `${sheetThreads.length} comment${sheetThreads.length === 1 ? '' : 's'}`
						: 'Comment on this line'}
				</button>
			{/if}
			{#if draft && sheetOpen}
				<button
					type="button"
					class="mc-backdrop"
					class:mc-dim={!spot}
					aria-label="Close comments"
					onclick={closeDraft}
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
							draftKey="{noteId}:new"
							onsubmit={submitDraft}
							oncancel={closeDraft}
						/>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}

	{#if visible && spot}
		<div
			class="mc-spot"
			style="top:{spot.top - 6}px;height:{spot.bottom - spot.top + 12}px"
			transition:fade={{ duration: 140 }}
		></div>
	{/if}

	{#if visible && drawer}
		<button
			type="button"
			class="mc-drawer-backdrop"
			class:mc-dim={!spot}
			aria-label="Close thread"
			onclick={() => (openThread = null)}
		></button>
		<aside class="mc-drawer" aria-label="Comment thread">
			<header class="mc-drawer-head">
				<p class="mc-drawer-title">
					Thread · {drawer.replies.length + 1}
					{drawer.replies.length ? 'comments' : 'comment'}
				</p>
				<button
					type="button"
					class="mc-close"
					aria-label="Close"
					onclick={() => (openThread = null)}
				>
					✕
				</button>
			</header>
			<div class="mc-drawer-body" {@attach placeDrawer}>
				{@render flag(drawer)}
				{@render entry(drawer.root, true)}
				{#each drawer.replies as reply (reply.id)}
					{@render entry(reply, true)}
				{/each}
			</div>
			<footer class="mc-drawer-foot">
				<p class="mc-meta mc-actions mc-shown">{@render moderation(drawer)}</p>
				{#if config.canComment && !drawer.root.resolvedAt}
					<CommentComposer
						{viewerName}
						email={config.email}
						placeholder="Reply"
						focus={false}
						draftKey="{noteId}:{drawer.root.id}"
						onsubmit={(input) => submitReply(drawer.root.id, input)}
						oncancel={() => (openThread = null)}
					/>
				{/if}
			</footer>
		</aside>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="mc-toggle"
		bind:this={toggleEl}
		onpointerenter={(e) => e.pointerType === 'mouse' && (menuOpen = true)}
		onpointerleave={(e) => e.pointerType === 'mouse' && (menuOpen = false)}
	>
		{@render tools?.()}
		<button
			type="button"
			class="mc-toggle-btn"
			aria-pressed={visible}
			aria-label={visible ? 'Hide comments' : 'Show comments'}
			onclick={toggle}
		>
			{#if visible}
				<MessageSquare size={16} />
			{:else}
				<MessageSquareOff size={16} />
			{/if}
			{#if openCount}<span>{openCount}</span>{/if}
		</button>
		<!-- No hover on a touch screen: this opens the same menu. -->
		<button
			type="button"
			class="mc-toggle-more"
			aria-label="Comment settings"
			aria-expanded={menuOpen}
			onclick={() => (menuOpen = !menuOpen)}
		>
			⋯
		</button>

		{#if menuOpen}
			<div class="mc-menu" transition:fade={{ duration: 100 }}>
				<p class="mc-menu-hint">
					{#if !visible}
						Comments are hidden.
					{:else if config.canComment}
						Click a line or select text to comment.
					{:else}
						Log in to MdPubs to comment.
					{/if}
				</p>
				{#snippet choice(label: string, on: boolean, pick: () => void)}
					<button type="button" class="mc-choice" aria-pressed={on} onclick={pick}>{label}</button>
				{/snippet}
				<div class="mc-menu-row">
					<span>Writing</span>
					<div class="mc-seg">
						{@render choice('Handwritten', prefs.font === 'hand', () => setPref({ font: 'hand' }))}
						{@render choice('Plain', prefs.font === 'plain', () => setPref({ font: 'plain' }))}
					</div>
				</div>
				<div class="mc-menu-row">
					<span>Size</span>
					<div class="mc-seg">
						{@render choice('Small', prefs.size === 's', () => setPref({ size: 's' }))}
						{@render choice('Medium', prefs.size === 'm', () => setPref({ size: 'm' }))}
						{@render choice('Large', prefs.size === 'l', () => setPref({ size: 'l' }))}
					</div>
				</div>
				<div class="mc-menu-row">
					<span>Colour</span>
					<div class="mc-seg">
						{@render choice('Per person', prefs.colours, () => setPref({ colours: true }))}
						{@render choice('One ink', !prefs.colours, () => setPref({ colours: false }))}
					</div>
				</div>
				{#if people.length}
					<ul class="mc-legend" aria-label="Who commented">
						{#each people as person (person.id)}
							<li>
								<span
									class="mc-bullet"
									class:mc-hue={prefs.colours}
									style="--h:{person.hue}"
									aria-hidden="true"
								></span>
								<span class="mc-legend-name">{person.name}</span>
								<span class="mc-legend-count">{person.count}</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if visible && resolvedCount}
					<button type="button" class="mc-menu-link" onclick={() => (showResolved = !showResolved)}>
						{showResolved ? 'Hide' : 'Show'}
						{resolvedCount} resolved
					</button>
				{/if}
				<button type="button" class="mc-menu-link" onclick={toggle}>
					{visible ? 'Hide all comments' : 'Show comments'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.mc-root {
		--mc-tint: oklch(0.2 0.02 265 / 0.16);
		--mc-ink: var(--color-base-content);
		--mc-soft: color-mix(in oklch, var(--color-base-content) 45%, transparent);
	}
	.mc-layer {
		position: absolute;
		inset: 0;
		z-index: 10;
		pointer-events: none;
	}
	/* Each person's colour: one lightness and strength, only the hue differs.
	   Set on the element that carries --h (a var() is resolved where it is declared).
	   The fill is see-through, so the words under it keep their own colour. */
	.mc-hue {
		--mc-fill: oklch(0.78 0.15 var(--h) / 0.34);
		--mc-fill-on: oklch(0.74 0.17 var(--h) / 0.55);
		--mc-line: oklch(0.56 0.15 var(--h));
	}
	:global([data-theme='night']) .mc-root {
		--mc-tint: oklch(0 0 0 / 0.5);
	}
	:global([data-theme='night']) .mc-hue {
		--mc-fill: oklch(0.7 0.14 var(--h) / 0.36);
		--mc-fill-on: oklch(0.72 0.15 var(--h) / 0.55);
		--mc-line: oklch(0.8 0.12 var(--h));
	}
	.mc-svg .mc-highlight {
		stroke: none;
		fill: var(--mc-fill);
		transition: fill 150ms;
	}
	.mc-hl.mc-on .mc-highlight {
		fill: var(--mc-fill-on);
	}
	.mc-hl.mc-plain .mc-highlight {
		fill: color-mix(in oklch, var(--color-base-content) 14%, transparent);
	}
	.mc-mark:not(.mc-plain) {
		color: var(--mc-line);
	}
	.mc-author.mc-hue {
		color: var(--mc-line);
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
		animation: mc-draw 50ms ease-out forwards;
	}
	.mc-mark path:nth-child(2) {
		animation-duration: 180ms;
		animation-delay: 50ms;
	}
	.mc-mark path:nth-child(3) {
		animation-delay: 230ms;
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
	/* Each thread is a card: invisible at rest, a shade darker under the pointer,
	   so it is clear which comments belong together. */
	.mc-note {
		position: absolute;
		left: -0.5rem;
		width: calc(100% + 1rem);
		padding: 0.375rem 0.5rem;
		border-radius: 0.6rem;
		pointer-events: auto;
		transition:
			top 180ms ease,
			opacity 150ms;
	}
	.mc-note:hover,
	.mc-note.mc-on {
		background: color-mix(in oklch, var(--color-base-content) 5%, transparent);
	}
	.mc-resolved {
		opacity: 0.45;
	}
	.mc-entry + .mc-entry {
		margin-top: 0.625rem;
	}
	.mc-hand {
		font-family: 'Caveat', 'Bradley Hand', 'Segoe Print', cursive;
		font-weight: 500;
		font-size: var(--mc-hand-size);
		line-height: 1.12;
		color: color-mix(in oklch, var(--color-base-content) 82%, transparent);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	/* A long comment shows its first lines until "Read more" is pressed. */
	.mc-hand.mc-clamp {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
	}
	/* The last reply shown under the first comment is kept short. */
	.mc-note .mc-entry + .mc-more + .mc-entry .mc-hand,
	.mc-note .mc-entry + .mc-entry .mc-hand {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
	}
	.mc-hand.mc-clamp.mc-roomy {
		-webkit-line-clamp: 9;
		line-clamp: 9;
	}
	.mc-readmore {
		margin: 0;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.mc-readmore:hover {
		color: var(--mc-ink);
	}
	.mc-edit {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid #3c82f7;
		border-radius: 0.5rem;
		background: var(--color-base-100);
		color: var(--color-base-content);
		font-size: 0.875rem;
		line-height: 1.4;
		outline: none;
		resize: vertical;
	}
	.mc-edit-row {
		justify-content: flex-end;
		gap: 0 0.75rem;
	}
	.mc-save {
		color: var(--mc-ink);
		font-weight: 600;
	}
	.mc-save:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.mc-edit-error {
		color: var(--color-error);
	}
	.mc-earlier {
		margin-top: 0.25rem;
		padding-left: 0.6rem;
		border-left: 2px solid color-mix(in oklch, var(--color-base-content) 14%, transparent);
	}
	.mc-was {
		font-size: 0.8125rem;
		line-height: 1.4;
		color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.mc-more {
		margin: 0.375rem 0 0;
		cursor: pointer;
	}
	.mc-more:hover,
	.mc-open:hover {
		color: var(--mc-ink);
	}
	.mc-open {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* Catches the click that closes the pane. The tint itself is the spotlight's shadow. */
	.mc-drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
	}
	/* No place on the page to light up (the text was removed): tint it all. */
	.mc-dim {
		background: var(--mc-tint);
	}
	/* The part being discussed stays bright; its huge shadow tints everything else. */
	.mc-spot {
		position: absolute;
		left: -0.75rem;
		right: -0.75rem;
		z-index: 59;
		border-radius: 0.5rem;
		box-shadow: 0 0 0 200vmax var(--mc-tint);
		pointer-events: none;
	}
	.mc-drawer {
		position: fixed;
		inset: 0 0 0 auto;
		z-index: 61;
		display: flex;
		flex-direction: column;
		width: min(24rem, 100vw);
		background: var(--color-base-100);
		box-shadow: -8px 0 30px color-mix(in oklch, var(--color-base-content) 14%, transparent);
		animation: mc-slide 180ms ease-out;
	}
	@keyframes mc-slide {
		from {
			transform: translateX(100%);
		}
	}
	.mc-drawer-head {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 1rem 1.25rem 0.75rem;
		border-bottom: 1px solid color-mix(in oklch, var(--color-base-content) 8%, transparent);
	}
	.mc-close {
		color: var(--mc-soft);
		cursor: pointer;
	}
	.mc-close:hover {
		color: var(--mc-ink);
	}
	.mc-drawer-body {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1rem 1.25rem;
	}
	.mc-drawer-title {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--mc-ink);
	}
	/* In the drawer a thread reads like a conversation: a face, a name, the words. */
	.mc-turn {
		position: relative;
		display: flex;
		gap: 0.6rem;
		margin: 0 -0.5rem;
		padding: 0.5rem;
		border-radius: 0.6rem;
	}
	.mc-drawer .mc-entry + .mc-entry {
		margin-top: 0.25rem;
	}
	.mc-turn:global(.mc-flash) {
		animation: mc-flash 1.4s ease-out;
	}
	@keyframes mc-flash {
		from {
			background: color-mix(in oklch, var(--color-base-content) 12%, transparent);
		}
	}
	.mc-sheet .mc-turn {
		margin: 0;
		padding: 0.4rem 0;
	}
	.mc-turn:hover {
		background: color-mix(in oklch, var(--color-base-content) 5%, transparent);
	}
	/* The line that ties one comment to the next. */
	.mc-turn:not(:last-child)::before {
		content: '';
		position: absolute;
		left: calc(0.5rem + 0.8125rem);
		top: 2.4rem;
		bottom: -0.5rem;
		width: 1px;
		background: color-mix(in oklch, var(--color-base-content) 12%, transparent);
	}
	.mc-avatar {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.625rem;
		height: 1.625rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		color: var(--color-base-100);
		font-size: 0.75rem;
		font-weight: 600;
	}
	.mc-avatar.mc-hue {
		background: var(--mc-line);
	}
	.mc-turn .mc-entry-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.mc-turn .mc-meta {
		order: -1;
		margin: 0.15rem 0 0.15rem;
	}
	.mc-turn .mc-author {
		color: var(--mc-ink);
		font-weight: 600;
	}
	.mc-turn .mc-readmore,
	.mc-turn .mc-earlier {
		order: 1;
	}
	.mc-turn .mc-hand {
		font-family: inherit;
		font-weight: 400;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--mc-ink);
	}

	.mc-legend {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 9rem;
		overflow-y: auto;
		padding-top: 0.5rem;
		border-top: 1px solid color-mix(in oklch, var(--color-base-content) 8%, transparent);
	}
	.mc-legend li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.mc-bullet {
		flex: none;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--color-base-content) 55%, transparent);
	}
	.mc-bullet.mc-hue {
		background: var(--mc-line);
	}
	.mc-legend-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mc-legend-count {
		color: var(--mc-soft);
	}

	.mc-drawer-foot {
		padding: 0.5rem 1.25rem max(1rem, env(safe-area-inset-bottom));
		border-top: 1px solid color-mix(in oklch, var(--color-base-content) 8%, transparent);
	}
	.mc-drawer-foot .mc-actions {
		margin-bottom: 0.5rem;
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
	/* Edit and delete belong to one comment: they show for the comment under
	   the pointer only, not for every comment in the thread. */
	.mc-entry:hover .mc-act,
	.mc-entry:focus-within .mc-act,
	.mc-note.mc-on .mc-actions,
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
	}
	.mc-sheet {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 61;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 60vh;
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
		}
	}
	.mc-toggle-more {
		display: none;
		height: 2rem;
		padding: 0 0.35rem;
		color: var(--mc-soft);
		cursor: pointer;
	}
	@media (hover: none) {
		.mc-toggle-more {
			display: block;
		}
	}
	.mc-toggle-more:focus-visible {
		display: block;
	}
	.mc-menu {
		position: absolute;
		top: 100%;
		right: 0;
		width: 17rem;
		max-width: calc(100vw - 1.5rem);
		/* Padding, not margin, above the card: the pointer can cross to it without leaving. */
		margin-top: 0;
		padding: 0.75rem;
		border-radius: 0.75rem;
		background: var(--color-base-100);
		box-shadow:
			0 4px 20px color-mix(in oklch, var(--color-base-content) 12%, transparent),
			inset 0 0 0 1px color-mix(in oklch, var(--color-base-content) 8%, transparent);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: var(--mc-ink);
	}
	@media (max-width: 767px) {
		.mc-menu {
			top: auto;
			right: auto;
			left: 0;
			bottom: calc(100% + 0.4rem);
		}
	}
	.mc-menu-hint {
		color: var(--mc-soft);
	}
	.mc-menu-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.mc-seg {
		display: flex;
		padding: 2px;
		border-radius: 0.5rem;
		background: color-mix(in oklch, var(--color-base-content) 7%, transparent);
	}
	.mc-choice {
		padding: 0.2rem 0.5rem;
		border-radius: 0.4rem;
		color: var(--mc-soft);
		cursor: pointer;
	}
	.mc-choice[aria-pressed='true'] {
		background: var(--color-base-100);
		color: var(--mc-ink);
		box-shadow: 0 1px 2px color-mix(in oklch, var(--color-base-content) 18%, transparent);
	}
	.mc-menu-link {
		text-align: left;
		color: var(--mc-soft);
		cursor: pointer;
	}
	.mc-menu-link:hover {
		color: var(--mc-ink);
	}

	/* Reader's choices for the comment text. */
	.mc-root {
		--mc-hand-size: 1.3rem;
		--mc-plain-size: 0.875rem;
	}
	.mc-size-s {
		--mc-hand-size: 1.12rem;
		--mc-plain-size: 0.8125rem;
	}
	.mc-size-l {
		--mc-hand-size: 1.55rem;
		--mc-plain-size: 1rem;
	}
	.mc-font-plain .mc-hand {
		font-family: inherit;
		font-weight: 400;
		font-size: var(--mc-plain-size);
		line-height: 1.4;
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
