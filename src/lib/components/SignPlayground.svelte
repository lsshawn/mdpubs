<script lang="ts">
	/**
	 * Landing-page demo: a sample proposal on a 390px phone, with the signing box
	 * in view on load so a visitor can sign it without scrolling.
	 *
	 * The proposal is short on purpose. Everything a client needs to decide (price,
	 * timeline, payment terms, what they get) sits above the signing box, and the
	 * whole document fits the phone screen.
	 *
	 * It is a demo, not the product. Nothing here touches the API or the database:
	 * the signature is drawn to a canvas and held in local state.
	 */
	import { tick } from 'svelte';
	import { drawSignatureImage } from '#lib/helpers/signature-image.js';

	const SIGNER = 'Jordan Lee';
	const SIGNER_ORG = 'Acme Co';

	const terms = [
		['Total', '$11,000'],
		['Timeline', '6 weeks'],
		['Payment', '50% now, 50% at launch']
	];
	const included = [
		'4-page site: Home, About, Services, Contact',
		'A blog your team can edit',
		'Built for phones first'
	];

	type DemoSignature = { name: string; dataUrl: string; signedAt: number };
	let signature = $state<DemoSignature | null>(null);

	let drawerOpen = $state(false);
	// Prefilled so a visitor only has to draw and tap Sign.
	let signerName = $state(SIGNER);
	let errorMsg = $state<string | null>(null);

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let ctx: CanvasRenderingContext2D | null = null;
	let drawing = false;
	let hasDrawn = $state(false);

	async function openDrawer() {
		drawerOpen = true;
		errorMsg = null;
		hasDrawn = false;
		await tick();
		setupCanvas();
	}

	function closeDrawer() {
		drawerOpen = false;
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
		signature = {
			name: signerName.trim(),
			dataUrl: canvasEl.toDataURL('image/png'),
			signedAt: Date.now()
		};
		drawerOpen = false;
	}

	function resetDemo() {
		signature = null;
		signerName = SIGNER;
	}

	function fmtTime(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="flex flex-col items-center">
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

		<div class="relative min-h-[460px]">
			<article class="px-5 pt-5 pb-6 text-gray-800">
				<p class="text-[11px] font-medium tracking-wider text-gray-500 uppercase">
					Proposal · Rivera Studio
				</p>
				<h3 class="mt-2 text-xl leading-snug font-semibold text-gray-900">
					Website redesign for {SIGNER_ORG}
				</h3>
				<p class="mt-1 text-xs text-gray-500">Prepared for {SIGNER}</p>

				<dl class="mt-4 divide-y divide-gray-200 border-y border-gray-200 text-sm">
					{#each terms as [term, value] (term)}
						<div class="flex justify-between gap-4 py-2">
							<dt class="text-gray-500">{term}</dt>
							<dd class="text-right font-medium text-gray-900">{value}</dd>
						</div>
					{/each}
				</dl>

				<p class="mt-4 text-xs font-semibold tracking-wider text-gray-500 uppercase">
					What you get
				</p>
				<ul class="mt-2 space-y-1.5 text-sm">
					{#each included as item (item)}
						<li class="flex gap-2"><span class="text-gray-400">—</span>{item}</li>
					{/each}
				</ul>

				{#if signature}
					<div class="mt-5 max-w-[280px]">
						<img
							src={signature.dataUrl}
							alt="Signature of {signature.name}"
							class="h-10 max-w-[160px] object-contain object-bottom-left"
						/>
						<div class="border-t-2 border-dotted border-gray-400 pt-1">
							<div class="text-sm font-medium text-gray-900">{signature.name}</div>
							<div class="text-xs text-gray-500">
								{SIGNER_ORG} · {fmtTime(signature.signedAt)}
							</div>
						</div>
					</div>
					<p
						class="mt-4 inline-block rounded-full border border-gray-900 px-3 py-1 text-[11px] font-medium text-gray-900"
					>
						✓ Signed and locked
					</p>
				{:else}
					<button
						type="button"
						onclick={openDrawer}
						class="mt-5 w-full rounded-lg border-2 border-dashed border-gray-900 p-4 text-left transition-colors hover:bg-gray-50"
					>
						<div class="text-xs font-medium tracking-wide text-gray-500 uppercase">
							{SIGNER}, {SIGNER_ORG}
						</div>
						<div class="mt-1 text-sm text-gray-700">✍️ Tap here to sign</div>
					</button>
				{/if}
			</article>

			<!-- One-tap signing drawer, inside the phone -->
			{#if drawerOpen}
				<div class="absolute inset-0 z-10 flex flex-col justify-end">
					<button
						type="button"
						aria-label="Close signing drawer"
						onclick={closeDrawer}
						class="absolute inset-0 bg-gray-900/40"
					></button>
					<div class="relative rounded-t-2xl border-t border-gray-300 bg-white p-4 shadow-lg">
						<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300"></div>
						<p class="mb-2 text-sm font-semibold text-gray-900">Signing as {SIGNER}</p>
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
		{#if signature}
			<span class="text-base-content">✓ Signed. No account, no app.</span>
			<button type="button" onclick={resetDemo} class="underline hover:text-base-content"
				>Reset</button
			>
		{:else}
			<span>Tap the box and sign. Demo only, nothing is saved.</span>
		{/if}
	</div>
</div>
