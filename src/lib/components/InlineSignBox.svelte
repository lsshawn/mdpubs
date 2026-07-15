<script lang="ts">
	/**
	 * Inline draw-to-sign box, rendered at a `<!-- mdpubs-sign-here: Label -->`
	 * anchor inside the document (mounted by the [id] page into the placeholder
	 * div). It signs ONE slot; the drawn mark is posted to the API, never written
	 * into the document content (that would change the signed hash).
	 *
	 * The `label` ties the anchor to a signer slot: it matches a signer's name, or
	 * for an open slot the declared label. If no label match, it falls back to slot
	 * order among anchors (first anchor -> first signer, etc.) via `slotIndex`.
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
		label,
		slotIndex,
		getState,
		onSigned
	}: {
		apiUrl: string;
		noteId: string;
		label: string;
		slotIndex: number;
		/** Reads the latest shared sign state (kept in the page). */
		getState: () => SignState;
		/** Notifies the page of a new state after a successful signature. */
		onSigned: (s: SignState) => void;
	} = $props();

	let signState = $state<SignState>(getState());
	let submitting = $state(false);
	let expanded = $state(false);
	let errorMsg = $state<string | null>(null);
	let name = $state('');
	let email = $state('');

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let drawing = false;
	let hasDrawn = $state(false);
	let ctx: CanvasRenderingContext2D | null = null;

	// Resolve which slot this anchor represents. Prefer a label match; else use the
	// anchor's ordinal position among sign-here anchors.
	const slot = $derived.by(() => {
		const norm = (s: string) => s.trim().toLowerCase();
		const byLabel = signState.signers.find((s) => norm(s.name) === norm(label));
		if (byLabel) return byLabel;
		return signState.signers[slotIndex] ?? null;
	});
	const canSignNow = $derived(
		!!slot && !slot.signed && slot.isTurn && signState.contentMatches
	);

	function fmtDate(ts: number | null): string {
		if (!ts) return '';
		try {
			return new Date(ts).toLocaleString();
		} catch {
			return '';
		}
	}

	// Keep local state fresh if another box updates the shared state.
	export function refresh(s: SignState) {
		signState = s;
	}

	async function expand() {
		expanded = true;
		errorMsg = null;
		if (slot && !slot.open) {
			name = slot.name;
			email = slot.email;
		} else {
			name = '';
			email = '';
		}
		await tick();
		setupCanvas();
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
	function canvasToBlob(): Promise<Blob | null> {
		return new Promise((resolve) => {
			if (!canvasEl) return resolve(null);
			canvasEl.toBlob((b) => resolve(b), 'image/png');
		});
	}

	async function submit() {
		errorMsg = null;
		if (!email.trim()) return (errorMsg = 'Please enter your email.');
		if (!name.trim()) return (errorMsg = 'Please enter your name.');
		if (!hasDrawn) return (errorMsg = 'Please draw your signature.');
		const blob = await canvasToBlob();
		if (!blob) return (errorMsg = 'Could not read the signature. Try again.');

		submitting = true;
		try {
			const fd = new FormData();
			fd.append('name', name.trim());
			fd.append('email', email.trim());
			fd.append('signature', blob, 'signature.png');
			const res = await fetch(`${apiUrl}/notes/${noteId}/sign`, { method: 'POST', body: fd });
			const body = await res.json();
			if (!res.ok) {
				errorMsg = body?.error || 'Could not sign the document.';
				return;
			}
			signState = body as SignState;
			onSigned(signState);
			expanded = false;
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="my-4 max-w-md">
	{#if slot?.signed}
		<!-- Completed signature -->
		<div class="rounded-lg border border-green-200 bg-green-50 p-3">
			<div class="flex items-center justify-between">
				<div>
					<div class="text-sm font-semibold text-gray-900">{slot.name}</div>
					<div class="text-xs text-gray-500">{slot.email}</div>
					{#if slot.signedAt}
						<div class="text-[11px] text-gray-400">Signed {fmtDate(slot.signedAt)}</div>
					{/if}
				</div>
				{#if slot.signatureImageUrl}
					<img
						src={slot.signatureImageUrl}
						alt="Signature of {slot.name}"
						class="h-10 max-w-[120px] object-contain"
					/>
				{:else}
					<span class="text-green-600">✓ Signed</span>
				{/if}
			</div>
		</div>
	{:else if !slot}
		<div class="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400">
			No signer configured for “{label}”.
		</div>
	{:else if !expanded}
		<!-- Collapsed: a signature line + a button -->
		<button
			type="button"
			onclick={expand}
			disabled={!canSignNow}
			class="w-full rounded-lg border-2 border-dashed p-4 text-left transition-colors {canSignNow
				? 'border-gray-900 hover:bg-gray-50'
				: 'border-gray-200 opacity-70'}"
		>
			<div class="text-xs font-medium tracking-wide text-gray-500 uppercase">
				{slot.open ? slot.name : 'Signature'}
			</div>
			<div class="mt-1 text-sm text-gray-700">
				{#if canSignNow}
					✍️ Click here to sign{slot.open ? '' : ` as ${slot.name}`}
				{:else if !signState.contentMatches}
					⚠ Document changed after signing — cannot sign
				{:else}
					Waiting for the previous signer…
				{/if}
			</div>
		</button>
	{:else}
		<!-- Expanded: the draw pad -->
		<div class="rounded-lg border border-gray-300 bg-white p-4 shadow-sm">
			{#if slot.open}
				<p class="mb-2 text-xs text-gray-600">
					Signing as <span class="font-medium">{slot.name}</span>. Enter your own name and email.
				</p>
			{/if}
			<div class="space-y-2">
				<input
					type="text"
					bind:value={name}
					placeholder="Full name"
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
				/>
				<input
					type="email"
					bind:value={email}
					placeholder="you@example.com"
					class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
				/>
				<div class="flex items-center justify-between">
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
					class="h-28 w-full touch-none rounded-lg border border-dashed border-gray-300 bg-gray-50"
				></canvas>
				{#if errorMsg}
					<p class="text-xs text-red-600">{errorMsg}</p>
				{/if}
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => (expanded = false)}
						class="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
						>Cancel</button
					>
					<button
						type="button"
						onclick={submit}
						disabled={submitting}
						class="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
					>
						{submitting ? 'Signing…' : 'Sign'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
