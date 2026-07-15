<script lang="ts">
	/**
	 * Draw-to-sign panel for a signable pub (mdpubs-sign).
	 *
	 * Shows the signer list + progress, and — when it is an unsigned signer's turn —
	 * a canvas signature pad plus name/email. On submit it POSTs a PNG of the drawn
	 * mark to POST /notes/:id/sign and refreshes the state the server returns.
	 *
	 * The parent (public [id] page) mounts this in the floating controls of the
	 * HTML-pub view. It is fully self-contained and talks straight to the API.
	 */
	import { tick } from 'svelte';

	type SignStateSigner = {
		name: string;
		email: string;
		index: number;
		signed: boolean;
		signedAt: number | null;
		isTurn: boolean;
		open?: boolean;
		signatureImageUrl?: string | null;
	};
	type SignState = {
		enabled: boolean;
		order: 'sequential' | 'parallel';
		signers: SignStateSigner[];
		complete: boolean;
		started: boolean;
		contentMatches: boolean;
	};

	let {
		apiUrl,
		noteId,
		initialState
	}: { apiUrl: string; noteId: string; initialState: SignState } = $props();

	let signState = $state<SignState>(initialState);
	let open = $state(false);
	let submitting = $state(false);
	let errorMsg = $state<string | null>(null);

	// Form fields, prefilled from the signer whose turn it is.
	let name = $state('');
	let email = $state('');

	// Canvas signature pad.
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let drawing = false;
	let hasDrawn = $state(false);
	let ctx: CanvasRenderingContext2D | null = null;

	const signedCount = $derived(signState.signers.filter((s) => s.signed).length);
	const nextSigner = $derived(signState.signers.find((s) => s.isTurn && !s.signed) || null);
	const canSignNow = $derived(!signState.complete && !!nextSigner && signState.contentMatches);

	function fmtDate(ts: number | null): string {
		if (!ts) return '';
		try {
			return new Date(ts).toLocaleString();
		} catch {
			return '';
		}
	}

	async function openPanel() {
		open = true;
		errorMsg = null;
		// Fixed signer: prefill to reduce typos against the allowlist. Open slot:
		// leave blank — the person is unknown and enters their own details.
		if (nextSigner && !nextSigner.open) {
			name = nextSigner.name;
			email = nextSigner.email;
		} else {
			name = '';
			email = '';
		}
		await tick();
		setupCanvas();
	}

	function setupCanvas() {
		if (!canvasEl) return;
		// Scale for crisp lines on HiDPI.
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

	function pointerPos(e: PointerEvent): { x: number; y: number } {
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

	function canvasToBlob(): Promise<Blob | null> {
		return new Promise((resolve) => {
			if (!canvasEl) return resolve(null);
			canvasEl.toBlob((b) => resolve(b), 'image/png');
		});
	}

	async function submit() {
		errorMsg = null;
		if (!email.trim()) {
			errorMsg = 'Please enter your email.';
			return;
		}
		if (!hasDrawn) {
			errorMsg = 'Please draw your signature.';
			return;
		}
		const blob = await canvasToBlob();
		if (!blob) {
			errorMsg = 'Could not read the signature. Please try again.';
			return;
		}

		submitting = true;
		try {
			const fd = new FormData();
			fd.append('name', name.trim());
			fd.append('email', email.trim());
			fd.append('signature', blob, 'signature.png');
			const res = await fetch(`${apiUrl}/notes/${noteId}/sign`, {
				method: 'POST',
				body: fd
			});
			const body = await res.json();
			if (!res.ok) {
				errorMsg = body?.error || 'Could not sign the document.';
				return;
			}
			signState = body as SignState;
			clearPad();
			// Advance the form to the next signer, or close if done.
			if (signState.complete || !nextSigner) {
				open = false;
			} else {
				if (nextSigner.open) {
					name = '';
					email = '';
				} else {
					name = nextSigner.name;
					email = nextSigner.email;
				}
				await tick();
				setupCanvas();
			}
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<!-- Trigger pill, matching the sibling controls' style. -->
<button
	type="button"
	onclick={openPanel}
	class="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-gray-900 transition-colors hover:bg-black"
	title="Sign this document"
>
	{#if signState.complete}
		✓ Signed ({signedCount}/{signState.signers.length})
	{:else}
		Sign ({signedCount}/{signState.signers.length})
	{/if}
</button>

{#if open}
	<!-- Modal overlay -->
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 print:hidden"
		role="dialog"
		aria-modal="true"
	>
		<div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
			<div class="mb-3 flex items-start justify-between">
				<div>
					<h2 class="text-base font-semibold text-gray-900">Sign document</h2>
					<p class="text-xs text-gray-500">
						{signState.order === 'sequential' ? 'Signed in order' : 'Any order'} ·
						{signedCount}/{signState.signers.length} signed
					</p>
				</div>
				<button
					type="button"
					onclick={() => (open = false)}
					class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
					aria-label="Close">✕</button
				>
			</div>

			{#if !signState.contentMatches}
				<div class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
					⚠ This document was changed after it was signed. The signatures below no longer match the
					current content.
				</div>
			{/if}

			<!-- Signer status list -->
			<ul class="mb-4 space-y-2">
				{#each signState.signers as signer (signer.email)}
					<li class="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2">
						<span
							class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold {signer.signed
								? 'bg-green-100 text-green-700'
								: signer.isTurn
									? 'bg-amber-100 text-amber-700'
									: 'bg-gray-100 text-gray-400'}"
						>
							{signer.signed ? '✓' : signer.index + 1}
						</span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium text-gray-900">{signer.name}</div>
							<div class="truncate text-xs text-gray-500">{signer.email}</div>
							{#if signer.signed && signer.signedAt}
								<div class="text-[11px] text-gray-400">Signed {fmtDate(signer.signedAt)}</div>
							{/if}
						</div>
						{#if signer.signed && signer.signatureImageUrl}
							<img
								src={signer.signatureImageUrl}
								alt="Signature of {signer.name}"
								class="h-8 max-w-[80px] object-contain"
							/>
						{:else if signer.isTurn}
							<span class="text-[11px] font-medium text-amber-600">Now</span>
						{/if}
					</li>
				{/each}
			</ul>

			{#if signState.complete}
				<div
					class="rounded-lg bg-green-50 px-3 py-2 text-center text-sm text-green-700 ring-1 ring-green-200"
				>
					✓ All parties have signed.
				</div>
			{:else if canSignNow}
				<!-- Signing form for the current signer -->
				<div class="space-y-3">
					{#if nextSigner?.open}
						<p class="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 ring-1 ring-gray-200">
							Signing as <span class="font-medium">{nextSigner.name}</span>. Enter your own name and
							email below.
						</p>
					{/if}
					<div>
						<label for="sign-name" class="mb-1 block text-xs font-medium text-gray-600">Name</label>
						<input
							id="sign-name"
							type="text"
							bind:value={name}
							class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
							placeholder="Your full name"
						/>
					</div>
					<div>
						<label for="sign-email" class="mb-1 block text-xs font-medium text-gray-600"
							>Email</label
						>
						<input
							id="sign-email"
							type="email"
							bind:value={email}
							class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
							placeholder="you@example.com"
						/>
						{#if !nextSigner?.open}
							<p class="mt-1 text-[11px] text-gray-400">Must match your entry on the signer list.</p>
						{/if}
					</div>
					<div>
						<div class="mb-1 flex items-center justify-between">
							<span class="text-xs font-medium text-gray-600">Draw your signature</span>
							<button
								type="button"
								onclick={clearPad}
								class="text-[11px] text-gray-400 hover:text-gray-700">Clear</button
							>
						</div>
						<canvas
							bind:this={canvasEl}
							onpointerdown={startDraw}
							onpointermove={moveDraw}
							onpointerup={endDraw}
							onpointerleave={endDraw}
							class="h-32 w-full touch-none rounded-lg border border-dashed border-gray-300 bg-gray-50"
						></canvas>
					</div>

					{#if errorMsg}
						<p class="text-xs text-red-600">{errorMsg}</p>
					{/if}

					<button
						type="button"
						onclick={submit}
						disabled={submitting}
						class="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-black disabled:opacity-50"
					>
						{submitting ? 'Signing…' : 'Sign document'}
					</button>
				</div>
			{:else if signState.contentMatches}
				<p class="text-center text-sm text-gray-500">
					Waiting for {nextSigner?.name || 'the next signer'} to sign.
				</p>
			{/if}
		</div>
	</div>
{/if}
