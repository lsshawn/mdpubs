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

	type AuditEvent = {
		action: string;
		signerEmail: string | null;
		contentHash: string | null;
		detail: string | null;
		createdAt: string | number | null;
		ipAddress: string | null;
		location: string | null;
		userAgent: string | null;
	};

	let {
		apiUrl,
		noteId,
		initialState,
		pdfUrl = null
	}: {
		apiUrl: string;
		noteId: string;
		initialState: SignState;
		/** URL that opens a print-ready view (HTML pubs). If null, print the page. */
		pdfUrl?: string | null;
	} = $props();

	let signState = $state<SignState>(initialState);
	let open = $state(false);
	let submitting = $state(false);
	let errorMsg = $state<string | null>(null);

	// Audit trail modal.
	let auditOpen = $state(false);
	let auditLoading = $state(false);
	let auditEvents = $state<AuditEvent[]>([]);
	let auditIsOwner = $state(false);

	function downloadPdf() {
		if (pdfUrl) {
			window.open(pdfUrl, '_blank', 'noopener');
		} else {
			window.print();
		}
	}

	async function openAudit() {
		auditOpen = true;
		auditLoading = true;
		try {
			const res = await fetch(`${apiUrl}/notes/${noteId}/sign/audit`);
			const body = await res.json();
			if (res.ok) {
				// 'request_created' is an internal bookkeeping event, not signer-facing.
				auditEvents = (body.events || []).filter(
					(e: AuditEvent) => e.action !== 'request_created'
				);
				auditIsOwner = !!body.isOwner;
			}
		} catch {
			auditEvents = [];
		} finally {
			auditLoading = false;
		}
	}

	function actionLabel(a: string): string {
		return (
			{
				request_created: 'Signing started',
				viewed: 'Viewed',
				signed: 'Signed',
				completed: 'All parties signed',
				edit_blocked: 'Edit blocked (content changed)'
			}[a] || a
		);
	}

	// Form fields, prefilled from the signer whose turn it is.
	let name = $state('');
	let email = $state('');
	let fieldValues = $state<Record<string, string>>({});

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

	/**
	 * Find the inline signing anchor for the signer whose turn it is (matched by
	 * name, else by index among anchors). Returns null if the doc has no anchors.
	 */
	function currentSignerAnchor(): HTMLElement | null {
		const anchors = Array.from(
			document.querySelectorAll<HTMLElement>('[data-mdpubs-sign-here]')
		);
		if (anchors.length === 0) return null;
		const target = nextSigner;
		if (target) {
			const norm = (s: string) => s.trim().toLowerCase();
			const byLabel = anchors.find(
				(a) => norm(a.getAttribute('data-mdpubs-sign-here') || '') === norm(target.name)
			);
			if (byLabel) return byLabel;
			if (anchors[target.index]) return anchors[target.index];
		}
		return anchors[0];
	}

	async function openPanel() {
		// Prefer the inline signing box: scroll to the current signer's anchor and
		// let its own box handle input. Fall back to the modal if there are no
		// inline anchors in the document.
		const anchor = currentSignerAnchor();
		if (anchor) {
			anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
			// Briefly highlight so the eye lands on the right box.
			anchor.classList.add('mdpubs-sign-flash');
			setTimeout(() => anchor.classList.remove('mdpubs-sign-flash'), 1600);
			return;
		}

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
		if (!hasDrawn) {
			errorMsg = 'Please draw your signature.';
			return;
		}
		// Only an open slot asks for name/email; a named slot supplies its own.
		if (nextSigner?.open && !name.trim()) {
			errorMsg = 'Please enter your name.';
			return;
		}
		for (const f of signState.fields) {
			if (f.required && !fieldValues[f.label]?.trim()) {
				errorMsg = `Please fill in "${f.label}".`;
				return;
			}
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
			for (const f of signState.fields) {
				fd.append(`field:${f.label}`, (fieldValues[f.label] || '').trim());
			}
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

<!-- Control cluster: a prominent Sign button, plus Download PDF and Audit trail. -->
<div class="flex items-center gap-2">
	<button
		type="button"
		onclick={openPanel}
		class="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-3 text-sm font-semibold text-white shadow-xl ring-1 ring-gray-900 transition-colors hover:bg-black"
		title="Sign this document"
	>
		{#if signState.complete}
			<span class="text-base">✓</span> Signed · {signedCount}/{signState.signers.length}
		{:else}
			<span class="text-base">✍️</span> Sign · {signedCount}/{signState.signers.length}
		{/if}
	</button>

	<button
		type="button"
		onclick={downloadPdf}
		class="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-xl ring-1 ring-gray-200 transition-colors hover:text-gray-900"
		title="Download or print as PDF"
	>
		⬇ PDF
	</button>

	<button
		type="button"
		onclick={openAudit}
		class="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-xl ring-1 ring-gray-200 transition-colors hover:text-gray-900"
		title="View the signing audit trail"
	>
		🕓 Audit
	</button>
</div>

{#if auditOpen}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 print:hidden"
		role="dialog"
		aria-modal="true"
	>
		<div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
			<div class="mb-3 flex items-start justify-between">
				<div>
					<h2 class="text-base font-semibold text-gray-900">Audit trail</h2>
					<p class="text-xs text-gray-500">
						Append-only record of every signing event.
						{#if !auditIsOwner}IP addresses are visible to the document owner only.{/if}
					</p>
				</div>
				<button
					type="button"
					onclick={() => (auditOpen = false)}
					class="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
					aria-label="Close">✕</button
				>
			</div>

			{#if auditLoading}
				<p class="py-6 text-center text-sm text-gray-400">Loading…</p>
			{:else if auditEvents.length === 0}
				<p class="py-6 text-center text-sm text-gray-400">No events recorded yet.</p>
			{:else}
				<ol class="space-y-2">
					{#each auditEvents as ev, i (i)}
						<li class="rounded-lg border border-gray-100 px-3 py-2 text-sm">
							<div class="flex items-center justify-between">
								<span class="font-medium text-gray-900">{actionLabel(ev.action)}</span>
								{#if ev.createdAt}
									<span class="text-[11px] text-gray-400"
										>{new Date(ev.createdAt).toLocaleString()}</span
									>
								{/if}
							</div>
							{#if ev.signerEmail}
								<div class="text-xs text-gray-600">{ev.signerEmail}</div>
							{/if}
							{#if ev.contentHash}
								<div class="mt-0.5 truncate font-mono text-[10px] text-gray-400">
									hash {ev.contentHash.slice(0, 24)}…
								</div>
							{/if}
							{#if auditIsOwner && (ev.ipAddress || ev.location)}
								<div class="text-[10px] text-gray-400">
									{#if ev.ipAddress}IP {ev.ipAddress}{/if}{#if ev.ipAddress && ev.location} · {/if}{#if ev.location}{ev.location}{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	</div>
{/if}

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
							{#if signer.signed && signer.fields}
								{#each Object.entries(signer.fields) as [k, v] (k)}
									<div class="text-[11px] text-gray-500">{k}: {v}</div>
								{/each}
							{/if}
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
							Signing as <span class="font-medium">{nextSigner.name}</span>. Enter your name below.
						</p>
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
					{:else}
						<p class="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 ring-1 ring-gray-200">
							Signing as <span class="font-medium">{nextSigner?.name}</span>.
						</p>
					{/if}
					{#each signState.fields as field (field.label)}
						<div>
							<label class="mb-1 block text-xs font-medium text-gray-600" for="sign-field-{field.label}"
								>{field.label}{#if !field.required}<span class="text-gray-400"> (optional)</span>{/if}</label
							>
							<input
								id="sign-field-{field.label}"
								type="text"
								bind:value={fieldValues[field.label]}
								class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
								placeholder={field.label}
							/>
						</div>
					{/each}
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

<style>
	/* Applied to a sign-here anchor (outside this component's DOM) when the Sign
	   button scrolls to it, so :global is required. */
	:global(.mdpubs-sign-flash) {
		animation: mdpubs-sign-flash 1.6s ease-out;
		border-radius: 0.5rem;
	}
	@keyframes mdpubs-sign-flash {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgba(17, 24, 39, 0);
		}
		25% {
			box-shadow: 0 0 0 4px rgba(17, 24, 39, 0.35);
		}
	}
</style>
