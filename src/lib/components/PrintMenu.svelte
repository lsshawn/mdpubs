<script lang="ts" module>
	export type PrintSettings = {
		header: boolean;
		toc: boolean;
		footnotes: boolean;
		links: boolean;
		smartBreaks: boolean;
		sectionBreaks: boolean;
	};

	export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
		header: true,
		toc: true,
		footnotes: true,
		links: false,
		smartBreaks: true,
		sectionBreaks: false
	};

	const STORAGE_KEY = 'mdpubs:print-settings';

	/** The viewer's saved choices, or the defaults. Browser only. */
	export function loadPrintSettings(): PrintSettings {
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
			return { ...DEFAULT_PRINT_SETTINGS, ...saved };
		} catch {
			return { ...DEFAULT_PRINT_SETTINGS };
		}
	}

	function savePrintSettings(s: PrintSettings) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
		} catch {
			/* private mode: the choice just isn't remembered */
		}
	}
</script>

<script lang="ts">
	import { Printer } from 'lucide-svelte';

	let {
		settings = $bindable(),
		hasToc = false,
		hasFootnotes = false
	}: { settings: PrintSettings; hasToc?: boolean; hasFootnotes?: boolean } = $props();

	let open = $state(false);
	let button = $state<HTMLButtonElement | null>(null);
	let pos = $state('');

	const PANEL_WIDTH = 272;

	const options = $derived([
		{ key: 'header', label: 'Title and date', show: true },
		{ key: 'toc', label: 'Table of contents', show: hasToc },
		{ key: 'footnotes', label: 'Footnotes', show: hasFootnotes },
		{ key: 'links', label: 'Link addresses', hint: 'Print the URL after each link', show: true },
		{
			key: 'smartBreaks',
			label: 'Smart page breaks',
			hint: 'Keep headings with their text; never split a picture or table row',
			show: true
		},
		{
			key: 'sectionBreaks',
			label: 'New page per section',
			hint: 'Start each main heading on a fresh page',
			show: true
		}
	] as Array<{ key: keyof PrintSettings; label: string; hint?: string; show: boolean }>);

	// The panel is fixed to the viewport so the toolbar around the button can't
	// clip it. It opens below a button near the top and above one near the bottom.
	function openMenu() {
		cancelClose();
		if (open || !button) return;
		open = true;
		const r = button.getBoundingClientRect();
		const width = Math.min(PANEL_WIDTH, window.innerWidth - 24);
		const left = Math.min(Math.max(12, r.right - width), window.innerWidth - width - 12);
		const vertical =
			r.top > window.innerHeight / 2
				? `bottom: ${window.innerHeight - r.top + 8}px`
				: `top: ${r.bottom + 8}px`;
		pos = `${vertical}; left: ${left}px; width: ${width}px`;
	}

	// A mouse hovers for the menu; the short delay lets the pointer cross the
	// gap between the button and the panel without it closing.
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	function closeSoon() {
		cancelClose();
		closeTimer = setTimeout(() => (open = false), 200);
	}
	function cancelClose() {
		clearTimeout(closeTimer);
	}

	// A mouse click prints at once (the menu is already showing from the hover).
	// A finger or the keyboard can't hover, so for them the button opens the menu.
	let lastPointer = '';
	function onButtonClick() {
		if (lastPointer === 'mouse') print();
		else if (open) open = false;
		else openMenu();
		lastPointer = '';
	}

	function set(key: keyof PrintSettings, value: boolean) {
		settings = { ...settings, [key]: value };
		savePrintSettings(settings);
	}

	function print() {
		cancelClose();
		open = false;
		// Let the panel close before the browser snapshots the page.
		requestAnimationFrame(() => window.print());
	}

	function onWindowClick(e: MouseEvent) {
		if (!open) return;
		const t = e.target as HTMLElement;
		if (!t.closest('[data-print-menu]')) open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative print:hidden"
	data-print-menu
	data-comments-ignore
	onpointerenter={(e) => e.pointerType === 'mouse' && openMenu()}
	onpointerleave={(e) => e.pointerType === 'mouse' && closeSoon()}
>
	<button
		bind:this={button}
		type="button"
		class="inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-full bg-base-100/85 px-2 text-base-content/70 ring-1 ring-base-content/10 backdrop-blur ring-inset hover:text-base-content"
		aria-label="Print or save as PDF"
		aria-haspopup="dialog"
		aria-expanded={open}
		onpointerdown={(e) => (lastPointer = e.pointerType)}
		onclick={onButtonClick}
	>
		<Printer size={16} />
	</button>

	{#if open}
		<div
			class="fixed z-[70] rounded-xl bg-base-100 p-3 text-sm text-base-content shadow-xl ring-1 ring-base-content/10"
			style={pos}
			role="dialog"
			tabindex="-1"
			aria-label="Print settings"
			onpointerenter={cancelClose}
		>
			<div class="px-1 pb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
				Print
			</div>
			<ul class="space-y-0.5">
				{#each options.filter((o) => o.show) as o (o.key)}
					<li>
						<label
							class="flex cursor-pointer items-start justify-between gap-3 rounded-lg px-1 py-1.5 hover:bg-base-200"
						>
							<span class="min-w-0">
								<span class="block leading-snug">{o.label}</span>
								{#if o.hint}
									<span class="block text-xs leading-snug text-base-content/55">{o.hint}</span>
								{/if}
							</span>
							<input
								type="checkbox"
								class="toggle mt-0.5 shrink-0 toggle-sm toggle-primary"
								checked={settings[o.key]}
								onchange={(e) => set(o.key, e.currentTarget.checked)}
							/>
						</label>
					</li>
				{/each}
			</ul>
			<button type="button" class="btn mt-3 w-full btn-sm btn-primary" onclick={print}>
				<Printer size={14} />
				Print or save PDF
			</button>
		</div>
	{/if}
</div>
