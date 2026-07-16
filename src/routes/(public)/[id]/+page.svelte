<script lang="ts">
	import { onMount, tick, onDestroy, mount } from 'svelte';
	import { Menu, X, List, Maximize2, Minimize2, ChevronDown, ChevronUp } from 'lucide-svelte';
	import { fade } from 'svelte/transition';
	import type { PageData } from './$types';
	import DiffView from '$lib/components/DiffView.svelte';
	import LinearProgress from '$lib/components/LinearProgress.svelte';
	import SignPanel from '$lib/components/SignPanel.svelte';
	import InlineSignBox from '$lib/components/InlineSignBox.svelte';
	import SignCertificate from '$lib/components/SignCertificate.svelte';
	import { config } from '$lib/config';
	import { resolve } from '$app/paths';

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

	// State for discussion sidebar
	type Comment = {
		id: number;
		author: string;
		avatar: string;
		text: string;
		timestamp: string;
		quote?: {
			text: string;
			elementId: string;
			startPath: number[];
			startOffset: number;
			endPath: number[];
			endOffset: number;
		};
	};

	let newCommentText = $state('');
	let comments = $state<Comment[]>([
		{
			id: 1,
			author: 'Shawn',
			avatar: 'https://avatars.githubusercontent.com/u/5532271?v=4',
			text: 'This is a great starting point. I think we should explore adding more detailed examples in the next section.',
			timestamp: '2 hours ago'
		},
		{
			id: 2,
			author: 'Jane Doe',
			avatar: 'https://i.pravatar.cc/40?u=jane',
			text: 'I agree. What about a section on deployment strategies?',
			timestamp: '1 hour ago'
		}
	]);

	// Get note from server-loaded data
	let note = $derived(data.note);
	let versions = $derived(data.versions);
	let showDiffs = $derived(!!versions);

	// Raw HTML pubs render in a sandboxed iframe instead of {@html}.
	let isHtml = $derived(!!data.isHtml);
	let rawUrl = $derived(data.rawUrl);

	// Shared signing state for inline sign boxes mounted at <!-- mdpubs-sign-here -->
	// anchors. One box signing updates this; all boxes are refreshed from it.
	let sharedSignState = $state(data.signState);
	let inlineSignBoxes: Array<{ refresh: (s: unknown) => void }> = [];

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
					color: color as 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error',
					showPercentage,
					showFraction
				}
			});

			// Store component reference for cleanup
			mountedComponents.push(component);
		});

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
						onSigned: (s: typeof sharedSignState) => {
							sharedSignState = s;
							// Propagate the new state to every mounted box.
							inlineSignBoxes.forEach((b) => b.refresh(s));
						}
					}
				});
				mountedComponents.push(box as unknown as { unmount: () => void });
				inlineSignBoxes.push(box as unknown as { refresh: (s: unknown) => void });
			});
		}
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

	function addComment() {
		if (!newCommentText.trim() && !activeQuote) return;

		const newComment: Comment = {
			id: comments.length + 1,
			author: 'You', // Or a logged-in user's name
			avatar: 'https://i.pravatar.cc/40?u=you',
			text: newCommentText,
			timestamp: 'Just now',
			...(activeQuote && { quote: activeQuote }) // Add quote if it exists
		};

		comments = [...comments, newComment];
		newCommentText = '';
		activeQuote = null; // Clear the active quote
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

	function reapplyHighlights() {
		if (!articleElement) return;
		comments.forEach((comment) => {
			if (comment.quote && !document.getElementById(comment.quote.elementId)) {
				const { elementId, startPath, startOffset, endPath, endOffset } = comment.quote;

				const startNode = getNodeByPath(startPath, articleElement);
				const endNode = getNodeByPath(endPath, articleElement);

				if (startNode && endNode) {
					const range = document.createRange();
					range.setStart(startNode, startOffset);
					range.setEnd(endNode, endOffset);

					if (range.collapsed) return;

					const markElement = document.createElement('mark');
					markElement.id = elementId;
					markElement.className = 'bg-blue-200 rounded-sm px-0.5';

					try {
						const selectedContent = range.extractContents();
						markElement.appendChild(selectedContent);
						range.insertNode(markElement);
					} catch (e) {
						console.error('Failed to re-apply highlight:', e);
					}
				}
			}
		});
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

		// Create a <mark> element to wrap the selection
		const markElement = document.createElement('mark');
		markElement.id = highlightId;
		markElement.className = 'bg-blue-200 rounded-sm px-0.5'; // style the highlight

		try {
			const selectedContent = range.extractContents();
			markElement.appendChild(selectedContent);
			range.insertNode(markElement);

			// Store the quote info with its structural path
			activeQuote = {
				text: selectedText,
				elementId: highlightId,
				startPath: startPath,
				startOffset: range.startOffset,
				endPath: endPath,
				endOffset: range.endOffset
			};

			// Focus the comment box
			const commentBox = document.querySelector('textarea');
			if (commentBox) commentBox.focus();
		} catch (e) {
			console.error('Could not wrap selection.', e);
			alert('Sorry, an error occurred while quoting the text. Please try again.');
		} finally {
			// Clean up
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
	{#each items as item (item.link)}
		<button
			onclick={() => handleTocClick(item.link)}
			class="block w-full px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-base-200 {isMobile
				? 'rounded-md'
				: 'rounded-none'} {activeSection === item.link
				? 'bg-primary/10 text-primary'
				: 'text-base-content/70 hover:text-base-content'} {activeSection === item.link && !isMobile
				? 'border-r-2 border-primary'
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
					apiUrl={data.apiUrl}
					noteId={data.noteId}
					initialState={data.signState}
					pdfUrl={`${rawUrl}?print=1`}
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
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a
				href="https://mdpubs.com"
				target="_blank"
				rel="noopener"
				class="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-lg ring-1 ring-gray-200 transition-colors hover:text-gray-900"
			>
				Hosted on MdPubs
			</a>
		</div>
	</div>
{:else}
	<div class="min-h-screen overflow-x-hidden">
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
							href={resolve('/(public)/[id]', { id: note.id })}
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
				<!-- Quote Button Popover -->
				{#if quoteButtonVisible}
					<div
						style="top: {quoteButtonPosition.top}px; left: {quoteButtonPosition.left}px;"
						class="absolute z-50"
						data-quote-button
						transition:fade={{ duration: 150 }}
					>
						<button
							class="flex items-center gap-2 rounded-md border border-base-300 bg-base-100 px-3 py-1.5 text-sm font-medium text-base-content shadow-lg hover:bg-base-200"
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
									class="overflow-hidden rounded-md bg-base-100 shadow-none ring-0 ring-base-300 transition-all duration-100 ease-in-out {sidebarOpen
										? 'w-64 '
										: 'h-12 w-12'}"
								>
									<!-- Toggle Button Header -->
									<button
										onclick={toggleSidebar}
										class="flex w-full items-center p-3 transition-colors duration-200 hover:bg-base-200 {sidebarOpen
											? 'border-b border-base-300'
											: ''}"
										title="{sidebarOpen ? 'Hide' : 'Show'} table of contents"
									>
										{#if sidebarOpen}
											<X class="mr-2 h-5 w-5 flex-shrink-0 text-base-content/70" />
											<span class="text-sm font-semibold tracking-wide text-base-content uppercase">
												Table of Contents
											</span>
										{:else}
											<List class="h-5 w-5 text-base-content/70" />
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

						<div class="mx-auto max-w-4xl px-6 py-6 lg:py-12">
							<!-- Header -->
							<header class="mb-8">
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

									{#if note.updatedAt}
										<div class="mt-2 flex items-center text-xs text-base-content/60 md:text-sm">
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
									<div class="mb-8 border-t border-base-300"></div>
								{/if}
							</header>

							<!-- Content (markdown pubs; HTML pubs render fullscreen above) -->
							<article
								class="prose min-h-[80vh] max-w-none overflow-x-hidden text-base-content [overflow-wrap:anywhere] [--tw-prose-body:var(--color-base-content)] [--tw-prose-headings:var(--color-base-content)] [--tw-prose-bold:var(--color-base-content)] [--tw-prose-links:var(--color-primary)] [--tw-prose-quotes:var(--color-base-content)] [--tw-prose-code:var(--color-base-content)] [--tw-prose-captions:var(--color-base-content)] [--tw-prose-counters:var(--color-base-content)] [--tw-prose-bullets:var(--color-base-content)] [--tw-prose-hr:var(--color-base-300)] [--tw-prose-quote-borders:var(--color-base-300)] [--tw-prose-th-borders:var(--color-base-300)] [--tw-prose-td-borders:var(--color-base-300)] [&_code]:[overflow-wrap:anywhere] [&_img]:max-w-full [&_pre]:overflow-x-auto [&_pre]:[overflow-wrap:normal] [&_table]:block [&_table]:overflow-x-auto"
								bind:this={articleElement}
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html note.html}
							</article>

							<!-- Footer -->
							<footer class="mt-32 border-t border-base-300 pt-8 print:hidden">
								<div class="flex flex-col items-center justify-center text-base-content/60">
									<a
										href="http://mdpubs.com"
										class="inline-flex items-center text-sm text-base-content/60 underline transition-colors hover:text-base-content/80"
									>
										<span class="mr-2">📝</span>
										Powered by {config.name}
									</a>
									<div class="mt-1 text-xs">{config.description}</div>
								</div>
							</footer>
						</div>
					</div>

					<!-- Discussion Sidebar -->
					{#if config.featureFlags.discussionSidebar}
						<aside class="hidden w-80 flex-shrink-0 border-l border-base-300 lg:block">
							<div class="sticky top-0 flex h-screen flex-col">
								<div class="flex-shrink-0 border-b border-base-300 p-4">
									<h3 class="text-lg font-semibold text-base-content">Discussion</h3>
								</div>

								<!-- Comments List -->
								<div class="flex-1 overflow-y-auto p-4">
									<div class="space-y-6">
										{#each comments as comment (comment.id)}
											<div class="flex items-start gap-3">
												<img
													src={comment.avatar}
													alt={comment.author}
													class="h-8 w-8 rounded-full"
												/>
												<div class="flex-1">
													<p class="text-sm font-medium text-base-content">{comment.author}</p>

													{#if comment.quote}
														<button
															onclick={() => scrollToQuote(comment.quote.elementId)}
															class="my-2 block w-full rounded-md border-l-4 border-base-300 bg-base-200 p-2 text-left text-sm text-base-content/70 hover:bg-base-300"
														>
															<blockquote class="line-clamp-3 italic">
																"{comment.quote.text}"
															</blockquote>
														</button>
													{/if}

													{#if comment.text}
														<p class="text-sm text-base-content/70">{comment.text}</p>
													{/if}

													<p class="mt-1 text-xs text-base-content/50">{comment.timestamp}</p>
												</div>
											</div>
										{/each}
									</div>
								</div>

								<!-- New Comment Form -->
								<div class="flex-shrink-0 border-t border-base-300 p-4">
									<div class="flex items-start gap-3">
										<img
											src="https://i.pravatar.cc/40?u=you"
											alt="You"
											class="h-8 w-8 rounded-full"
										/>
										<div class="flex-1">
											{#if activeQuote}
												<div
													class="mb-2 rounded-md border-l-4 border-primary bg-primary/10 p-2 text-sm text-base-content"
												>
													<div class="flex items-center justify-between">
														<p class="line-clamp-2 italic">Quoting: "{activeQuote.text}"</p>
														<button
															onclick={() => (activeQuote = null)}
															class="rounded-full p-1 hover:bg-primary/20"
															title="Cancel quote"
														>
															<X class="h-4 w-4" />
														</button>
													</div>
												</div>
											{/if}
											<textarea
												bind:value={newCommentText}
												rows="3"
												class="textarea textarea-bordered w-full text-sm"
												placeholder="Add to the discussion..."
												onkeydown={(e) => {
													if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
														e.preventDefault();
														addComment();
													}
												}}></textarea>
											<div class="mt-2 flex items-center justify-between">
												<p class="text-xs text-base-content/50">Cmd+Enter to send</p>
												<button
													onclick={addComment}
													disabled={!newCommentText.trim() && !activeQuote}
													class="btn btn-primary btn-sm"
												>
													Comment
												</button>
											</div>
										</div>
									</div>
								</div>
							</div>
						</aside>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<!-- Signing for markdown pubs: the HTML-pub branch has its own control in the
     floating toolbar, so only render this for the markdown view. -->
{#if !isHtml && !showDiffs && data.signState?.enabled}
	<div class="fixed right-3 bottom-3 z-50 print:hidden">
		<SignPanel apiUrl={data.apiUrl} noteId={data.noteId} initialState={data.signState} />
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
</style>
