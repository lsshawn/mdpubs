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
		fields?: Record<string, string> | null;
	};
	type SignField = { label: string; required: boolean };
	type SignState = {
		enabled: boolean;
		order: 'sequential' | 'parallel';
		fields: SignField[];
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
	// Custom field values keyed by declared label.
	let fieldValues = $state<Record<string, string>>({});

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
			return new Date(ts).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
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
		if (!hasDrawn) return (errorMsg = 'Please draw your signature.');
		// Only an open slot asks for name/email here; a named slot supplies its own.
		if (slot?.open && !name.trim()) return (errorMsg = 'Please enter your name.');
		for (const f of signState.fields) {
			if (f.required && !fieldValues[f.label]?.trim())
				return (errorMsg = `Please fill in "${f.label}".`);
		}
		const blob = await canvasToBlob();
		if (!blob) return (errorMsg = 'Could not read the signature. Try again.');

		submitting = true;
		try {
			const fd = new FormData();
			fd.append('name', name.trim());
			fd.append('email', email.trim());
			fd.append('signature', blob, 'signature.png');
			for (const f of signState.fields) {
				fd.append(`field:${f.label}`, (fieldValues[f.label] || '').trim());
			}
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

<!--
	Print / Save-as-PDF rendering: the interactive box below is display:none on
	print. Instead we render a conventional signature line with explicit
	Name: / Date: / Title: labels, so a printed contract reads like a standard
	signature block regardless of whether the slot was signed on screen.
-->
<div class="mdpubs-sign-print my-6 max-w-md">
	{#if slot}
		<!-- Drawn mark (if signed) sitting on the signature rule. -->
		{#if slot.signed && slot.signatureImageUrl}
			<img
				src={slot.signatureImageUrl}
				alt="Signature of {slot.name}"
				class="print-sign-mark"
			/>
		{:else if slot.signed}
			<div class="print-sign-cursive">{slot.name}</div>
		{:else}
			<div class="print-sign-blank"></div>
		{/if}
		<div class="print-sign-rule"></div>
		<div class="print-sign-fields">
			<div><span class="print-sign-label">Name:</span> {slot.signed ? slot.name : ''}</div>
			<div><span class="print-sign-label">Date:</span> {slot.signed ? fmtDate(slot.signedAt) : ''}</div>
			{#if slot.email}
				<div><span class="print-sign-label">Email:</span> {slot.email}</div>
			{/if}
			<!-- Custom fields (e.g. Title). Show declared fields even when unsigned so
			     the printed line has a labelled blank to complete by hand. -->
			{#each signState.fields as field (field.label)}
				<div>
					<span class="print-sign-label">{field.label}:</span>
					{slot.fields?.[field.label] ?? ''}
				</div>
			{/each}
		</div>
	{/if}
</div>

<div class="mdpubs-sign-screen my-4 max-w-md">
	{#if slot?.signed}
		<!-- Completed signature: render like a real signed document — the drawn mark
		     sits on a signature line, with the name/date typed beneath. No card. -->
		<div class="max-w-[280px]">
			{#if slot.signatureImageUrl}
				<img
					src={slot.signatureImageUrl}
					alt="Signature of {slot.name}"
					class="h-10 max-w-[160px] object-contain object-left object-bottom"
				/>
			{:else}
				<div class="h-10 pt-2 font-[cursive] text-xl text-gray-800 italic">{slot.name}</div>
			{/if}
			<div class="border-t-2 border-dotted border-gray-400 pt-1">
				<div class="text-sm font-medium text-gray-900">{slot.name}</div>
				{#if slot.signedAt}
					<div class="text-xs text-gray-500">Date: {fmtDate(slot.signedAt)}</div>
				{/if}
				{#if slot.email}
					<div class="text-xs text-gray-500">{slot.email}</div>
				{/if}
				{#if slot.fields}
					{#each Object.entries(slot.fields) as [k, v] (k)}
						<div class="text-xs text-gray-600">{k}: {v}</div>
					{/each}
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
					✍️ Click here to sign
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
			<p class="mb-2 text-sm font-semibold text-gray-900">Signing as {slot.name}</p>
			{#if slot.open}
				<p class="mb-2 text-xs text-gray-600">Enter your own name and email below.</p>
			{/if}
			<div class="space-y-2">
				<!-- Signature pad first, then the identifying fields. -->
				<div class="flex items-center justify-start gap-2">
					<span class="text-xs font-medium text-gray-600">Draw your signature</span>
					<button
						type="button"
						onclick={clearPad}
						class="text-[11px] text-error">Clear</button
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
				{#if slot?.open}
					<!-- Unknown party: capture who they are (name only; add other
					     fields like email via mdpubs-signer-fields). -->
					<input
						type="text"
						bind:value={name}
						placeholder="Full name"
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
					/>
				{/if}
				{#each signState.fields as field (field.label)}
					<input
						type="text"
						bind:value={fieldValues[field.label]}
						placeholder={field.required ? field.label : `${field.label} (optional)`}
						class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
					/>
				{/each}
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

<style>
	/* Screen shows the interactive box; the standard signature line is print-only. */
	.mdpubs-sign-print {
		display: none;
	}

	@media print {
		.mdpubs-sign-screen {
			display: none !important;
		}
		.mdpubs-sign-print {
			display: block;
			break-inside: avoid;
			page-break-inside: avoid;
			color: #111;
		}
		/* Drawn signature mark rests just above the rule. */
		.print-sign-mark {
			display: block;
			/* !important: beats the page's global `.prose img { height:auto }`
			   print rule, which would otherwise blow the mark up to full size. */
			height: 2.5rem !important;
			max-width: 160px !important;
			width: auto !important;
			object-fit: contain;
			object-position: left bottom;
		}
		.print-sign-cursive {
			height: 2.5rem;
			padding-top: 0.75rem;
			font-family: cursive;
			font-size: 1.25rem;
			font-style: italic;
			color: #1f2937;
		}
		/* Empty slot still gets space above the rule to sign by hand. */
		.print-sign-blank {
			height: 2.5rem;
		}
		.print-sign-rule {
			/* Dotted signature line. 2px reads as clearly dotted at print DPI —
			   a 1px dotted border renders almost solid. */
			border-top: 2px dotted #4b5563;
			max-width: 260px;
		}
		.print-sign-fields {
			margin-top: 0.35rem;
			font-size: 0.8rem;
			line-height: 1.5;
			color: #1f2937;
		}
		.print-sign-label {
			font-weight: 600;
			color: #111;
		}
	}
</style>
