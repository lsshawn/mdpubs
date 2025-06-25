<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick, onDestroy } from 'svelte';
	import { Menu, X, List } from 'lucide-svelte';

	import { app } from '$lib/config';
	import { fade } from 'svelte/transition';

	let notFound = $state(false);
	let loading = $state(true);
	let note = $state({});
	let error = $state('');
	let tocOpen = $state(false);
	let sidebarOpen = $state(true); // Desktop sidebar toggle
	let tocContentVisible = $state(true); // Controls TOC content visibility with delay
	let activeSection = $state('');
	let scrollCleanup: (() => void) | null = null;
	let clickOutsideCleanup: (() => void) | null = null;

	// Helper function to safely query elements by ID, handling IDs that start with numbers
	function safeQueryById(id: string): Element | null {
		// If ID starts with a number, use attribute selector instead
		if (/^\d/.test(id)) {
			return document.querySelector(`[id="${id}"]`);
		}
		return document.getElementById(id);
	}

	onMount(async () => {
		try {
			const res = await fetch(`${app.apiUrl}/public/notes/${page.params.id}?parse=markdown`);
			if (!res.ok) {
				if (res.status === 404) {
					notFound = true;
				} else {
					error = 'Failed to load note';
				}
			} else {
				note = await res.json();

				// Wait for the DOM to update with the new content
				await tick();

				// Small delay to ensure @html content is fully rendered
				setTimeout(() => {
					setupSectionLinks();
					setupScrollSpy();
					setupClickOutside();
					// Set initial active section if none is set
					if (!activeSection && note?.toc?.length > 0) {
						activeSection = note.toc[0].link;
					}
				}, 200);
			}
		} catch (e) {
			error = 'Network error occurred';
		}
		loading = false;
	});

	function setupScrollSpy() {
		if (!note?.toc?.length) return;

		// Simple scroll listener - find section closest to top of viewport
		const handleScroll = () => {
			const isMobile = window.innerWidth < 1024;

			const offset = isMobile ? 60 : 20; // Account for mobile TOC button

			let activeId = null;
			let minDistance = Infinity;

			// Check each TOC section
			note.toc.forEach((item) => {
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

			console.log('Click outside check:', {
				isMobile,
				tocOpen,
				tocContainer: !!tocContainer,
				target: event.target
			});

			// If click is outside the TOC container, close the menu
			if (!tocContainer) {
				console.log('Closing TOC - click outside');
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
			console.log('[LS] -> src/routes/[id]/+page.svelte:60 -> link: ', link);
			if (link) {
				e.preventDefault();
				const sectionId = link.getAttribute('href')?.substring(1);
				console.log('[LS] -> src/routes/[id]/+page.svelte:64 -> sectionId: ', sectionId);
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
</script>

<svelte:head>
	<title>{note?.frontmatter?.title || 'Note'} - NeoNote</title>
	<meta name="description" content={note?.frontmatter?.description || 'A published note'} />
</svelte:head>

<div class="min-h-screen bg-white">
	{#if loading}
		<!-- Loading State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="loading loading-spinner loading-lg text-gray-400"></div>
				<p class="mt-4 text-gray-500">Loading note...</p>
			</div>
		</div>
	{:else if notFound}
		<!-- 404 State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">📝</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">Page not found</h1>
				<p class="mb-6 text-gray-500">
					The note you're looking for doesn't exist or has been removed.
				</p>
				<a href="/" class="btn btn-primary">Go Home</a>
			</div>
		</div>
	{:else if error}
		<!-- Error State -->
		<div class="flex min-h-screen items-center justify-center">
			<div class="text-center">
				<div class="mb-4 text-6xl">⚠️</div>
				<h1 class="mb-2 text-2xl font-semibold text-gray-900">Something went wrong</h1>
				<p class="mb-6 text-gray-500">{error}</p>
				<button class="btn btn-primary" onclick={() => location.reload()}>Try Again</button>
			</div>
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
												{#each note.toc as item}
													<button
														onclick={() => handleTocClick(item.link)}
														class="block w-full rounded-none px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-gray-100 {activeSection ===
														item.link
															? 'border-r-2 border-blue-600 bg-blue-50 text-blue-700'
															: 'text-gray-600 hover:text-gray-900'}"
													>
														{item.title}
													</button>
												{/each}
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
										console.log('Toggle button clicked, tocOpen was:', tocOpen);
										tocOpen = !tocOpen;
										console.log('Toggle button clicked, tocOpen now:', tocOpen);
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
									{#each note.toc as item}
										<button
											onclick={() => handleTocClick(item.link)}
											class="block w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-gray-100 {activeSection ===
											item.link
												? 'bg-blue-50 text-blue-700'
												: 'text-gray-600 hover:text-gray-900'}"
										>
											{item.title}
										</button>
									{/each}
								</nav>
							</div>
						{/if}
					{/if}

					<div class="mx-auto max-w-4xl px-6 py-6 lg:py-12">
						<!-- Header -->
						<header class="mb-8">
							{#if note?.frontmatter?.title}
								<h1 class="text-2xl leading-tight font-bold text-gray-900 lg:text-4xl">
									{note.frontmatter.title}
								</h1>
							{/if}

							{#if note?.frontmatter?.description}
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
						</header>

						<!-- Divider -->
						<div class="mb-8 border-t border-gray-200"></div>

						<!-- Content -->
						<article class="prose prose-sm prose-gray max-w-none">
							{@html note.html}
						</article>

						<!-- Footer -->
						<footer class="mt-32 border-t border-gray-200 pt-8">
							<div class="flex flex-col items-center justify-center text-gray-500">
								<a
									href="http://neonote.sshawn.com"
									class="inline-flex items-center text-sm text-gray-500 underline transition-colors hover:text-gray-700"
								>
									<span class="mr-2">📝</span>
									Powered by NeoNote
								</a>
								<div class="mt-1 text-xs">The Easiest Way to Publish Markdown from Neovim</div>
							</div>
						</footer>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
