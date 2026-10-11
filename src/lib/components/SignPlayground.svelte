<script lang="ts">
	/**
	 * Landing-page playground: raw markdown on the left, a 390px phone preview on
	 * the right, both live.
	 *
	 * It is a demo, not the product. Nothing here touches the API or the database:
	 * signatures are drawn to a canvas and held in local state so a visitor can see
	 * the whole flow — type a `<!-- mdpubs-sign-here: Label -->` anchor, watch a
	 * signing box appear in the phone, tap it, draw, done — without an account.
	 *
	 * The rendering path mirrors the published page on purpose: `marked` for the
	 * markdown, a signing box at each `mdpubs-sign-here` anchor, and a TOC built
	 * from the rendered headings.
	 */
	import { marked } from 'marked';
	import { tick } from 'svelte';
	import {
		addHeadingIds,
		previewTitle,
		previewToc,
		signAnchorKeys,
		signAnchorLabels,
		splitOnSignAnchors
	} from '$lib/helpers/landing-preview';
	import { drawSignatureImage } from '$lib/helpers/signature-image';

	const SAMPLE = `---
title: Website Redesign — Proposal
mdpubs:
sign: true
---

# Website Redesign

## Scope

A 4-page marketing site, responsive down to 390px,
with a CMS for the blog.

## Price

| Item        | Amount  |
| ----------- | ------- |
| Design      | $4,200  |
| Build       | $6,800  |

## Sign-off

Countersigned below.

<!-- mdpubs-sign-here: Client Name -->
`;

	let source = $state(SAMPLE);
	let editorEl = $state<HTMLTextAreaElement | null>(null);

	/**
	 * One signature per anchor, keyed by the anchor's stable key rather than its
	 * position. The visitor is editing the document live: keying by position means
	 * deleting the first of two anchors shifts the second down an index, and the
	 * signature drawn for it reappears under the other signer's name.
	 */
	type DemoSignature = { name: string; dataUrl: string; signedAt: number };
	let signatures = $state<Record<string, DemoSignature>>({});

	// Which anchor the drawer is signing, or null when the drawer is closed.
	let drawerSlot = $state<string | null>(null);
	let signerName = $state('');
	let errorMsg = $state<string | null>(null);

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let ctx: CanvasRenderingContext2D | null = null;
	let drawing = false;
	let hasDrawn = $state(false);

	/**
	 * Strip the frontmatter before rendering. The published page parses it
	 * server-side; here it is shown in the editor as the thing you type, and left
	 * out of the phone, which is what a reader sees.
	 */
	const body = $derived(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''));

	// Read the anchors from the BODY, the same text the segments are cut from, so
	// the count under the phone always matches the boxes actually on screen.
	const labels = $derived(signAnchorLabels(body));
	const keys = $derived(signAnchorKeys(body));

	const render = (md: string) =>
		marked.parse(md, { async: false, gfm: true, breaks: false }) as string;

	/**
	 * The whole document, rendered once. Only the title and the TOC read this:
	 * both need to see every heading, and the TOC's duplicate-id suffixes only
	 * line up when the headings are numbered across the full document.
	 */
	const fullHtml = $derived(addHeadingIds(render(body)));
	const toc = $derived(previewToc(fullHtml));
	const title = $derived(previewTitle(fullHtml));

	/**
	 * The body as alternating rendered chunks and signing boxes. Each chunk is
	 * rendered from its own slice of MARKDOWN (see splitOnSignAnchors) so it is
	 * balanced HTML on its own — slicing the rendered HTML instead would cut an
	 * anchor out of the middle of a list item and orphan the rest of the list.
	 *
	 * Heading ids come from the full-document pass, so a TOC link still finds its
	 * heading even when an anchor sits between two sections.
	 */
	const segments = $derived.by(() => {
		const seen = new Map<string, number>();
		return splitOnSignAnchors(body).map((seg) => ({
			html: addHeadingIds(render(seg.markdown), seen),
			slot: seg.key
		}));
	});

	// A signature drawn against an anchor that the visitor has since deleted is
	// dropped, so the count under the phone never exceeds the anchors on screen.
	const signedCount = $derived(keys.filter((k) => signatures[k] !== undefined).length);
	const allSigned = $derived(keys.length > 0 && signedCount === keys.length);

	function slotLabel(key: string): string {
		const i = keys.indexOf(key);
		return labels[i]?.trim() || `Signer ${i + 1}`;
	}

	async function openDrawer(slot: string) {
		drawerSlot = slot;
		errorMsg = null;
		hasDrawn = false;
		signerName = '';
		await tick();
		setupCanvas();
	}

	function closeDrawer() {
		drawerSlot = null;
	}

	function setupCanvas() {
		if (!canvasEl) return;
		const ratio = window.devicePixelRatio || 1;
		const rect = canvasEl.getBoundingClientRect();
		canvasEl.width = rect.width * ratio;
		canvasEl.height = rect.height * ratio;
		ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		ctx.scale(ratio, ratio);
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = '#111827';
	}

	function pointerPos(e: PointerEvent) {
		const rect = canvasEl!.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}
	function startDraw(e: PointerEvent) {
		if (!ctx) return;
		drawing = true;
		hasDrawn = true;
		const { x, y } = pointerPos(e);
		ctx.beginPath();
		ctx.moveTo(x, y);
		canvasEl?.setPointerCapture(e.pointerId);
	}
	function moveDraw(e: PointerEvent) {
		if (!drawing || !ctx) return;
		const { x, y } = pointerPos(e);
		ctx.lineTo(x, y);
		ctx.stroke();
	}
	function endDraw() {
		drawing = false;
	}
	function clearPad() {
		if (!ctx || !canvasEl) return;
		ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
		hasDrawn = false;
	}

	async function uploadSignature(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !canvasEl) return;
		errorMsg = null;
		try {
			await drawSignatureImage(canvasEl, file);
			hasDrawn = true;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not read that image.';
		}
	}

	/**
	 * Delete an anchor and its signature goes with it.
	 *
	 * Hiding an orphaned signature is not enough: retype an anchor with the same
	 * label and the old drawing would come back under it, which is the opposite of
	 * what deleting it looked like it did. Called from the edit path rather than an
	 * effect so typing stays the only thing that changes the document.
	 */
	function dropOrphanSignatures() {
		const live = new Set(signAnchorKeys(body));
		for (const k of Object.keys(signatures)) {
			if (!live.has(k)) delete signatures[k];
		}
		if (drawerSlot !== null && !live.has(drawerSlot)) drawerSlot = null;
	}

	function confirmSign() {
		errorMsg = null;
		if (!signerName.trim()) {
			errorMsg = 'Enter a name.';
			return;
		}
		if (!hasDrawn || !canvasEl) {
			errorMsg = 'Draw or upload a signature.';
			return;
		}
		if (drawerSlot === null) return;
		signatures[drawerSlot] = {
			name: signerName.trim(),
			dataUrl: canvasEl.toDataURL('image/png'),
			signedAt: Date.now()
		};
		drawerSlot = null;
	}

	function resetDemo() {
		signatures = {};
		drawerSlot = null;
	}

	function addAnchor() {
		source = `${source.replace(/\s*$/, '')}\n\n<!-- mdpubs-sign-here: Second Signer -->\n`;
		dropOrphanSignatures();
		editorEl?.focus();
	}

	function fmtTime(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="grid gap-px border border-base-content/15 bg-base-content/15 lg:grid-cols-2">
	<!-- Left: the markdown you write -->
	<div class="flex flex-col bg-base-100">
		<div
			class="flex items-center justify-between border-b border-base-content/10 px-4 py-2 font-mono text-xs text-base-content/50"
		>
			<span>proposal.md</span>
			<button
				type="button"
				onclick={addAnchor}
				class="border border-base-content/20 px-2 py-1 font-mono text-[11px] text-base-content/70 transition-colors hover:border-base-content/50 hover:text-base-content"
			>
				+ sign anchor
			</button>
		</div>
		<label for="playground-source" class="sr-only">Markdown source</label>
		<textarea
			id="playground-source"
			bind:this={editorEl}
			bind:value={source}
			oninput={dropOrphanSignatures}
			spellcheck="false"
			class="min-h-[460px] w-full flex-1 resize-none bg-base-100 p-4 font-mono text-[13px] leading-relaxed text-base-content focus:outline-none"
		></textarea>
		<p class="border-t border-base-content/10 px-4 py-2 font-mono text-[11px] text-base-content/45">
			Edit anything. The phone updates as you type.
		</p>
	</div>

	<!-- Right: the 390px phone a client actually opens -->
	<div class="flex flex-col items-center bg-base-200 px-4 py-8">
		<div class="mb-3 font-mono text-[11px] tracking-wide text-base-content/50">
			iPhone · 390px · what your client sees
		</div>

		<div
			class="w-[390px] max-w-full overflow-hidden rounded-[2rem] border border-base-content/25 bg-white shadow-sm"
		>
			<!-- Phone chrome -->
			<div
				class="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2 font-mono text-[11px] text-gray-500"
			>
				<span>9:41</span>
				<span class="truncate px-2">mdpubs.com/abc123</span>
				<span>100%</span>
			</div>

			<div class="relative h-[520px] overflow-y-auto">
				<!-- Document header + auto TOC -->
				<div class="border-b border-gray-200 px-5 py-4">
					<h3 class="text-lg font-semibold text-gray-900">{title}</h3>
					{#if toc.length}
						<details class="mt-3" open>
							<summary
								class="cursor-pointer font-mono text-[11px] tracking-wide text-gray-500 uppercase"
							>
								Contents
							</summary>
							<ul class="mt-2 space-y-1">
								{#each toc as item (item.id)}
									<li class={item.level === 3 ? 'pl-4' : ''}>
										<a href="#{item.id}" class="text-[13px] text-gray-600 hover:text-gray-900"
											>{item.text}</a
										>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>

				<!-- Rendered document, with a signing box at each anchor -->
				<article
					class="prose prose-sm max-w-none px-5 py-4 prose-headings:text-gray-900 prose-p:text-gray-700 [&_table]:block [&_table]:overflow-x-auto"
				>
					{#each segments as seg, i (i)}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html seg.html}
						{#if seg.slot !== null}
							{@const sig = signatures[seg.slot]}
							{#if sig}
								<div class="my-4 max-w-[280px] not-prose">
									<img
										src={sig.dataUrl}
										alt="Signature of {sig.name}"
										class="h-10 max-w-[160px] object-contain object-left object-bottom"
									/>
									<div class="border-t-2 border-dotted border-gray-400 pt-1">
										<div class="text-sm font-medium text-gray-900">{sig.name}</div>
										<div class="text-xs text-gray-500">Date: {fmtTime(sig.signedAt)}</div>
									</div>
								</div>
							{:else}
								<button
									type="button"
									onclick={() => openDrawer(seg.slot!)}
									class="my-4 w-full max-w-[280px] rounded-lg border-2 border-dashed border-gray-900 p-4 text-left transition-colors not-prose hover:bg-gray-50"
								>
									<div class="text-xs font-medium tracking-wide text-gray-500 uppercase">
										{slotLabel(seg.slot)}
									</div>
									<div class="mt-1 text-sm text-gray-700">✍️ Tap here to sign</div>
								</button>
							{/if}
						{/if}
					{/each}
				</article>

				<!-- One-tap signing drawer, inside the phone -->
				{#if drawerSlot !== null}
					<div class="absolute inset-0 z-10 flex flex-col justify-end">
						<button
							type="button"
							aria-label="Close signing drawer"
							onclick={closeDrawer}
							class="absolute inset-0 bg-gray-900/40"
						></button>
						<div class="relative rounded-t-2xl border-t border-gray-300 bg-white p-4 shadow-lg">
							<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300"></div>
							<p class="mb-2 text-sm font-semibold text-gray-900">
								Signing as {slotLabel(drawerSlot)}
							</p>
							<div class="mb-2 flex items-center gap-2">
								<span class="text-xs font-medium text-gray-600">Draw your signature</span>
								<button type="button" onclick={clearPad} class="text-[11px] text-red-600"
									>Clear</button
								>
								<label
									class="cursor-pointer border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700"
								>
									Upload
									<input type="file" accept="image/*" class="hidden" onchange={uploadSignature} />
								</label>
							</div>
							<canvas
								bind:this={canvasEl}
								onpointerdown={startDraw}
								onpointermove={moveDraw}
								onpointerup={endDraw}
								onpointerleave={endDraw}
								class="h-24 w-full touch-none rounded-lg border border-dashed border-gray-300 bg-gray-50"
							></canvas>
							<label for="playground-signer" class="sr-only">Full name</label>
							<input
								id="playground-signer"
								type="text"
								bind:value={signerName}
								placeholder="Full name"
								class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
							/>
							{#if errorMsg}
								<p class="mt-1 text-xs text-red-600">{errorMsg}</p>
							{/if}
							<div class="mt-2 flex gap-2">
								<button
									type="button"
									onclick={closeDrawer}
									class="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700"
									>Cancel</button
								>
								<button
									type="button"
									onclick={confirmSign}
									class="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-black"
									>Sign</button
								>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Status line under the phone -->
		<div
			class="mt-3 flex items-center gap-3 font-mono text-[11px] text-base-content/60"
			aria-live="polite"
		>
			{#if labels.length === 0}
				<span>No sign anchor yet — add one to make it signable.</span>
			{:else if allSigned}
				<span class="text-base-content">✓ Signed — {signedCount}/{labels.length} complete</span>
				<button type="button" onclick={resetDemo} class="underline hover:text-base-content"
					>Reset</button
				>
			{:else}
				<span>{signedCount}/{labels.length} signed</span>
			{/if}
		</div>
		<p class="mt-1 font-mono text-[10px] text-base-content/40">
			Demo only — nothing is saved or sent.
		</p>
	</div>
</div>
