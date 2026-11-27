<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { onMount, tick, onDestroy, mount } from 'svelte';
	import {
		Menu,
		X,
		List,
		Maximize2,
		Minimize2,
		ChevronDown,
		ChevronUp,
		History
	} from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import { SvelteSet } from 'svelte/reactivity';
	import type { PageData } from './$types';
	import DiffView from '#lib/components/DiffView.svelte';
	import LinearProgress from '#lib/components/LinearProgress.svelte';
	import SignPanel from '#lib/components/SignPanel.svelte';
	import InlineSignBox from '#lib/components/InlineSignBox.svelte';
	import SignCertificate from '#lib/components/SignCertificate.svelte';
	import MarginComments from '#lib/components/comments/MarginComments.svelte';
	import HistoryPanel from '#lib/components/HistoryPanel.svelte';
	import PrintMenu, {
		DEFAULT_PRINT_SETTINGS,
		loadPrintSettings,
		type PrintSettings
	} from '#lib/components/PrintMenu.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { LiveRoom, personHue, type NoteEvent } from '#lib/live/room.svelte.js';
	import LivePresence from '#lib/live/LivePresence.svelte';
	import LiveMarks from '#lib/live/LiveMarks.svelte';

	type TocItem = {
		title: string;
		link: string;
		children: TocItem[];
	};

	let { data }: { data: PageData } = $props();

	let tocOpen = $state(false);
	let sidebarOpen = $state(true); // Desktop sidebar toggle
	let activeSection = $state('');
	// Headings the bold is passing through on its way to the new section.
	const tocPassing = new SvelteSet<string>();
	let tocWaveTimers: ReturnType<typeof setTimeout>[] = [];
	let scrollCleanup: (() => void) | null = null;
	let clickOutsideCleanup: (() => void) | null = null;
	let hashChangeCleanup: (() => void) | null = null;

	let articleElement = $state<HTMLElement | null>(null);
	// The "what changed?" panel (HistoryPanel).
	let historyOpen = $state(false);
	// What goes on paper. Saved per browser; applies to Ctrl+P too.
	let printSettings = $state<PrintSettings>({ ...DEFAULT_PRINT_SETTINGS });
	const onOff = (v: boolean) => (v ? 'on' : 'off');

	// Track mounted custom components for cleanup
	let mountedComponents: Array<{ unmount: () => void }> = [];

	// YouTube mini-player state
	let miniPlayerVideoId = $state<string | null>(null);
	let miniPlayerStartSeconds = $state(0);
	let miniPlayerMinimized = $state(false);
	let miniPlayerMaximized = $state(false);
	let ytLinkCleanup: (() => void) | null = null;

	function extractYoutubeInfo(url: string): { id: string; startSeconds: number } | null {
		const patterns = [
			/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
			/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
		];
		for (const pattern of patterns) {
			const match = url.match(pattern);
			if (match) {
				let startSeconds = 0;
				try {
					const parsed = new URL(url);
					const t = parsed.searchParams.get('t');
					if (t) startSeconds = parseInt(t, 10) || 0;
				} catch {
					/* ignore malformed URL */
				}
				return { id: match[1], startSeconds };
			}
		}
		return null;
	}

	function setupYoutubeLinks() {
		if (!articleElement) return;

		const handler = (e: MouseEvent) => {
			const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
			if (!link || !articleElement?.contains(link)) return;

			const href = link.getAttribute('href');
			if (!href) return;

			const info = extractYoutubeInfo(href);
			if (info) {
				e.preventDefault();
				miniPlayerVideoId = info.id;
				miniPlayerStartSeconds = info.startSeconds;
				miniPlayerMinimized = false;
			}
		};

		document.addEventListener('click', handler, true);
		ytLinkCleanup = () => document.removeEventListener('click', handler, true);
	}

	function closeMiniPlayer() {
		miniPlayerVideoId = null;
		miniPlayerStartSeconds = 0;
		miniPlayerMinimized = false;
		miniPlayerMaximized = false;
	}

	// Get note from server-loaded data
	let note = $derived(data.note);
	let versions = $derived(data.versions);
	let showDiffs = $derived(!!versions);
	let hasFootnotes = $derived(!!note?.html?.includes('data-footnotes'));

	// Raw HTML pubs render in a sandboxed iframe instead of {@html}.
	let isHtml = $derived(!!data.isHtml);
	let rawUrl = $derived(data.rawUrl);

	// Shared signing state across all sign surfaces (the FAB panel + inline boxes).
	// Any surface that records a signature calls onSignedShared, which updates this
	// and pushes the new state to every other surface — so the Sign count and boxes
	// stay in sync live, no page reload needed.
	let sharedSignState = $state(data.signState);
	let inlineSignBoxes: Array<{ refresh: (s: unknown) => void }> = [];
	let signPanelRef = $state<{ refresh: (s: unknown) => void } | null>(null);

	// Live room (src/lib/live): who else is here, comments and note changes as
	// they happen. Joined on mount; null when live is off or in the diff view.
	let live = $state<LiveRoom | null>(null);
	let marginComments = $state<{ reload: () => Promise<void> } | null>(null);
	/** "Updated by …" notice after the author saves a new version. */
	let updatedBy = $state<string | null>(null);
	let updatedTimer: ReturnType<typeof setTimeout> | null = null;
	let noteRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let lastNoteRefresh = 0;
	const NOTE_REFRESH_GAP_MS = 5000;

	/** Readers in each section, for the dots beside the contents. */
	let readersAt = $derived.by(() => {
		const at: Record<string, string[]> = {};
		for (const p of live?.others ?? []) {
			if (p.mode === 'reading' && p.s) (at[p.s] ??= []).push(p.u);
		}
		return at;
	});

	function sectionTitle(link: string): string | null {
		return (
			flattenToc(note?.toc as TocItem[] | undefined).find((i) => i.link === link)?.title ?? null
		);
	}

	function onNoteChanged(e: NoteEvent) {
		if (!e.silent) {
			updatedBy = e.by;
			if (updatedTimer) clearTimeout(updatedTimer);
			updatedTimer = setTimeout(() => (updatedBy = null), 5000);
		}
		// The editor autosaves every couple of seconds; fetch at most every few.
		if (noteRefreshTimer) return;
		const wait = Math.max(800, lastNoteRefresh + NOTE_REFRESH_GAP_MS - Date.now());
		noteRefreshTimer = setTimeout(refreshNote, wait);
	}

	async function refreshNote() {
		// Don't swap the text out from under someone selecting or typing a comment.
		const selecting = !(window.getSelection()?.isCollapsed ?? true);
		const typing = document.activeElement?.matches('textarea, input, [contenteditable="true"]');
		if (selecting || typing) {
			noteRefreshTimer = setTimeout(refreshNote, 3000);
			return;
		}
		noteRefreshTimer = null;
		lastNoteRefresh = Date.now();
		const before = note?.html;
		await invalidateAll();
		await tick();
		if (note?.html !== before) hydrateCustomComponents();
	}

	function onSignedShared(s: unknown) {
		sharedSignState = s as typeof sharedSignState;
		inlineSignBoxes.forEach((b) => b.refresh(s));
		signPanelRef?.refresh(s);
	}

	// Helper function to safely query elements by ID, handling IDs that start with numbers
	function safeQueryById(id: string): Element | null {
		// If ID starts with a number, use attribute selector instead
		if (/^\d/.test(id)) {
			return document.querySelector(`[id="${id}"]`);
		}
		return document.getElementById(id);
	}

	onMount(async () => {
		if (showDiffs) {
			return; // Don't setup scroll spy etc for diff view
		}
		printSettings = loadPrintSettings();
		// Capture phase on window, so this runs before SvelteKit's router (which
		// listens on <html>) can treat the superscript as an in-page link and
		// scroll to the note at the bottom. Attached right away, not after the
		// 200ms setup delay below, so an early click can't slip through either.
		window.addEventListener('click', onFootnoteClick, true);
		window.addEventListener('mousedown', onFootnoteMouseDown, true);

		if (data.live) {
			live = new LiveRoom(data.live.url, {
				onComments: () => marginComments?.reload(),
				onNote: onNoteChanged
			});
			live.connect();
		}

		// Wait for the DOM to update with the server-loaded content
		await tick();

		// Small delay to ensure @html content is fully rendered
		setTimeout(() => {
			setupSectionLinks();
			setupScrollSpy();
			setupClickOutside();
			hydrateCustomComponents();
			setupYoutubeLinks();

			// Set initial active section if none is set
			if (!activeSection && note?.toc?.length > 0) {
				moveActive(note.toc[0].link);
			}
		}, 200);
	});

	function hydrateCustomComponents() {
		if (!articleElement) {
			console.log('[DEBUG] No articleElement found');
			return;
		}

		console.log('[DEBUG] Article HTML:', articleElement.innerHTML.substring(0, 500));

		// Cleanup any previously mounted components
		mountedComponents.forEach((comp) => comp.unmount());
		mountedComponents = [];

		// Find all custom component placeholders
		const components = articleElement.querySelectorAll('[data-component="linear-progress"]');
		console.log('[DEBUG] Found', components.length, 'progress components');

		components.forEach((element, index) => {
			// Extract data attributes
			const value = parseFloat(element.getAttribute('data-value') || '0');
			const max = parseFloat(element.getAttribute('data-max') || '100');
			const label = element.getAttribute('data-label') || undefined;
			const color = element.getAttribute('data-color') || 'primary';
			const showPercentage = element.getAttribute('data-show-percentage') !== 'false';
			const showFraction = element.getAttribute('data-show-fraction') === 'true';

			console.log(`[DEBUG] Component ${index}:`, { value, max, label, color });

			// Mount Svelte 5 component using mount() API
			const component = mount(LinearProgress, {
				target: element,
				props: {
					value,
					max,
					label,
					color: color as 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error',
					showPercentage,
					showFraction
				}
			});

			// Store component reference for cleanup
			mountedComponents.push(component);
		});

		articleElement
			.querySelectorAll('[data-footnotes]')
			.forEach((section) => externalLinksInNewTab(section));

		// Mount inline sign boxes at <!-- mdpubs-sign-here --> anchors (now divs).
		inlineSignBoxes = [];
		if (sharedSignState?.enabled) {
			const anchors = articleElement.querySelectorAll('[data-mdpubs-sign-here]');
			anchors.forEach((element, index) => {
				const label = element.getAttribute('data-mdpubs-sign-here') || '';
				const box = mount(InlineSignBox, {
					target: element,
					props: {
						apiUrl: data.apiUrl,
						noteId: data.noteId,
						label,
						slotIndex: index,
						getState: () => sharedSignState,
						onSigned: onSignedShared
					}
				});
				mountedComponents.push(box as unknown as { unmount: () => void });
				inlineSignBoxes.push(box as unknown as { refresh: (s: unknown) => void });
			});
		}
	}

	function flattenToc(toc: TocItem[] | undefined): TocItem[] {
		const flattened: TocItem[] = [];
		function recurse(items: TocItem[]) {
			for (const item of items) {
				flattened.push(item);
				if (item.children && item.children.length > 0) {
					recurse(item.children);
				}
			}
		}
		if (toc) {
			recurse(toc);
		}
		return flattened;
	}

	function setupScrollSpy() {
		if (!note?.toc?.length) return;

		// Simple scroll listener - find section closest to top of viewport
		const handleScroll = () => {
			const isMobile = window.innerWidth < 1024;

			const offset = isMobile ? 60 : 20; // Account for mobile TOC button

			let activeId = null;
			let minDistance = Infinity;

			const allTocItems = flattenToc(note.toc as TocItem[] | undefined);

			// Check each TOC section
			allTocItems.forEach((item) => {
				const id = item.link.substring(1); // Remove #
				const element = safeQueryById(id);

				if (element) {
					const rect = element.getBoundingClientRect();
					const distance = Math.abs(rect.top - offset);

					// If this section is visible and closer to our target position
					if (rect.top <= offset + 100 && distance < minDistance) {
						minDistance = distance;
						activeId = item.link;
					}
				}
			});

			// Update active section if changed
			// While a TOC jump is scrolling, the spy would light every section the
			// page passes; the jump has already set the destination.
			if (Date.now() < suppressSpyHashUntil) return;
			// A section you jumped to stays current while its heading is on screen,
			// even if the page can't scroll it to the top (the last sections).
			if (pinnedSection) {
				const r = safeQueryById(pinnedSection.substring(1))?.getBoundingClientRect();
				if (r && r.top >= -1 && r.top < window.innerHeight) return;
				pinnedSection = '';
			}
			if (activeId && activeId !== activeSection) {
				moveActive(activeId);
				syncHash((activeId as string).substring(1));
			}
		};

		// Throttled scroll listener
		let ticking = false;
		const scrollListener = () => {
			if (!ticking) {
				requestAnimationFrame(() => {
					handleScroll();
					ticking = false;
				});
				ticking = true;
			}
		};

		window.addEventListener('scroll', scrollListener);

		// Initial check
		handleScroll();

		// Store cleanup function
		scrollCleanup = () => {
			window.removeEventListener('scroll', scrollListener);
		};
	}

	function setupClickOutside() {
		const handleClickOutside = (event) => {
			const isMobile = window.innerWidth < 1024;

			// Only handle on mobile and when TOC is open
			if (!isMobile || !tocOpen) return;

			// Find the mobile TOC container using data attribute
			const tocContainer = event.target.closest('[data-mobile-toc]');

			// If click is outside the TOC container, close the menu
			if (!tocContainer) {
				tocOpen = false;
			}
		};

		document.addEventListener('click', handleClickOutside);

		// Store cleanup function
		clickOutsideCleanup = () => {
			document.removeEventListener('click', handleClickOutside);
		};
	}

	onDestroy(() => {
		live?.close();
		if (noteRefreshTimer) clearTimeout(noteRefreshTimer);
		if (updatedTimer) clearTimeout(updatedTimer);
		if (scrollCleanup) {
			scrollCleanup();
		}
		if (clickOutsideCleanup) {
			clickOutsideCleanup();
		}
		if (hashChangeCleanup) {
			hashChangeCleanup();
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', onFootnoteClick, true);
			window.removeEventListener('mousedown', onFootnoteMouseDown, true);
		}
		if (ytLinkCleanup) {
			ytLinkCleanup();
		}
		// Cleanup mounted components
		mountedComponents.forEach((comp) => comp.unmount());
		mountedComponents = [];
	});

	function setupSectionLinks() {
		// Handle initial hash in URL after content loads
		if (window.location.hash) {
			scrollToSection(window.location.hash.substring(1));
		}

		// Add click event listeners for anchor links
		addSectionLinkHandlers();

		// Respond to the hash being changed outside our own navigation
		// (address bar edit, external link to the same page).
		const onHashChange = () => {
			const id = window.location.hash.substring(1);
			if (!id) return;
			moveActive(`#${id}`);
			scrollToSection(id);
		};
		window.addEventListener('hashchange', onHashChange);
		hashChangeCleanup = () => window.removeEventListener('hashchange', onHashChange);
	}

	// While a programmatic smooth scroll is in flight the scroll spy sees
	// intermediate sections, so it must not overwrite the target hash.
	let suppressSpyHashUntil = 0;
	let pinnedSection = '';

	// Reflect the current section in the URL without adding history entries or
	// triggering the browser's own jump-to-anchor behaviour.
	function syncHash(sectionId: string | null) {
		if (typeof window === 'undefined') return;
		const hash = sectionId ? `#${sectionId}` : '';
		if (window.location.hash === hash) return;
		const url = window.location.pathname + window.location.search + hash;
		window.history.replaceState(window.history.state, '', url);
	}

	function scrollToSection(sectionId: string) {
		const element = safeQueryById(sectionId);
		if (element) {
			suppressSpyHashUntil = Date.now() + 1000;
			pinnedSection = `#${sectionId}`;
			syncHash(sectionId);
		}

		if (element) {
			const isMobile = window.innerWidth < 1024;

			if (isMobile) {
				// Mobile: Calculate position with offset for TOC button
				const elementRect = element.getBoundingClientRect();
				const targetY = window.scrollY + elementRect.top - 60; // 60px for TOC button + padding

				window.scrollTo({
					top: Math.max(0, targetY),
					behavior: 'smooth'
				});
			} else {
				// Desktop: Standard scroll
				element.scrollIntoView({
					behavior: 'smooth',
					block: 'start'
				});
			}
		}
	}

	function addSectionLinkHandlers() {
		// Add event delegation for anchor links
		document.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;

			// Footnote superscripts are handled by onFootnoteClick (capture phase).
			if (footnote && !target.closest('[data-footnote-popover]')) footnote = null;

			// Check if clicked element is an anchor link or contains one
			const link = target.closest('a[href^="#"]') as HTMLAnchorElement;
			if (link) {
				e.preventDefault();
				const sectionId = link.getAttribute('href')?.substring(1);
				if (sectionId) {
					scrollToSection(sectionId);
				}
			}
		});
	}

	// Footnote popover. Positioned in page coordinates so it scrolls with the text.
	const FOOTNOTE_WIDTH = 352; // 22rem
	let footnote = $state<{ refId: string; html: string; top: number; left: number } | null>(null);

	function footnoteRefFrom(e: Event): HTMLAnchorElement | null {
		// The whole <sup> counts, padding included, not just the number.
		const t = e.target as HTMLElement | null;
		const ref = (t?.closest?.('a[data-footnote-ref]') ??
			t?.closest?.('sup')?.querySelector('a[data-footnote-ref]')) as HTMLAnchorElement | null;
		return ref && articleElement?.contains(ref) ? ref : null;
	}

	// A superscript never navigates. The first click opens its note; the extra
	// clicks of a double or triple click do nothing, so the note stays open.
	function onFootnoteClick(e: MouseEvent) {
		const ref = footnoteRefFrom(e);
		if (!ref) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.detail > 1) return;
		toggleFootnote(ref);
	}

	// Stop a double click selecting the number (which would open the comment box).
	function onFootnoteMouseDown(e: MouseEvent) {
		if (e.detail > 1 && footnoteRefFrom(e)) e.preventDefault();
	}

	function toggleFootnote(ref: HTMLAnchorElement) {
		if (footnote?.refId === ref.id) {
			footnote = null;
			return;
		}
		const item = safeQueryById(ref.getAttribute('href')?.slice(1) ?? '');
		if (!item) return;
		const copy = item.cloneNode(true) as HTMLElement;
		copy.querySelectorAll('[data-footnote-backref]').forEach((a) => a.remove());
		externalLinksInNewTab(copy);
		const rect = ref.getBoundingClientRect();
		const width = Math.min(FOOTNOTE_WIDTH, window.innerWidth - 32);
		const left = Math.min(
			Math.max(16, rect.left + rect.width / 2 - width / 2),
			window.innerWidth - width - 16
		);
		footnote = {
			refId: ref.id,
			html: copy.innerHTML,
			top: rect.bottom + window.scrollY + 6,
			left: left + window.scrollX
		};
	}

	// Links that leave the site open in a new tab.
	function externalLinksInNewTab(root: ParentNode) {
		root.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => {
			if (a.host === window.location.host) return;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
		});
	}

	function handleTocClick(link: string) {
		const sectionId = link.substring(1);
		moveActive(link);
		scrollToSection(sectionId);
		tocOpen = false; // Close mobile TOC after clicking
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	// Change the current section. The bold "flies" from the old heading to the
	// new one: each heading in between lights up briefly in turn, like sequins
	// flipping, while the letters sweep left to right (see .toc-label CSS).
	function moveActive(next: string) {
		const prev = activeSection;
		if (next === prev) return;
		activeSection = next;
		live?.setSection(next);

		tocWaveTimers.forEach(clearTimeout);
		tocWaveTimers = [];
		tocPassing.clear();
		if (!prev || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const links = flattenToc(note?.toc as TocItem[] | undefined).map((i) => i.link);
		const from = links.indexOf(prev);
		const to = links.indexOf(next);
		if (from < 0 || to < 0 || Math.abs(to - from) < 2) return;

		const dir = to > from ? 1 : -1;
		const between: string[] = [];
		for (let i = from + dir; i !== to; i += dir) between.push(links[i]);
		// The whole trip takes about 320ms however far it goes.
		const gap = Math.min(55, 320 / between.length);
		const hold = 130;
		between.forEach((link, k) => {
			tocWaveTimers.push(
				setTimeout(() => tocPassing.add(link), k * gap),
				setTimeout(() => tocPassing.delete(link), k * gap + hold)
			);
		});
	}
</script>

<svelte:head>
	<title>{data.meta.title} | MdPubs</title>
	<meta name="description" content={data.meta.description} />

	<!-- Search engine indexing control -->
	<meta name="robots" content={data.meta.allowIndexing ? 'index, follow' : 'noindex, nofollow'} />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="article" />
	<meta property="og:url" content={data.meta.url} />
	<meta property="og:title" content={data.meta.title} />
	<meta property="og:description" content={data.meta.description} />
	<meta property="og:image" content={data.meta.ogImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:site_name" content="MdPubs" />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:url" content={data.meta.url} />
	<meta name="twitter:title" content={data.meta.title} />
	<meta name="twitter:description" content={data.meta.description} />
	<meta name="twitter:image" content={data.meta.ogImage} />
</svelte:head>

{#snippet tocItems(items: TocItem[], level = 0, isMobile = false)}
	{#each items as item (item.link)}
		{@const lit = activeSection === item.link || tocPassing.has(item.link)}
		<button
			onclick={() => handleTocClick(item.link)}
			class="toc-item block w-full rounded-md px-3 py-1.5 text-left text-sm"
			class:toc-lit={lit}
			class:toc-passing={lit && activeSection !== item.link}
			aria-current={activeSection === item.link ? 'location' : undefined}
			style="padding-left: {0.75 + level * 0.75}rem"
		>
			<!-- Each letter is its own span so the bold can sweep across it. -->
			<span
				class="toc-label"
				aria-label={item.title}
				style="--step: {Math.min(14, 220 / Math.max(1, item.title.length))}ms"
				><span aria-hidden="true" class="toc-chars"
					>{#each [...item.title] as ch, i (i)}<span style="--i: {i}">{ch}</span>{/each}</span
				></span
			>
			{#if readersAt[item.link]}
				<span
					class="ml-1.5 inline-flex gap-0.5 align-middle"
					title="{readersAt[item.link].length} reading here"
				>
					{#each readersAt[item.link].slice(0, 3) as u (u)}
						<span class="live-dot size-1.5 rounded-full" style="--hue: {personHue(u)}"></span>
					{/each}
				</span>
			{/if}
		</button>
		{#if item.children?.length > 0}
			{@render tocItems(item.children, level + 1, isMobile)}
		{/if}
	{/each}
{/snippet}

<svelte:window onkeydown={(e) => e.key === 'Escape' && (footnote = null)} />

{#if updatedBy}
	<div
		class="fixed top-3 left-1/2 z-50 -translate-x-1/2 rounded-full bg-base-content px-4 py-1.5 text-sm text-base-100 shadow-lg print:hidden"
		role="status"
		data-comments-ignore
		transition:fade={{ duration: 150 }}
	>
		{updatedBy} just updated this note
	</div>
{/if}

<!-- Footnote popover, opened by clicking a footnote number in the text. -->
{#if footnote}
	<div
		class="footnote-popover absolute z-50 max-h-72 overflow-y-auto rounded-lg bg-base-100 px-4 py-3 text-sm leading-relaxed text-base-content shadow-lg ring-1 ring-base-content/10 print:hidden"
		style="top: {footnote.top}px; left: {footnote.left}px; width: min({FOOTNOTE_WIDTH}px, calc(100vw - 32px))"
		role="note"
		data-footnote-popover
		data-comments-ignore
		transition:fade={{ duration: 100 }}
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html footnote.html}
	</div>
{/if}

{#snippet printTocList(items: TocItem[])}
	<ol>
		{#each items as item (item.link)}
			<li>
				{item.title}
				{#if item.children?.length > 0}
					{@render printTocList(item.children)}
				{/if}
			</li>
		{/each}
	</ol>
{/snippet}

<!-- YouTube Mini Player -->
{#if miniPlayerVideoId}
	<div
		class="fixed z-50 overflow-hidden rounded-xl bg-black shadow-2xl transition-all duration-300 {miniPlayerMaximized
			? 'inset-4'
			: miniPlayerMinimized
				? 'bottom-4 right-4 w-64'
				: 'bottom-4 right-4 w-80'}"
		transition:fade={{ duration: 150 }}
	>
		<!-- Header bar -->
		<div class="flex items-center justify-between bg-gray-900 px-3 py-2">
			<span class="truncate text-xs font-medium text-white">YouTube</span>
			<div class="flex items-center gap-1">
				<button
					onclick={() => (miniPlayerMinimized = !miniPlayerMinimized)}
					class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
					title={miniPlayerMinimized ? 'Expand' : 'Minimize'}
				>
					{#if miniPlayerMinimized}
						<ChevronUp class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</button>
				<button
					onclick={() => {
						miniPlayerMaximized = !miniPlayerMaximized;
						if (miniPlayerMaximized) miniPlayerMinimized = false;
					}}
					class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
					title={miniPlayerMaximized ? 'Exit fullscreen' : 'Fullscreen'}
				>
					{#if miniPlayerMaximized}
						<Minimize2 class="h-4 w-4" />
					{:else}
						<Maximize2 class="h-4 w-4" />
					{/if}
				</button>
				<button
					onclick={closeMiniPlayer}
					class="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
					title="Close"
				>
					<X class="h-4 w-4" />
				</button>
			</div>
		</div>
		<!-- Video iframe -->
		{#if !miniPlayerMinimized}
			<div class="{miniPlayerMaximized ? 'h-[calc(100%-40px)]' : 'aspect-video'} w-full">
				<iframe
					src="https://www.youtube.com/embed/{miniPlayerVideoId}?autoplay=1&rel=0{miniPlayerStartSeconds
						? `&start=${miniPlayerStartSeconds}`
						: ''}"
					title="YouTube video"
					frameborder="0"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowfullscreen
					class="h-full w-full"
				></iframe>
			</div>
		{/if}
	</div>
{/if}

{#if isHtml && rawUrl && !showDiffs}
	<!-- Fullscreen HTML pub: the document fills the viewport so it feels like a
	     real site. Rendered in a fully sandboxed iframe (no scripts, no
	     same-origin) served by the API with a strict CSP. A small floating badge
	     keeps attribution and a way back to mdpubs. -->
	<div class="fixed inset-0 h-screen w-screen overflow-hidden bg-base-100">
		<iframe
			src={rawUrl}
			title={note?.title || 'Document'}
			sandbox="allow-popups allow-popups-to-escape-sandbox"
			referrerpolicy="no-referrer"
			class="h-full w-full border-0"
		></iframe>
		<!-- Floating controls (hidden when printing the wrapper). Stacked vertically
		     on mobile, horizontal row from sm up. -->
		<div
			class="fixed right-3 bottom-3 z-50 flex flex-col items-end gap-2 sm:flex-row sm:items-center print:hidden"
		>
			<!-- E-signing: shown only when the pub opts in via mdpubs-sign. The panel
			     bundles Sign + Download PDF + Audit trail. The PDF button opens the
			     raw doc with ?print=1 (own @page CSS) since the iframe is sandboxed. -->
			{#if data.signState?.enabled}
				<SignPanel
					bind:this={signPanelRef}
					apiUrl={data.apiUrl}
					noteId={data.noteId}
					initialState={data.signState}
					pdfUrl={`${rawUrl}?print=1`}
					onSigned={onSignedShared}
				/>
			{:else}
				<!-- Non-signable HTML pub: keep the standalone Print / Save PDF link. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={`${rawUrl}?print=1`}
					target="_blank"
					rel="noopener"
					class="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-lg ring-1 ring-gray-200 transition-colors hover:text-gray-900"
					title="Open the document in a new tab and print or save as PDF"
				>
					Print / Save PDF
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			<!-- Omitted on org custom domains (whitelabelled), same as the footer below. -->
			{#if !data.isCustomDomain}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a
					href="https://mdpubs.com"
					target="_blank"
					rel="noopener"
					class="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-lg ring-1 ring-gray-200 transition-colors hover:text-gray-900"
				>
					Hosted on MdPubs
				</a>
			{/if}
		</div>
	</div>
{:else}
	<!-- overflow-x-clip (not -hidden) contains wide content horizontally WITHOUT
	     establishing a scroll container, so `position: sticky` on the desktop TOC
	     sidebar below keeps working. overflow-x-hidden would break it. -->
	<div
		class="min-h-screen overflow-x-clip"
		data-print-root
		data-print-header={onOff(printSettings.header)}
		data-print-toc={onOff(printSettings.toc)}
		data-print-footnotes={onOff(printSettings.footnotes)}
		data-print-links={onOff(printSettings.links)}
		data-print-smart={onOff(printSettings.smartBreaks)}
		data-print-sections={onOff(printSettings.sectionBreaks)}
	>
		{#if showDiffs}
			<div class="mx-auto max-w-4xl px-6 py-6 lg:py-12">
				<header class="mb-8">
					{#if note?.frontmatter?.title}
						<h1 class="text-2xl leading-tight font-bold text-base-content lg:text-4xl">
							Version history for: {note.frontmatter.title}
						</h1>
					{/if}
					{#if note}
						<a
							href={resolve('/(public)/[id]', { id: note.publicId })}
							class="text-sm text-primary hover:underline"
						>
							&larr; Back to note
						</a>
					{/if}
				</header>

				{#if versions && versions.length > 0}
					<div class="space-y-12">
						{#each versions as version (version.id)}
							<div>
								<div class="mb-2 flex items-center gap-4 text-sm text-base-content/60">
									<div class="font-bold">Version {version.version}</div>
									<p class="text-xs text-base-content/60">
										{new Date(version.createdAt).toLocaleString('en-US', {
											year: 'numeric',
											month: 'long',
											day: 'numeric',
											hour: 'numeric',
											minute: 'numeric'
										})}
									</p>
								</div>
								<DiffView diff={version.diff} />
							</div>
						{/each}
					</div>
				{:else if versions}
					<p>No version history found for this note.</p>
				{:else}
					<p>Error loading version history.</p>
				{/if}
			</div>
		{:else}
			<!-- Main Content -->
			{#if note}
				<div class="flex min-h-screen">
					<!-- TOC Sidebar for Desktop -->
					{#if note?.toc?.length > 0}
						<aside class="relative hidden w-64 flex-shrink-0 lg:block">
							<!-- Expandable TOC Button/Container -->
							<div class="sticky top-6 z-20 ml-2">
								<!-- One eased motion: the width and the list's height animate
								     together; the list fades in once there's room for it. The
								     inner pieces keep a fixed width so text is clipped, never
								     rewrapped, while the box resizes. -->
								<div
									class="toc-panel overflow-hidden rounded-md bg-base-100"
									class:toc-open={sidebarOpen}
								>
									<button
										onclick={toggleSidebar}
										class="toc-head flex w-64 items-center p-3 hover:bg-base-200"
										aria-expanded={sidebarOpen}
										title="{sidebarOpen ? 'Hide' : 'Show'} table of contents"
									>
										<span class="relative mr-2 h-5 w-5 flex-shrink-0 text-base-content/70">
											<X class="toc-icon-x absolute inset-0 h-5 w-5" />
											<List class="toc-icon-list absolute inset-0 h-5 w-5" />
										</span>
										<span
											class="toc-title text-sm font-semibold tracking-wide whitespace-nowrap text-base-content uppercase"
										>
											Table of Contents
										</span>
									</button>
									<div class="toc-body grid">
										<div class="min-h-0 overflow-hidden">
											<div
												class="toc-list max-h-[calc(100vh-8rem)] w-64 overflow-y-auto p-4"
												inert={!sidebarOpen}
											>
												<nav class="space-y-0.5">
													{@render tocItems(note.toc as TocItem[], 0, false)}
												</nav>
											</div>
										</div>
									</div>
								</div>
							</div>
						</aside>
					{/if}

					<!-- Main Content Area. min-w-0: a flex item never shrinks below its
					     widest child by default, so one wide table or <pre> pushed the
					     whole page past the phone's edge. -->
					<div class="@container min-w-0 flex-1">
						<!-- Mobile TOC Button -->
						{#if note?.toc?.length > 0}
							<div
								class="sticky top-0 z-40 border-b border-base-300 bg-base-100 lg:hidden"
								data-mobile-toc
							>
								<div class="px-6 py-3">
									<button
										onclick={(event) => {
											event.stopPropagation();
											tocOpen = !tocOpen;
										}}
										class="flex items-center text-sm font-medium text-base-content/80 hover:text-base-content"
									>
										{#if tocOpen}
											<X class="mr-2 h-4 w-4" />
										{:else}
											<Menu class="mr-2 h-4 w-4" />
										{/if}
										Table of Contents
									</button>
								</div>
							</div>

							<!-- Mobile TOC Dropdown -->
							{#if tocOpen}
								<div
									class="sticky top-[50px] z-30 border-b border-base-300 bg-base-100 shadow-sm lg:hidden"
									data-mobile-toc
								>
									<nav class="max-h-64 overflow-y-auto px-6 py-4">
										{@render tocItems(note.toc as TocItem[], 0, true)}
									</nav>
								</div>
							{/if}
						{/if}

						<!-- Hero Image -->
						{#if note?.frontmatter?.['mdpubs-hero-image'] && note?.frontmatter?.['mdpubs-hero-title']}
							<div
								class="relative flex h-80 items-end bg-cover bg-center"
								style="background-image: url('{note.frontmatter['mdpubs-hero-image']}')"
							>
								<div
									class="w-full bg-gradient-to-t from-black/80 to-transparent px-6 pt-24 pb-6 lg:px-8 lg:pt-32 lg:pb-8"
								>
									<h1
										class="m-auto line-clamp-2 max-w-4xl text-3xl leading-snug font-extrabold text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.8)] lg:text-5xl lg:leading-tight"
									>
										{note.frontmatter['mdpubs-hero-title']}
									</h1>
								</div>
							</div>
						{/if}

						<!-- A note with comments keeps the notes margin (18rem) clear on the
						     right whenever there is room, whether comments are showing or
						     hidden, so toggling them never moves the text. -->
						<div
							class="mx-auto max-w-4xl px-6 py-6 lg:py-12 {data.comments?.enabled
								? '@min-[60rem]:max-w-[74rem] @min-[60rem]:pr-[19.5rem]'
								: ''} print:max-w-none print:pr-0"
							data-comments-zone
						>
							<!-- Header -->
							<header class="mb-8" data-print-part="header">
								{#if !(note?.frontmatter?.['mdpubs-hero-image'] && note?.frontmatter?.['mdpubs-hero-title']) && note?.frontmatter?.title}
									<h1 class="text-2xl leading-tight font-bold text-base-content lg:text-4xl">
										{note.frontmatter.title}
									</h1>
								{/if}

								{#if !note?.frontmatter?.['mdpubs-hide-meta']}
									{#if !(note?.frontmatter?.['mdpubs-hero-image'] && note?.frontmatter?.['mdpubs-hero-title']) && note?.frontmatter?.description}
										<p class="leading-relaxed text-base-content/70 lg:text-xl">
											{note?.frontmatter?.description}
										</p>
									{/if}

									{@const rawDate = note?.frontmatter?.date ?? note.updatedAt}
									{@const parsedDate = rawDate ? new Date(rawDate) : null}
									{#if parsedDate && !isNaN(parsedDate.getTime())}
										<div class="mt-2 flex items-center text-xs text-base-content/60 md:text-sm">
											<time datetime={parsedDate.toISOString()}>
												{parsedDate.toLocaleDateString('en-US', {
													year: 'numeric',
													month: 'long',
													day: 'numeric'
												})}
											</time>
										</div>
									{/if}
									<!-- Divider -->
									<div class="mb-8 border-t border-base-300"></div>
								{/if}
							</header>

							<!-- Paper-only table of contents: on screen it lives in the sidebar. -->
							{#if note?.toc?.length > 0}
								<nav class="print-toc hidden print:block" data-print-part="toc">
									<div class="print-toc-title">Contents</div>
									{@render printTocList(note.toc as TocItem[])}
								</nav>
							{/if}

							<!-- Content (markdown pubs; HTML pubs render fullscreen above). The
							     relative box is what the comments layer is drawn over. -->
							<div class="relative">
								<article
									class="prose min-h-[80vh] max-w-none overflow-x-hidden text-base-content [overflow-wrap:anywhere] [--tw-prose-body:var(--color-base-content)] [--tw-prose-headings:var(--color-base-content)] [--tw-prose-bold:var(--color-base-content)] [--tw-prose-links:var(--color-primary)] [--tw-prose-quotes:var(--color-base-content)] [--tw-prose-code:var(--color-base-content)] [--tw-prose-captions:var(--color-base-content)] [--tw-prose-counters:var(--color-base-content)] [--tw-prose-bullets:var(--color-base-content)] [--tw-prose-hr:var(--color-base-300)] [--tw-prose-quote-borders:var(--color-base-300)] [--tw-prose-th-borders:var(--color-base-300)] [--tw-prose-td-borders:var(--color-base-300)] [&_pre]:border [&_pre]:border-base-300 [&_pre]:bg-base-200 [&_pre]:text-base-content [&_pre_code]:bg-transparent [&_pre_code]:text-base-content [&_code]:[overflow-wrap:anywhere] [&_img]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:normal] [&_table]:block [&_table]:w-max [&_table]:min-w-full [&_table]:max-w-full [&_table]:overflow-x-auto [&_th]:[overflow-wrap:normal] [&_td]:[overflow-wrap:normal] [&_th]:whitespace-normal [&_td]:whitespace-normal"
									bind:this={articleElement}
								>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html note.html}
								</article>
								{#if live}
									<LiveMarks article={articleElement} html={note.html} room={live} />
								{/if}
								{#snippet pageTools()}
									{#if live}
										<LivePresence room={live} {sectionTitle} />
									{/if}
									<PrintMenu
										bind:settings={printSettings}
										hasToc={note?.toc?.length > 0}
										{hasFootnotes}
									/>
									{#if data.history}
										{@render historyButton()}
									{/if}
								{/snippet}
								{#snippet historyButton()}
									<button
										type="button"
										class="inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-full bg-base-100/85 px-2 text-base-content/70 ring-1 ring-base-content/10 backdrop-blur ring-inset hover:text-base-content"
										aria-label="History: see what changed"
										data-tip="History: see what changed"
										aria-pressed={historyOpen}
										data-history-button
										onclick={() => (historyOpen = !historyOpen)}
									>
										<History size={16} />
									</button>
								{/snippet}
								{#if data.comments?.enabled}
									{#key data.noteId}
										<MarginComments
											bind:this={marginComments}
											article={articleElement}
											html={note.html}
											noteId={data.noteId}
											apiUrl={data.apiUrl}
											initial={data.comments}
											embedToken={data.embed?.token}
											tools={pageTools}
										/>
									{/key}
								{:else}
									<!-- No comments on this note: the buttons stand alone in the same
									     corner (top right; bottom left on a phone). -->
									<div
										class="fixed top-2 right-14 z-50 flex gap-1.5 max-md:top-auto max-md:right-auto max-md:bottom-3 max-md:left-3 print:hidden"
										data-comments-ignore
									>
										{@render pageTools()}
									</div>
								{/if}
								{#if data.history}
									{#key data.noteId}
										<HistoryPanel
											article={articleElement}
											noteId={data.noteId}
											apiUrl={data.apiUrl}
											embedToken={data.embed?.token}
											bind:open={historyOpen}
										/>
									{/key}
								{/if}
							</div>

							<!-- Footer — omitted on org custom domains (whitelabelled) -->
							{#if !data.isCustomDomain}
								<footer class="mt-32 border-t border-base-300 pt-8 print:hidden lg:pb-0 pb-12">
									<!-- The whole block is one link; the logo takes the muted text colour
									     and darkens with it on hover. -->
									<a
										href="https://mdpubs.com"
										class="group mx-auto flex w-fit flex-col items-center gap-1.5 text-base-content/55 transition-colors hover:text-base-content/85"
										aria-label="Published with MdPubs: prompt it, publish it, share the link"
									>
										<span class="flex items-center gap-2 text-xs">
											Published with
											<Logo class="h-7 w-auto text-base-content/75 group-hover:text-base-content" />
										</span>
										<span class="text-xs text-base-content/45 group-hover:text-base-content/65">
											Prompt it. Publish it. Share the link.
										</span>
									</a>
								</footer>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<!-- Signing for markdown pubs: the HTML-pub branch has its own control in the
     floating toolbar, so only render this for the markdown view. -->
{#if !isHtml && !showDiffs && data.signState?.enabled}
	<div class="fixed right-3 bottom-3 z-50 print:hidden">
		<SignPanel
			bind:this={signPanelRef}
			apiUrl={data.apiUrl}
			noteId={data.noteId}
			initialState={data.signState}
			onSigned={onSignedShared}
		/>
	</div>
	<!-- Print-only Certificate of Completion, appended after the document when
	     saving/printing to PDF (hidden on screen). -->
	<SignCertificate
		apiUrl={data.apiUrl}
		noteId={data.noteId}
		title={note?.frontmatter?.title || note?.title || 'Document'}
		initialState={data.signState}
	/>
{/if}

<style>
	.live-dot {
		background: hsl(var(--hue) 55% 48%);
	}
	/* KaTeX display math ($$...$$) can be wider than the column on small
	   screens; scroll it instead of overflowing the page. */
	:global(.prose .katex-display) {
		overflow-x: auto;
		overflow-y: hidden;
		padding: 0.25rem 0;
	}

	/* ---------------------------------------------------------------------------
	   Print / Save-as-PDF styles for markdown pubs.
	   (Raw HTML pubs print via their own sandboxed ?print=1 route, not this page.)

	   Goals:
	   - Professional, consistent page margins.
	   - Text is never split across a page boundary mid-line: paragraphs keep a
	     minimum of lines together (orphans/widows), and atomic blocks (headings +
	     their content, images, tables, code, blockquotes, list items) are kept
	     whole where a page break would otherwise cut through them.
	   - Screen-only chrome (sticky sidebar/TOC, min-heights, scroll containers)
	     is neutralised so content reflows naturally onto printed pages.

	   `.prose` content is injected via {@html}, so those rules use :global().
	--------------------------------------------------------------------------- */
	@media print {
		/* Tight but professional page margin around every printed page. */
		@page {
			margin: 0.4in 0.45in;
		}

		/* Let content flow: drop screen-only min-heights and scroll clipping that
		   would otherwise trap content in a single viewport-tall box. */
		:global(.min-h-screen) {
			min-height: 0 !important;
		}
		:global(article.prose) {
			min-height: 0 !important;
			overflow: visible !important;
			max-width: none !important;
		}

		/* The screen content wrapper adds its own gutters/vertical rhythm on top of
		   the @page margin; drop it so the printed margin is the only whitespace. */
		:global(.max-w-4xl) {
			max-width: none !important;
			padding-left: 0 !important;
			padding-right: 0 !important;
			padding-top: 0 !important;
			padding-bottom: 0 !important;
		}

		/* The desktop TOC sidebar and mobile TOC bars are navigation, not content. */
		:global(aside),
		:global([data-mobile-toc]) {
			display: none !important;
		}

		/* Keep the whole document readable in black on white regardless of theme,
		   and ask the browser to preserve intentional backgrounds (code blocks). */
		:global(html),
		:global(body) {
			background: #fff !important;
		}
		:global(*) {
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		/* ---- Smart page breaks (print menu; on by default) ----------------- */

		/* Don't strand one or two lines of a paragraph on their own page. */
		:global([data-print-smart='on'] .prose p),
		:global([data-print-smart='on'] .prose li),
		:global([data-print-smart='on'] .prose blockquote) {
			orphans: 3;
			widows: 3;
		}

		/* Never break in the middle of an atomic block. */
		:global([data-print-smart='on'] .prose figure),
		:global([data-print-smart='on'] .prose img),
		:global([data-print-smart='on'] .prose video),
		:global([data-print-smart='on'] .prose svg),
		:global([data-print-smart='on'] .prose table),
		:global([data-print-smart='on'] .prose li),
		:global([data-print-smart='on'] .prose tr),
		:global([data-print-smart='on'] .prose .katex-display) {
			break-inside: avoid;
			page-break-inside: avoid; /* legacy alias for older print engines */
		}

		/* ...except blocks that can be taller than a page: keeping them whole
		   would push them past the page end and clip them. */
		:global([data-print-smart='on'] .prose pre),
		:global([data-print-smart='on'] .prose blockquote),
		:global([data-print-smart='on'] .prose table) {
			break-inside: auto;
			page-break-inside: auto;
		}

		/* A heading never sits alone at the foot of a page. break-after: avoid
		   is the standard way, but browsers drop it when the next block is
		   itself unbreakable. Belt and braces: an invisible box under each
		   heading reserves ~4 lines and is part of the heading's unbreakable
		   box, so if those lines don't fit, the heading moves to the next page.
		   flow-root stops the negative margin collapsing into the next block. */
		:global([data-print-smart='on'] .prose :is(h1, h2, h3, h4, h5, h6)) {
			display: flow-root;
			break-inside: avoid;
			page-break-inside: avoid;
			break-after: avoid;
			page-break-after: avoid;
		}
		:global([data-print-smart='on'] .prose :is(h1, h2, h3, h4, h5, h6)::after) {
			content: '';
			display: block;
			height: 6rem;
			margin-bottom: -6rem;
		}

		/* ---- New page per section ------------------------------------------ */
		:global([data-print-sections='on'] .prose h2:not(:first-child)),
		:global([data-print-sections='on'] .prose h1:not(:first-child)) {
			break-before: page;
			page-break-before: always;
		}
		/* The footnotes' own (hidden) h2 must not trigger a page. */
		:global([data-print-sections='on'] .prose section[data-footnotes] h2) {
			break-before: auto;
			page-break-before: auto;
		}

		/* ---- What to include ------------------------------------------------ */
		:global([data-print-header='off'] [data-print-part='header']),
		:global([data-print-toc='off'] [data-print-part='toc']),
		:global([data-print-footnotes='off'] .prose section[data-footnotes]),
		:global([data-print-footnotes='off'] .prose sup:has(> a[data-footnote-ref])) {
			display: none !important;
		}

		/* Link addresses: paper can't be clicked, so print where a link goes.
		   Only real web links; not in-page anchors or footnote numbers. */
		:global([data-print-links='on'] .prose a[href^='http']:not([data-footnote-ref])::after) {
			content: ' (' attr(href) ')';
			font-size: 0.8em;
			font-weight: 400;
			overflow-wrap: anywhere;
			color: #555;
		}

		/* Paper-only table of contents. */
		:global(.print-toc) {
			margin: 0 0 2rem;
			padding-bottom: 1.25rem;
			border-bottom: 1px solid #ddd;
			break-inside: avoid;
		}
		:global(.print-toc-title) {
			font-size: 0.75rem;
			font-weight: 600;
			letter-spacing: 0.05em;
			text-transform: uppercase;
			color: #666;
			margin-bottom: 0.75rem;
		}
		:global(.print-toc ol) {
			list-style: none;
			margin: 0;
			padding: 0;
		}
		:global(.print-toc ol ol) {
			padding-left: 1.25rem;
		}
		:global(.print-toc li) {
			margin: 0.2rem 0;
			font-size: 0.95rem;
		}
		:global(.print-toc > ol > li) {
			font-weight: 600;
		}
		:global(.print-toc ol ol li) {
			font-weight: 400;
		}

		/* Footnote numbers print as plain superscripts; the hairline stays. */
		:global(.prose section[data-footnotes]) {
			break-inside: auto;
		}

		/* Images must never overflow the printable width. */
		:global(.prose img),
		:global(.prose svg),
		:global(.prose video),
		:global(.prose canvas) {
			max-width: 100% !important;
			height: auto !important;
		}

		/* On screen the table is a horizontally-scrollable block sized to its
		   content (`display:block; width:max-content`). Paper has no scrollbar,
		   so anything past the printable width is simply cut off. Put tables back
		   into normal table layout, constrained to the page width, and let cells
		   wrap. `table-layout: fixed` distributes columns evenly instead of
		   letting one long cell blow out the width. */
		:global(.prose table) {
			display: table !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
			table-layout: fixed !important;
			overflow: visible !important;
		}
		:global(.prose thead),
		:global(.prose tbody),
		:global(.prose tfoot),
		:global(.prose tr) {
			max-width: 100% !important;
		}
		:global(.prose th),
		:global(.prose td) {
			white-space: normal !important;
			overflow-wrap: anywhere !important;
			word-break: break-word !important;
			max-width: 100% !important;
		}
		/* Any wrapper the renderer put around a wide table/figure. */
		:global(.prose figure),
		:global(.prose .table-wrapper),
		:global(.prose [class*='overflow-x']) {
			overflow: visible !important;
			max-width: 100% !important;
			width: auto !important;
		}

		/* Same problem for code blocks: wrap instead of clipping the right edge. */
		:global(.prose pre) {
			max-width: 100% !important;
			overflow: visible !important;
			white-space: pre-wrap !important;
			overflow-wrap: anywhere !important;
			word-break: break-word !important;
		}
		:global(.prose pre code) {
			white-space: pre-wrap !important;
			overflow-wrap: anywhere !important;
		}

		/* A tall table can legitimately need more than one page; forcing it whole
		   would otherwise push it off the end. Repeat the header on each page. */
		:global(.prose table) {
			break-inside: auto;
			page-break-inside: auto;
		}
		:global(.prose thead) {
			display: table-header-group;
		}
	}

	/* ---- Table of contents ------------------------------------------------ */
	/* Sidebar open/close. --toc-ease is an ease-out-quint: fast start, soft landing. */
	.toc-panel {
		--toc-ease: cubic-bezier(0.22, 1, 0.36, 1);
		width: 3rem;
		transition: width 320ms var(--toc-ease);
	}
	.toc-panel.toc-open {
		width: 16rem;
	}
	.toc-head {
		border-bottom: 1px solid transparent;
		transition:
			border-color 200ms,
			background-color 150ms;
	}
	.toc-open .toc-head {
		border-color: var(--color-base-300);
	}
	.toc-title {
		opacity: 0;
		transition: opacity 150ms;
	}
	.toc-open .toc-title {
		opacity: 1;
		transition-delay: 120ms;
	}
	:global(.toc-icon-x),
	:global(.toc-icon-list) {
		transition:
			opacity 200ms,
			transform 320ms var(--toc-ease);
	}
	:global(.toc-panel:not(.toc-open) .toc-icon-x),
	:global(.toc-open .toc-icon-list) {
		opacity: 0;
		transform: rotate(-90deg) scale(0.6);
	}
	.toc-body {
		grid-template-rows: 0fr;
		transition: grid-template-rows 320ms var(--toc-ease);
	}
	.toc-open .toc-body {
		grid-template-rows: 1fr;
	}
	.toc-list {
		opacity: 0;
		transform: translateY(-4px);
		transition:
			opacity 150ms,
			transform 320ms var(--toc-ease);
	}
	.toc-open .toc-list {
		opacity: 1;
		transform: none;
		transition-delay: 100ms;
	}

	/* Items: no tint, no border. The current one is just dark and bold. */
	/* Tailwind 4 gives buttons the default arrow; these are links in spirit. */
	:global(.toc-item),
	.toc-head {
		cursor: pointer;
	}
	:global(.toc-item) {
		color: color-mix(in oklch, var(--color-base-content) 58%, transparent);
		transition: color 200ms;
	}
	:global(.toc-item:hover) {
		color: var(--color-base-content);
	}
	:global(.toc-item.toc-lit) {
		color: var(--color-base-content);
	}
	/* The sweep: each letter thickens a little after the one before it, both
	   when the bold arrives and when it leaves, so it travels through the word.
	   The bold is a text stroke, not font-weight: it changes no widths (so lines
	   never rewrap mid-sweep) and animates smoothly in any font. */
	:global(.toc-chars > span) {
		-webkit-text-stroke: 0 currentColor;
		transition: -webkit-text-stroke-width 160ms ease-out;
		transition-delay: calc(var(--i) * var(--step));
	}
	:global(.toc-lit .toc-chars > span) {
		-webkit-text-stroke-width: 0.55px;
	}
	/* Headings the bold only passes through sweep faster. */
	:global(.toc-passing .toc-chars > span) {
		transition-duration: 90ms;
		transition-delay: calc(var(--i) * var(--step) * 0.35);
	}
	@media (prefers-reduced-motion: reduce) {
		.toc-panel,
		.toc-body,
		.toc-list,
		.toc-title,
		:global(.toc-icon-x),
		:global(.toc-icon-list),
		:global(.toc-chars > span) {
			transition: none !important;
		}
	}

	/* Footnotes: the list at the end of the note, and the popover. */
	/* Quiet, like a book: a short hairline, small muted text, tiny numbers
	   hanging in the margin, and the whole note is the link back up. */
	:global(.prose section[data-footnotes]) {
		margin-top: 4rem;
		padding-top: 0;
	}
	:global(.prose section[data-footnotes]::before) {
		content: '';
		display: block;
		width: 3.125rem;
		height: 1px;
		background: var(--color-base-300);
	}
	:global(.prose section[data-footnotes] ol) {
		list-style: none;
		counter-reset: fn;
		margin: 0;
		padding: 2rem 0 0 0.35rem;
	}
	:global(.prose section[data-footnotes] li) {
		position: relative;
		counter-increment: fn;
		margin: 0;
		padding: 0 0 0.75rem 0.3rem;
		color: color-mix(in oklch, var(--color-base-content) 55%, transparent);
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	:global(.prose section[data-footnotes] li::before) {
		content: counter(fn);
		position: absolute;
		right: 100%;
		top: 0.1rem;
		font-size: 0.55rem;
		line-height: 1;
	}
	:global(.prose section[data-footnotes] li::marker) {
		content: none;
	}
	:global(.prose section[data-footnotes] li p) {
		margin: 0;
	}
	:global(.prose section[data-footnotes] li a:not([data-footnote-backref])) {
		position: relative;
		z-index: 2;
	}
	:global(.prose section[data-footnotes] a[data-footnote-backref]) {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		text-indent: -9999px;
	}
	:global(.prose section[data-footnotes] a:not([data-footnote-backref])),
	:global(.footnote-popover a) {
		/* A plain blue; lighter on the dark theme (rule below). Not light-dark():
		   the production CSS build rewrites it into variables nothing sets. */
		--fn-link: oklch(0.52 0.2 258);
		color: var(--fn-link);
		font-weight: inherit;
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-decoration-color: color-mix(in oklch, var(--fn-link) 50%, transparent);
		text-underline-offset: 2px;
	}
	:global([data-theme='night'] .prose section[data-footnotes] a:not([data-footnote-backref])),
	:global([data-theme='night'] .footnote-popover a) {
		--fn-link: oklch(0.74 0.14 250);
	}
	:global(.prose section[data-footnotes] a:not([data-footnote-backref]):hover),
	:global(.footnote-popover a:hover) {
		text-decoration-color: var(--fn-link);
	}
	:global(.prose section[data-footnotes] code) {
		font-size: inherit;
		color: inherit;
	}
	:global(.prose sup:has(> a[data-footnote-ref])) {
		cursor: pointer;
		user-select: none;
		display: inline-block;
		padding-left: 0.2em;
		font-size: 0.65em;
		line-height: 1;
		color: color-mix(in oklch, var(--color-base-content) 50%, transparent);
	}
	:global(.prose section[data-footnotes] .sr-only),
	:global(.footnote-popover .sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	:global(.prose a[data-footnote-ref]) {
		color: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	:global(.prose a[data-footnote-ref]:hover) {
		color: var(--color-base-content);
	}
	:global(.footnote-popover p) {
		margin: 0;
	}
	:global(.footnote-popover p + p) {
		margin-top: 0.5rem;
	}
	:global(.footnote-popover a) {
		overflow-wrap: anywhere;
	}

	/* A label the moment the pointer is on an icon button: no wait, unlike title="". */
	:global([data-tip]) {
		position: relative;
	}
	@media (hover: hover) {
		:global([data-tip]:hover::after) {
			content: attr(data-tip);
			position: absolute;
			top: calc(100% + 6px);
			right: 0;
			z-index: 60;
			padding: 0.15rem 0.5rem;
			border-radius: 0.4rem;
			background: var(--color-base-content);
			color: var(--color-base-100);
			font-size: 0.75rem;
			font-weight: 500;
			line-height: 1.4;
			white-space: nowrap;
			pointer-events: none;
		}
	}
	@media (hover: hover) and (max-width: 767px) {
		:global([data-tip]:hover::after) {
			top: auto;
			right: auto;
			left: 0;
			bottom: calc(100% + 6px);
		}
	}
</style>
