<script lang="ts">
	import { page } from '$app/state';
	import { onMount, tick, onDestroy } from 'svelte';
	import { Menu, X, List } from 'lucide-svelte';

	import { app } from '$lib/config';

	let notFound = $state(false);
	let loading = $state(true);
	let note = $state({});
	let error = $state('');
	let tocOpen = $state(false);
	let activeSection = $state('');
	let scrollCleanup: (() => void) | null = null;

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
				console.log('[LS] -> src/routes/[id]/+page.svelte:22 -> note: ', note);

				// Wait for the DOM to update with the new content
				await tick();

				// Small delay to ensure @html content is fully rendered
				setTimeout(() => {
					setupSectionLinks();
					setupScrollSpy();
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

		const observer = new IntersectionObserver(
			(entries) => {
				// Find all currently intersecting entries
				const intersectingEntries = entries.filter((entry) => entry.isIntersecting);

				if (intersectingEntries.length > 0) {
					// Sort by intersection ratio and position to get the most prominent section
					intersectingEntries.sort((a, b) => {
						// First sort by intersection ratio (higher is better)
						if (b.intersectionRatio !== a.intersectionRatio) {
							return b.intersectionRatio - a.intersectionRatio;
						}
						// Then sort by position (higher on page is better)
						return a.boundingClientRect.top - b.boundingClientRect.top;
					});

					const mostProminentEntry = intersectingEntries[0];
					const id = mostProminentEntry.target.id;
					if (id) {
						const newActiveSection = `#${id}`;
						if (activeSection !== newActiveSection) {
							activeSection = newActiveSection;
							console.log('Active section updated to:', activeSection);
						}
					}
				}
			},
			{
				rootMargin: '-10% 0px -70% 0px',
				threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
			}
		);

		// Observe all sections that are in the TOC
		note.toc.forEach((item) => {
			const element = document.querySelector(item.link);
			if (element) {
				observer.observe(element);
			}
		});

		// Also set up a scroll listener as a fallback
		let scrollTimeout;
		const handleScroll = () => {
			clearTimeout(scrollTimeout);
			scrollTimeout = setTimeout(() => {
				// Find the section that's closest to the top of the viewport
				let closestSection = null;
				let closestDistance = Infinity;

				note.toc.forEach((item) => {
					const element = document.querySelector(item.link);
					if (element) {
						const rect = element.getBoundingClientRect();
						const distance = Math.abs(rect.top - 100); // 100px offset from top
						if (distance < closestDistance && rect.top <= 200) {
							closestDistance = distance;
							closestSection = item.link;
						}
					}
				});

				if (closestSection && activeSection !== closestSection) {
					activeSection = closestSection;
					console.log('Active section updated via scroll to:', activeSection);
				}
			}, 100);
		};

		window.addEventListener('scroll', handleScroll);

		// Store cleanup function
		scrollCleanup = () => {
			window.removeEventListener('scroll', handleScroll);
		};
	}

	onDestroy(() => {
		if (scrollCleanup) {
			scrollCleanup();
		}
	});

	function setupSectionLinks() {
		// Debug: Log all elements with IDs
		const elementsWithIds = document.querySelectorAll('[id]');
		console.log(
			'[LS] -> Available IDs:',
			Array.from(elementsWithIds).map((el) => el.id)
		);

		// Handle initial hash in URL after content loads
		if (window.location.hash) {
			scrollToSection(window.location.hash.substring(1));
		}

		// Add click event listeners for anchor links
		addSectionLinkHandlers();
	}

	function scrollToSection(sectionId: string) {
		const element = document.getElementById(sectionId);
		console.log('[LS] -> src/routes/[id]/+page.svelte:41 -> element: ', element);
		console.log('[LS] -> Looking for ID:', sectionId);

		if (element) {
			element.scrollIntoView({
				behavior: 'smooth',
				block: 'start',
				inline: 'nearest'
			});

			// Update URL without triggering page reload
			window.history.replaceState(null, '', `#${sectionId}`);
		} else {
			// Try alternative approaches
			// Sometimes markdown parsers create different ID formats
			const alternatives = [
				sectionId.toLowerCase(),
				sectionId.replace(/\s+/g, '-').toLowerCase(),
				sectionId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()
			];

			for (const altId of alternatives) {
				const altElement = document.getElementById(altId);
				if (altElement) {
					console.log('[LS] -> Found with alternative ID:', altId);
					altElement.scrollIntoView({
						behavior: 'smooth',
						block: 'start',
						inline: 'nearest'
					});
					window.history.replaceState(null, '', `#${altId}`);
					return;
				}
			}

			console.log('[LS] -> No element found for any variant of:', sectionId);
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
</script>

<svelte:head>
	<title>{note?.title || 'Note'} - NeoNote</title>
	<meta name="description" content={note?.description || 'A published note'} />
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
					<aside class="hidden w-64 flex-shrink-0 lg:block">
						<div class="sticky top-6 h-fit max-h-[calc(100vh-3rem)] overflow-y-auto">
							<div class="p-6">
								<div class="mb-4 flex items-center">
									<List class="mr-2 h-5 w-5 text-gray-600" />
									<h2 class="text-sm font-semibold tracking-wide text-gray-900 uppercase">
										Table of Contents
									</h2>
								</div>
								<nav class="space-y-1">
									{#each note.toc as item}
										<button
											onclick={() => handleTocClick(item.link)}
											class="block w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-200 hover:bg-gray-100 {activeSection ===
											item.link
												? 'border-r-2 border-blue-600 bg-blue-50 text-blue-700'
												: 'text-gray-600 hover:text-gray-900'}"
										>
											{item.title}
										</button>
									{/each}
								</nav>
							</div>
						</div>
					</aside>
				{/if}

				<!-- Main Content Area -->
				<div class="flex-1 {note?.toc?.length > 0 ? 'lg:pl-0' : ''}">
					<!-- Mobile TOC Button -->
					{#if note?.toc?.length > 0}
						<div class="sticky top-0 z-40 border-b border-gray-200 bg-white lg:hidden">
							<div class="px-6 py-3">
								<button
									onclick={() => (tocOpen = !tocOpen)}
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
								class="sticky top-[57px] z-30 border-b border-gray-200 bg-white shadow-sm lg:hidden"
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

					<div class="mx-auto max-w-4xl px-6 py-12">
						<!-- Header -->
						<header class="mb-8">
							{#if note?.frontmatter?.title}
								<h1 class="mb-4 text-4xl leading-tight font-bold text-gray-900">
									{note.frontmatter.title}
								</h1>
							{/if}

							{#if note?.frontmatter?.description}
								<p class="text-xl leading-relaxed text-gray-600">
									{note?.frontmatter?.description}
								</p>
							{/if}

							{#if note.updatedAt}
								<div class="mt-6 flex items-center text-sm text-gray-500">
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
						<article class="prose prose-base prose-gray max-w-none">
							{@html note.html}
						</article>

						<!-- Footer -->
						<footer class="mt-16 border-t border-gray-200 pt-8">
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
