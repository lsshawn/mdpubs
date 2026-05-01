<script lang="ts">
	import { onMount, tick, onDestroy, mount, unmount } from 'svelte';
	import { Menu, X, List, Maximize2, Minimize2, ChevronDown, ChevronUp } from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import type { PageData } from './$types';
	import DiffView from '$lib/components/DiffView.svelte';
	import LinearProgress from '$lib/components/LinearProgress.svelte';
	import { config } from '$lib/config';

	type TocItem = {
		title: string;
		link: string;
		children: TocItem[];
	};

	let { data }: { data: PageData } = $props();

	let tocOpen = $state(false);
	let sidebarOpen = $state(true); // Desktop sidebar toggle
	let tocContentVisible = $state(true); // Controls TOC content visibility with delay
	let activeSection = $state('');
	let scrollCleanup: (() => void) | null = null;
	let clickOutsideCleanup: (() => void) | null = null;

	// State for quoting
	let quoteButtonVisible = $state(false);
	let quoteButtonPosition = $state({ top: 0, left: 0 });
	let articleElement: HTMLElement | null = null;
	let quoteListenersCleanup: (() => void) | null = null;
	let activeQuote: {
		text: string;
		elementId: string;
		startPath: number[];
		startOffset: number;
		endPath: number[];
		endOffset: number;
	} | null = $state(null);

	// Restore saved name on mount
	onMount(() => {
		try {
			const saved = localStorage.getItem('mdpubs:commenter-name');
			if (saved) newAuthorName = saved;
		} catch {}
	});

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
				} catch {}
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

	// State for discussion sidebar
	type CommentAnchor = {
		elementId: string;
		startPath: number[];
		startOffset: number;
		endPath: number[];
		endOffset: number;
		quotedText: string;
	};
	type Comment = {
		id: number;
		authorName: string;
		content: string;
		anchor: CommentAnchor;
		createdAt: string | number | Date;
	};

	let newCommentText = $state('');
	let newAuthorName = $state('');
	let honeypotWebsite = $state('');
	let submitting = $state(false);
	let submitError = $state<string | null>(null);
	let mobileSheetOpen = $state(false);
	let mobileSheetFocusId = $state<number | null>(null);
	let comments = $state<Comment[]>((data.comments as Comment[]) || []);
	let commentsEnabled = $derived(data.commentsEnabled !== false);

	function formatTimestamp(ts: string | number | Date): string {
		const d = new Date(ts);
		const diff = Date.now() - d.getTime();
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		return d.toLocaleDateString();
	}

	// Get note from server-loaded data
	let note = $derived(data.note);
	let versions = $derived(data.versions);
	let showDiffs = $derived(!!versions);

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
				activeSection = note.toc[0].link;
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
					color: color as any,
					showPercentage,
					showFraction
				}
			});

			// Store component reference for cleanup
			mountedComponents.push(component);
		});
	}

	$effect(() => {
		if (showDiffs || !note?.html || !articleElement) {
			// Cleanup listeners if we are in diff view or note is gone
			if (quoteListenersCleanup) {
				quoteListenersCleanup();
				quoteListenersCleanup = null;
			}
			return;
		}

		if (config.featureFlags.discussionSidebar) {
			// After DOM updates from note.html change, re-apply highlights
			tick().then(reapplyHighlights);

			// Setup quoting functionality if not already present
			if (!quoteListenersCleanup) {
				document.addEventListener('mouseup', handleTextSelection);
				quoteListenersCleanup = () => {
					document.removeEventListener('mouseup', handleTextSelection);
				};
			}
		}
	});

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
			if (activeId && activeId !== activeSection) {
				activeSection = activeId;
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
		if (scrollCleanup) {
			scrollCleanup();
		}
		if (clickOutsideCleanup) {
			clickOutsideCleanup();
		}
		if (quoteListenersCleanup) {
			quoteListenersCleanup();
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
	}

	function scrollToSection(sectionId: string) {
		const element = safeQueryById(sectionId);

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

	function handleTocClick(link: string) {
		const sectionId = link.substring(1);
		// Update active section immediately
		activeSection = link;
		scrollToSection(sectionId);
		tocOpen = false; // Close mobile TOC after clicking
	}

	function toggleSidebar() {
		if (sidebarOpen) {
			// Closing: hide content first, then collapse container
			tocContentVisible = false;
			setTimeout(() => {
				sidebarOpen = false;
			}, 150);
		} else {
			// Opening: expand container first, then show content
			sidebarOpen = true;
			setTimeout(() => {
				tocContentVisible = true;
			}, 150);
		}
	}

	async function submitComment() {
		submitError = null;
		if (!activeQuote) {
			submitError = 'Select some text first to anchor your comment.';
			return;
		}
		if (!newCommentText.trim()) {
			submitError = 'Write something.';
			return;
		}
		if (!newAuthorName.trim()) {
			submitError = 'Add your name.';
			return;
		}
		if (!note?.id) return;

		submitting = true;
		try {
			const res = await fetch(`${config.apiUrl}/notes/${note.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					authorName: newAuthorName.trim().slice(0, 60),
					content: newCommentText.trim().slice(0, 2000),
					website: honeypotWebsite,
					anchor: {
						elementId: activeQuote.elementId,
						startPath: activeQuote.startPath,
						startOffset: activeQuote.startOffset,
						endPath: activeQuote.endPath,
						endOffset: activeQuote.endOffset,
						quotedText: activeQuote.text
					}
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				submitError = err?.error || 'Failed to post comment.';
				return;
			}
			const created = (await res.json()) as Comment;
			comments = [created, ...comments];
			try {
				localStorage.setItem('mdpubs:commenter-name', newAuthorName.trim());
			} catch {}
			newCommentText = '';
			activeQuote = null;
		} catch (e) {
			console.error(e);
			submitError = 'Network error.';
		} finally {
			submitting = false;
		}
	}

	function handleTextSelection(event: MouseEvent) {
		// Don't trigger if clicking on the quote button itself
		if ((event.target as HTMLElement).closest('[data-quote-button]')) {
			return;
		}

		// Use a small timeout to allow the selection to clear on simple clicks
		setTimeout(() => {
			const selection = window.getSelection();
			// Check if there is a selection, it's not collapsed, and it's within our article
			if (
				selection &&
				!selection.isCollapsed &&
				selection.rangeCount > 0 &&
				articleElement?.contains(selection.anchorNode)
			) {
				const range = selection.getRangeAt(0);
				const rect = range.getBoundingClientRect();

				quoteButtonPosition = {
					top: window.scrollY + rect.top - 45, // Position above selection
					left: window.scrollX + rect.left + rect.width / 2 - 25 // Center button
				};
				quoteButtonVisible = true;
			} else {
				quoteButtonVisible = false;
			}
		}, 10);
	}

	function getPathTo(node: Node, root: Node): number[] | null {
		if (node === root) return [];
		if (!root.contains(node)) return null;
		const path = [];
		let current = node;
		while (current !== root) {
			const parent = current.parentNode;
			if (!parent) return null;
			const siblings = Array.from(parent.childNodes);
			const index = siblings.indexOf(current as ChildNode);
			path.unshift(index);
			current = parent;
		}
		return path;
	}

	function getNodeByPath(path: number[], root: Node): Node | null {
		let current = root;
		for (const index of path) {
			if (!current.childNodes[index]) return null;
			current = current.childNodes[index];
		}
		return current;
	}

	function findRangeByText(quotedText: string, root: HTMLElement): Range | null {
		if (!quotedText) return null;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const txt = node.nodeValue || '';
			const idx = txt.indexOf(quotedText);
			if (idx !== -1) {
				const range = document.createRange();
				range.setStart(node, idx);
				range.setEnd(node, idx + quotedText.length);
				return range;
			}
		}
		return null;
	}

	// Wrap every text-node slice that intersects `range` in its own <mark>.
	// Works across block boundaries (multiple paragraphs, list items, etc.)
	// where extractContents() would otherwise fail.
	function wrapRangeWithMarks(
		range: Range,
		root: HTMLElement,
		makeMark: () => HTMLElement
	): HTMLElement[] {
		const startContainer = range.startContainer;
		const endContainer = range.endContainer;
		const startOffset = range.startOffset;
		const endOffset = range.endOffset;

		const textNodes: Text[] = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
			acceptNode: (n) =>
				range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
		});
		let n: Node | null;
		while ((n = walker.nextNode())) textNodes.push(n as Text);

		const marks: HTMLElement[] = [];
		for (const textNode of textNodes) {
			const text = textNode.nodeValue ?? '';
			if (!text.length) continue;

			const from = textNode === startContainer ? startOffset : 0;
			const to = textNode === endContainer ? endOffset : text.length;
			if (to <= from) continue;

			// Split the text node so the middle chunk is the exact selection.
			let target: Text = textNode;
			if (from > 0) target = target.splitText(from);
			if (to - from < target.nodeValue!.length) target.splitText(to - from);

			const mark = makeMark();
			target.parentNode?.insertBefore(mark, target);
			mark.appendChild(target);
			marks.push(mark);
		}
		return marks;
	}

	function reapplyHighlights() {
		if (!articleElement) return;
		const root = articleElement;
		comments.forEach((comment) => {
			const anchor = comment.anchor;
			if (!anchor || document.getElementById(anchor.elementId)) return;

			let range: Range | null = null;
			const startNode = getNodeByPath(anchor.startPath, root);
			const endNode = getNodeByPath(anchor.endPath, root);

			if (startNode && endNode) {
				try {
					range = document.createRange();
					range.setStart(startNode, anchor.startOffset);
					range.setEnd(endNode, anchor.endOffset);
					if (range.collapsed) range = null;
				} catch {
					range = null;
				}
			}
			if (!range) {
				range = findRangeByText(anchor.quotedText, root);
			}
			if (!range) return;

			try {
				const marks = wrapRangeWithMarks(range, root, () => {
					const m = document.createElement('mark');
					m.dataset.commentId = String(comment.id);
					m.className = 'mdpubs-comment-mark';
					m.addEventListener('click', (e) => {
						e.stopPropagation();
						openThread(comment.id);
					});
					return m;
				});
				if (marks.length > 0) {
					marks[0].id = anchor.elementId;
				}
			} catch (e) {
				console.error('Failed to re-apply highlight:', e);
			}
		});
	}

	function openThread(commentId: number) {
		mobileSheetFocusId = commentId;
		const isMobile = window.matchMedia('(max-width: 1023px)').matches;
		if (isMobile) {
			mobileSheetOpen = true;
		} else {
			// On desktop: scroll the rail card into view + flash
			const card = document.querySelector(`[data-comment-card="${commentId}"]`);
			if (card) {
				card.scrollIntoView({ behavior: 'smooth', block: 'center' });
				card.classList.add('flash-animation');
				setTimeout(() => card.classList.remove('flash-animation'), 1500);
			}
		}
	}

	function quoteSelection() {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return;

		const range = selection.getRangeAt(0);
		if (!articleElement?.contains(range.commonAncestorContainer)) return;

		const selectedText = selection.toString();
		const highlightId = `quote-highlight-${Date.now()}`;

		const startPath = getPathTo(range.startContainer, articleElement);
		const endPath = getPathTo(range.endContainer, articleElement);

		if (!startPath || !endPath) {
			console.error('Could not determine path for selection.');
			return;
		}

		// Capture offsets BEFORE wrapping (DOM mutation invalidates the range)
		const savedStartOffset = range.startOffset;
		const savedEndOffset = range.endOffset;

		try {
			const marks = wrapRangeWithMarks(range, articleElement, () => {
				const m = document.createElement('mark');
				m.className = 'mdpubs-comment-mark';
				return m;
			});
			if (marks.length === 0) return;
			marks[0].id = highlightId;

			activeQuote = {
				text: selectedText,
				elementId: highlightId,
				startPath: startPath,
				startOffset: savedStartOffset,
				endPath: endPath,
				endOffset: savedEndOffset
			};

			const commentBox = document.querySelector('textarea');
			if (commentBox) (commentBox as HTMLTextAreaElement).focus();
		} catch (e) {
			console.error('Could not wrap selection.', e);
		} finally {
			selection.removeAllRanges();
			quoteButtonVisible = false;
		}
	}

	function scrollToQuote(elementId: string) {
		const element = document.getElementById(elementId);
		if (element) {
			element.scrollIntoView({ behavior: 'smooth', block: 'center' });

			// Add a temporary animation to make it flash
			element.classList.add('flash-animation');
			setTimeout(() => {
				element.classList.remove('flash-animation');
			}, 1500); // duration of the animation
		}
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

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:url" content={data.meta.url} />
	<meta name="twitter:title" content={data.meta.title} />
	<meta name="twitter:description" content={data.meta.description} />
	<meta name="twitter:image" content={data.meta.ogImage} />
</svelte:head>

{#snippet tocItems(items: TocItem[], level = 0, isMobile = false)}
	{#each items as item}
		<button
			onclick={() => handleTocClick(item.link)}
			class="block w-full px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-gray-100 {isMobile
				? 'rounded-md'
				: 'rounded-none'} {activeSection === item.link
				? 'bg-blue-50 text-blue-700'
				: 'text-gray-600 hover:text-gray-900'} {activeSection === item.link && !isMobile
				? 'border-r-2 border-blue-600'
				: ''}"
			style="padding-left: {0.75 + level * 0.75}rem"
		>
			{item.title}
		</button>
		{#if item.children?.length > 0}
			{@render tocItems(item.children, level + 1, isMobile)}
		{/if}
	{/each}
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
					src="https://www.youtube.com/embed/{miniPlayerVideoId}?autoplay=1&rel=0{miniPlayerStartSeconds ? `&start=${miniPlayerStartSeconds}` : ''}"
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

<div class="min-h-screen overflow-x-hidden" data-theme="light">
	{#if showDiffs}
		<div class="mx-auto max-w-4xl px-6 py-6 lg:py-12">
			<header class="mb-8">
				{#if note?.frontmatter?.title}
					<h1 class="text-2xl leading-tight font-bold text-gray-900 lg:text-4xl">
						Version history for: {note.frontmatter.title}
					</h1>
				{/if}
				{#if note}
					<a href="/{note.id}" class="text-sm text-blue-600 hover:underline">
						&larr; Back to note
					</a>
				{/if}
			</header>

			{#if versions && versions.length > 0}
				<div class="space-y-12">
					{#each versions as version (version.id)}
						<div>
							<div class="mb-2 flex items-center gap-4 text-sm text-gray-500">
								<div class="font-bold">Version {version.version}</div>
								<p class="text-xs text-gray-500">
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
			<!-- Quote Button Popover -->
			{#if quoteButtonVisible}
				<div
					style="top: {quoteButtonPosition.top}px; left: {quoteButtonPosition.left}px;"
					class="absolute z-50"
					data-quote-button
					transition:fade={{ duration: 150 }}
				>
					<button
						class="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-lg hover:bg-gray-100"
						onclick={quoteSelection}
					>
						Quote
					</button>
				</div>
			{/if}

			<div class="flex min-h-screen">
				<!-- TOC Sidebar for Desktop -->
				{#if note?.toc?.length > 0}
					<aside class="relative hidden w-64 flex-shrink-0 lg:block">
						<!-- Expandable TOC Button/Container -->
						<div class="sticky top-6 z-20 ml-2">
							<div
								class="overflow-hidden rounded-md bg-white shadow-none ring-0 ring-gray-200 transition-all duration-100 ease-in-out {sidebarOpen
									? 'w-64 '
									: 'h-12 w-12'}"
							>
								<!-- Toggle Button Header -->
								<button
									onclick={toggleSidebar}
									class="flex w-full items-center p-3 transition-colors duration-200 hover:bg-gray-50 {sidebarOpen
										? 'border-b border-gray-200'
										: ''}"
									title="{sidebarOpen ? 'Hide' : 'Show'} table of contents"
								>
									{#if sidebarOpen}
										<X class="mr-2 h-5 w-5 flex-shrink-0 text-gray-600" />
										<span class="text-sm font-semibold tracking-wide text-gray-900 uppercase">
											Table of Contents
										</span>
									{:else}
										<List class="h-5 w-5 text-gray-600" />
									{/if}
								</button>

								<!-- TOC Content (hidden when collapsed) -->
								{#if sidebarOpen}
									<div class="max-h-[calc(100vh-8rem)] overflow-y-auto p-4">
										{#if tocContentVisible}
											<nav class="space-y-1" transition:fade={{ duration: 200 }}>
												{@render tocItems(note.toc as TocItem[], 0, false)}
											</nav>
										{/if}
									</div>
								{/if}
							</div>
						</div>
					</aside>
				{/if}

				<!-- Main Content Area -->
				<div class="flex-1">
					<!-- Mobile TOC Button -->
					{#if note?.toc?.length > 0}
						<div
							class="sticky top-0 z-40 border-b border-gray-200 bg-white lg:hidden"
							data-mobile-toc
						>
							<div class="px-6 py-3">
								<button
									onclick={(event) => {
										event.stopPropagation();
										tocOpen = !tocOpen;
									}}
									class="flex items-center text-sm font-medium text-gray-700 hover:text-gray-900"
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
								class="sticky top-[50px] z-30 border-b border-gray-200 bg-white shadow-sm lg:hidden"
								data-mobile-toc
							>
								<nav class="max-h-64 overflow-y-auto px-6 py-4">
									{@render tocItems(note.toc as TocItem[], 0, true)}
								</nav>
							</div>
						{/if}
					{/if}

					<!-- Hero Image -->
					{#if note.frontmatter['mdpubs-hero-image'] && note.frontmatter['mdpubs-hero-title']}
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

					<div class="mx-auto max-w-4xl px-6 py-6 lg:py-12">
						<!-- Header -->
						<header class="mb-8">
							{#if !(note.frontmatter['mdpubs-hero-image'] && note.frontmatter['mdpubs-hero-title']) && note?.frontmatter?.title}
								<h1 class="text-2xl leading-tight font-bold text-gray-900 lg:text-4xl">
									{note.frontmatter.title}
								</h1>
							{/if}

							{#if !note.frontmatter?.['mdpubs-hide-meta']}
								{#if !(note.frontmatter['mdpubs-hero-image'] && note.frontmatter['mdpubs-hero-title']) && note?.frontmatter?.description}
									<p class="leading-relaxed text-gray-600 lg:text-xl">
										{note?.frontmatter?.description}
									</p>
								{/if}

								{#if note.updatedAt}
									<div class="mt-2 flex items-center text-xs text-gray-500 md:text-sm">
										<time datetime={note.updatedAt}>
											{new Date(note.updatedAt).toLocaleDateString('en-US', {
												year: 'numeric',
												month: 'long',
												day: 'numeric'
											})}
										</time>
									</div>
								{/if}
								<!-- Divider -->
								<div class="mb-8 border-t border-gray-200"></div>
							{/if}
						</header>

						<!-- Content -->
						<article
								class="prose prose-sm min-h-[80vh] max-w-none overflow-x-hidden break-words [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full"
								bind:this={articleElement}
							>
							{@html note.html}
						</article>

						<!-- Footer -->
						<footer class="mt-32 border-t border-gray-200 pt-8">
							<div class="flex flex-col items-center justify-center text-gray-500">
								<a
									href="http://mdpubs.com"
									class="inline-flex items-center text-sm text-gray-500 underline transition-colors hover:text-gray-700"
								>
									<span class="mr-2">📝</span>
									Powered by {config.name}
								</a>
								<div class="mt-1 text-xs">{config.description}</div>
							</div>
						</footer>
					</div>
				</div>

				<!-- Discussion Sidebar (desktop margin column) -->
				{#if config.featureFlags.discussionSidebar && commentsEnabled}
					<aside class="hidden w-80 flex-shrink-0 border-l border-gray-200 lg:block">
						<div class="sticky top-0 flex h-screen flex-col">
							<div class="flex-shrink-0 border-b border-gray-200 p-4">
								<h3 class="text-lg font-semibold text-gray-900">
									Comments
									{#if comments.length > 0}
										<span class="ml-1 text-sm font-normal text-gray-500">({comments.length})</span>
									{/if}
								</h3>
								<p class="mt-1 text-xs text-gray-500">
									Highlight any text to leave an anchored comment.
								</p>
							</div>

							<div class="flex-1 overflow-y-auto p-4">
								{#if comments.length === 0}
									<p class="text-sm text-gray-400">Be the first to comment.</p>
								{:else}
									<div class="space-y-6">
										{#each comments as comment (comment.id)}
											<div
												class="rounded-md border border-gray-100 p-3 transition-colors hover:border-gray-200"
												data-comment-card={comment.id}
											>
												<div class="flex items-baseline justify-between">
													<p class="text-sm font-medium text-gray-900">{comment.authorName}</p>
													<p class="text-xs text-gray-400">{formatTimestamp(comment.createdAt)}</p>
												</div>

												{#if comment.anchor?.quotedText}
													<button
														onclick={() => scrollToQuote(comment.anchor.elementId)}
														class="my-2 block w-full rounded-md border-l-4 border-gray-300 bg-gray-50 p-2 text-left text-xs text-gray-600 hover:bg-gray-100"
													>
														<blockquote class="line-clamp-2 italic">
															"{comment.anchor.quotedText}"
														</blockquote>
													</button>
												{/if}

												<p class="text-sm whitespace-pre-wrap text-gray-700">{comment.content}</p>
											</div>
										{/each}
									</div>
								{/if}
							</div>

							<!-- Compose -->
							<div class="flex-shrink-0 border-t border-gray-200 p-4">
								{#if activeQuote}
									<div
										class="mb-2 rounded-md border-l-4 border-blue-400 bg-blue-50 p-2 text-sm text-blue-800"
									>
										<div class="flex items-center justify-between gap-2">
											<p class="line-clamp-2 italic">Quoting: "{activeQuote.text}"</p>
											<button
												onclick={() => (activeQuote = null)}
												class="rounded-full p-1 hover:bg-blue-200"
												title="Cancel quote"
											>
												<X class="h-4 w-4" />
											</button>
										</div>
									</div>
								{:else}
									<p class="mb-2 text-xs text-gray-500">
										Highlight text in the article to anchor your comment.
									</p>
								{/if}
								<input
									bind:value={newAuthorName}
									type="text"
									maxlength="60"
									class="mb-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
									placeholder="Your name"
								/>
								<!-- honeypot, hidden from users -->
								<input
									bind:value={honeypotWebsite}
									type="text"
									tabindex="-1"
									autocomplete="off"
									aria-hidden="true"
									style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
								/>
								<textarea
									bind:value={newCommentText}
									rows="3"
									maxlength="2000"
									disabled={!activeQuote}
									class="w-full rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
									placeholder={activeQuote ? 'Add your comment…' : 'Select text first'}
									onkeydown={(e) => {
										if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
											e.preventDefault();
											submitComment();
										}
									}}
								></textarea>
								{#if submitError}
									<p class="mt-1 text-xs text-red-600">{submitError}</p>
								{/if}
								<div class="mt-2 flex items-center justify-between">
									<p class="text-xs text-gray-500">Cmd+Enter to send</p>
									<button
										onclick={submitComment}
										disabled={submitting || !activeQuote || !newCommentText.trim() || !newAuthorName.trim()}
										class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
									>
										{submitting ? 'Posting…' : 'Comment'}
									</button>
								</div>
							</div>
						</div>
					</aside>
				{/if}

				<!-- Mobile: floating button + bottom sheet -->
				{#if config.featureFlags.discussionSidebar && commentsEnabled}
					<button
						onclick={() => {
							mobileSheetFocusId = null;
							mobileSheetOpen = true;
						}}
						class="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg lg:hidden"
						aria-label="Open comments"
					>
						💬
						{#if comments.length > 0}
							<span>{comments.length}</span>
						{/if}
					</button>

					{#if mobileSheetOpen}
						<div
							class="fixed inset-0 z-50 lg:hidden"
							role="dialog"
							aria-modal="true"
							aria-label="Comments"
						>
							<button
								class="absolute inset-0 bg-black/40"
								onclick={() => (mobileSheetOpen = false)}
								aria-label="Close comments"
							></button>
							<div
								class="absolute right-0 bottom-0 left-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl"
								transition:fade={{ duration: 150 }}
							>
								<div class="flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
									<h3 class="text-base font-semibold text-gray-900">
										Comments
										{#if comments.length > 0}
											<span class="ml-1 text-sm font-normal text-gray-500">({comments.length})</span>
										{/if}
									</h3>
									<button
										onclick={() => (mobileSheetOpen = false)}
										class="rounded-full p-1 hover:bg-gray-100"
										aria-label="Close"
									>
										<X class="h-5 w-5" />
									</button>
								</div>

								<div class="flex-1 overflow-y-auto px-4 py-3">
									{#if comments.length === 0}
										<p class="text-sm text-gray-400">No comments yet. Highlight some text in the article to add one.</p>
									{:else}
										<div class="space-y-4">
											{#each (mobileSheetFocusId ? comments.filter((c) => c.id === mobileSheetFocusId) : comments) as comment (comment.id)}
												<div class="rounded-md border border-gray-100 p-3">
													<div class="flex items-baseline justify-between">
														<p class="text-sm font-medium text-gray-900">{comment.authorName}</p>
														<p class="text-xs text-gray-400">{formatTimestamp(comment.createdAt)}</p>
													</div>
													{#if comment.anchor?.quotedText}
														<blockquote class="my-2 line-clamp-3 rounded-md border-l-4 border-gray-300 bg-gray-50 p-2 text-xs text-gray-600 italic">
															"{comment.anchor.quotedText}"
														</blockquote>
													{/if}
													<p class="text-sm whitespace-pre-wrap text-gray-700">{comment.content}</p>
												</div>
											{/each}
											{#if mobileSheetFocusId}
												<button
													onclick={() => (mobileSheetFocusId = null)}
													class="w-full rounded-md border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50"
												>
													View all {comments.length} comments
												</button>
											{/if}
										</div>
									{/if}
								</div>

								<div class="flex-shrink-0 border-t border-gray-200 p-3">
									{#if activeQuote}
										<div class="mb-2 rounded-md border-l-4 border-blue-400 bg-blue-50 p-2 text-xs text-blue-800">
											<div class="flex items-center justify-between gap-2">
												<p class="line-clamp-2 italic">Quoting: "{activeQuote.text}"</p>
												<button
													onclick={() => (activeQuote = null)}
													class="rounded-full p-1 hover:bg-blue-200"
													aria-label="Cancel quote"
												>
													<X class="h-4 w-4" />
												</button>
											</div>
										</div>
									{:else}
										<p class="mb-2 text-xs text-gray-500">
											Close this sheet and highlight any text to anchor a new comment.
										</p>
									{/if}
									<input
										bind:value={newAuthorName}
										type="text"
										maxlength="60"
										class="mb-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-blue-500"
										placeholder="Your name"
									/>
									<input
										bind:value={honeypotWebsite}
										type="text"
										tabindex="-1"
										autocomplete="off"
										aria-hidden="true"
										style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"
									/>
									<textarea
										bind:value={newCommentText}
										rows="3"
										maxlength="2000"
										disabled={!activeQuote}
										class="w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
										placeholder={activeQuote ? 'Add your comment…' : 'Select text first'}
									></textarea>
									{#if submitError}
										<p class="mt-1 text-xs text-red-600">{submitError}</p>
									{/if}
									<button
										onclick={submitComment}
										disabled={submitting || !activeQuote || !newCommentText.trim() || !newAuthorName.trim()}
										class="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
									>
										{submitting ? 'Posting…' : 'Post comment'}
									</button>
								</div>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	@keyframes flash-it {
		0%,
		100% {
			background-color: #bfdbfe; /* Tailwind blue-200, the base color */
		}
		50% {
			background-color: #60a5fa; /* Tailwind blue-400, the flash color */
		}
	}
	.flash-animation {
		animation: flash-it 1.5s ease-in-out;
	}

	/* Anchored comment highlights: invisible by default so reading flow is unaffected.
	   A subtle marker shows on hover, and the active comment gets a soft tint. */
	:global(.mdpubs-comment-mark) {
		background: transparent;
		color: inherit;
		cursor: pointer;
		border-bottom: 1px dotted rgba(59, 130, 246, 0.35);
		transition: background-color 150ms ease;
	}
	:global(.mdpubs-comment-mark:hover) {
		background-color: rgba(254, 240, 138, 0.5);
	}
	:global(.mdpubs-comment-mark.is-active) {
		background-color: rgba(254, 240, 138, 0.7);
	}
</style>
